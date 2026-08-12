import { randomUUID } from 'node:crypto';

import type { InventoryAdjustmentType, ProductSkuId, UserId, WarehouseId } from '@iecp/types';
import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import type { InventoryAdjustment } from '../domain/entities/inventory-adjustment.entity';
import {
  INVENTORY_ADJUSTMENT_REPOSITORY,
  type InventoryAdjustmentRepositoryPort,
} from '../domain/ports/inventory-adjustment.repository.port';
import {
  INVENTORY_EVENT_PUBLISHER,
  type InventoryEventPublisherPort,
} from '../domain/ports/inventory-event-publisher.port';
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
}
