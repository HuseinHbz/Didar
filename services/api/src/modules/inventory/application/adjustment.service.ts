import { randomUUID } from 'node:crypto';

import type {
  InventoryAdjustmentType,
  ProductSkuId,
  UserId,
  WarehouseId,
  WarehouseLocationId,
} from '@iecp/types';
import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import type { InventoryAdjustment } from '../domain/entities/inventory-adjustment.entity';
import type { InventoryItem } from '../domain/entities/inventory-item.entity';
import type { InventoryLedgerEntry } from '../domain/entities/inventory-ledger-entry.entity';
import {
  INVENTORY_ADJUSTMENT_REPOSITORY,
  type InventoryAdjustmentRepositoryPort,
} from '../domain/ports/inventory-adjustment.repository.port';
import {
  INVENTORY_EVENT_PUBLISHER,
  type InventoryEventPublisherPort,
} from '../domain/ports/inventory-event-publisher.port';
import {
  INVENTORY_ITEM_REPOSITORY,
  type InventoryItemRepositoryPort,
} from '../domain/ports/inventory-item.repository.port';
import {
  LOW_STOCK_CHECK_SCHEDULER,
  type LowStockCheckSchedulerPort,
} from '../domain/ports/low-stock-check-scheduler.port';

/** Manual corrections — the brief's own critical_rule: "manual adjustments
 * must be permission-controlled and audited." Permission control is the
 * presentation layer's `@RequirePermission('inventory.adjust')`; this
 * service handles the "audited" half unconditionally, on every call. */
@Injectable()
export class AdjustmentService {
  constructor(
    @Inject(INVENTORY_ADJUSTMENT_REPOSITORY)
    private readonly adjustments: InventoryAdjustmentRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
    @Inject(INVENTORY_ITEM_REPOSITORY) private readonly items: InventoryItemRepositoryPort,
    @Optional()
    @Inject(INVENTORY_EVENT_PUBLISHER)
    private readonly events?: InventoryEventPublisherPort,
    @Optional()
    @Inject(LOW_STOCK_CHECK_SCHEDULER)
    private readonly lowStockScheduler?: LowStockCheckSchedulerPort,
  ) {}

  listByWarehouse(
    warehouseId: WarehouseId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: InventoryAdjustment[]; nextCursor: string | null }> {
    return this.adjustments.listByWarehouse(warehouseId, pagination);
  }

  async create(input: {
    warehouseId: WarehouseId;
    locationId: string;
    productSkuId: ProductSkuId;
    adjustmentType: InventoryAdjustmentType;
    quantity: number;
    reason: string;
    approvedBy?: UserId | null;
    createdBy: UserId;
  }): Promise<InventoryAdjustment> {
    const correlationId = randomUUID();
    const adjustment = await this.adjustments.create({ ...input, correlationId });
    await this.auditLog.record({
      actorId: input.createdBy,
      action: 'INVENTORY_ADJUSTED',
      entityType: 'InventoryAdjustment',
      entityId: adjustment.id,
      newValue: {
        adjustmentType: adjustment.adjustmentType,
        quantity: adjustment.quantity,
        reason: adjustment.reason,
        correlationId,
      },
    });
    await this.events?.publish('inventory_adjusted', correlationId, {
      adjustmentId: adjustment.id,
      productSkuId: adjustment.productSkuId,
      warehouseId: adjustment.warehouseId,
      adjustmentType: adjustment.adjustmentType,
      quantity: adjustment.quantity,
    });
    if (input.adjustmentType === 'NEGATIVE') {
      await this.lowStockScheduler?.scheduleCheck(adjustment.productSkuId, adjustment.warehouseId);
    }
    return adjustment;
  }

  /**
   * ADR-012 decision 6 — the return module's restock step, distinct from
   * Phase 011's still-deferred cancellation-restock: a return's receiving
   * warehouse/location is real, present-tense operational data an admin
   * captures explicitly at the physical `RECEIVED` step, not a guess
   * reverse-traced from a possibly-stale reservation record. Wraps
   * `InventoryItemRepositoryPort.receiveStock()` — the row-locked,
   * ledger-writing primitive `ADR-006 decision 9` built as "the readiness
   * seam for a future ... goods receipt," using the already-defined
   * `RETURN_RECEIPT` movement type. Called by `ReturnService` exactly
   * once per return, at `INSPECTING -> APPROVED_FOR_REFUND`, only for
   * `ReturnItem`s whose inspected `condition` is sellable — never for a
   * rejected return, never merely because a return was `REQUESTED`.
   */
  async receiveReturnedStock(input: {
    productSkuId: ProductSkuId;
    warehouseId: WarehouseId;
    locationId: WarehouseLocationId;
    quantity: number;
    returnRequestId: string;
    returnItemId: string;
    actorUserId?: UserId | null;
  }): Promise<{ item: InventoryItem; ledgerEntry: InventoryLedgerEntry }> {
    const correlationId = randomUUID();
    const result = await this.items.receiveStock({
      productSkuId: input.productSkuId,
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      quantity: input.quantity,
      movementType: 'RETURN_RECEIPT',
      referenceType: 'ReturnRequest',
      referenceId: input.returnRequestId,
      reason: `Return ${input.returnRequestId} item ${input.returnItemId} received back into stock`,
      actorUserId: input.actorUserId ?? null,
      correlationId,
    });
    await this.auditLog.record({
      actorId: input.actorUserId ?? null,
      action: 'INVENTORY_RETURN_RESTOCKED',
      entityType: 'InventoryItem',
      entityId: result.item.id,
      newValue: {
        returnRequestId: input.returnRequestId,
        returnItemId: input.returnItemId,
        quantity: input.quantity,
        correlationId,
      },
    });
    await this.events?.publish('inventory_adjusted', correlationId, {
      productSkuId: input.productSkuId,
      warehouseId: input.warehouseId,
      adjustmentType: 'POSITIVE',
      quantity: input.quantity,
    });
    return result;
  }
}
