import { randomUUID } from 'node:crypto';

import type { PurchaseOrderStatus, SupplierId, UserId, WarehouseId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import type { PurchaseOrder } from '../domain/entities/purchase-order.entity';
import {
  PURCHASE_ORDER_REPOSITORY,
  type PurchaseOrderRepositoryPort,
  type PurchaseOrderWithItems,
} from '../domain/ports/purchase-order.repository.port';

/**
 * Purchase Order workflow — create/approve/receive/cancel, each a real
 * `PurchaseOrderStateMachine` transition (see the Prisma repository).
 * Approve and receive are audited — the same "the point stock/commitment
 * actually changes is always an audit event" rule
 * `TransferService`/`AdjustmentService` already follow.
 */
@Injectable()
export class PurchaseOrderService {
  constructor(
    @Inject(PURCHASE_ORDER_REPOSITORY) private readonly purchaseOrders: PurchaseOrderRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
  ) {}

  async get(id: string): Promise<PurchaseOrderWithItems> {
    const po = await this.purchaseOrders.findById(id);
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  list(filter: {
    status?: PurchaseOrderStatus;
    supplierId?: SupplierId;
    warehouseId?: WarehouseId;
    cursor?: string;
    limit: number;
  }): Promise<{ items: PurchaseOrder[]; nextCursor: string | null }> {
    return this.purchaseOrders.list(filter);
  }

  async create(input: {
    supplierId: string;
    warehouseId: string;
    notes?: string | null;
    items: { productSkuId: string; orderedQuantity: number; unitCost: bigint }[];
    createdBy?: UserId | null;
  }): Promise<PurchaseOrderWithItems> {
    const result = await this.purchaseOrders.create({
      poNumber: `PO-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`,
      supplierId: input.supplierId,
      warehouseId: input.warehouseId,
      notes: input.notes,
      createdBy: input.createdBy,
      items: input.items,
    });
    if (input.createdBy) {
      await this.auditLog.record({
        actorId: input.createdBy,
        action: 'PURCHASE_ORDER_CREATED',
        entityType: 'PurchaseOrder',
        entityId: result.purchaseOrder.id,
        newValue: { poNumber: result.purchaseOrder.poNumber, status: result.purchaseOrder.status },
      });
    }
    return result;
  }

  async approve(id: string, approvedBy: UserId): Promise<PurchaseOrderWithItems> {
    const result = await this.purchaseOrders.approve(id, approvedBy);
    await this.auditLog.record({
      actorId: approvedBy,
      action: 'PURCHASE_ORDER_APPROVED',
      entityType: 'PurchaseOrder',
      entityId: id,
      newValue: { status: result.purchaseOrder.status },
    });
    return result;
  }

  async receive(
    id: string,
    actorUserId: UserId,
    items: { productSkuId: string; receivedQuantity: number; locationId: string }[],
    idempotencyKey?: string | null,
  ): Promise<PurchaseOrderWithItems> {
    const correlationId = randomUUID();
    const result = await this.purchaseOrders.receive(id, {
      actorUserId,
      correlationId,
      idempotencyKeyPrefix: idempotencyKey ?? null,
      items,
    });
    await this.auditLog.record({
      actorId: actorUserId,
      action: 'PURCHASE_ORDER_RECEIVED',
      entityType: 'PurchaseOrder',
      entityId: id,
      newValue: { status: result.purchaseOrder.status, correlationId },
    });
    return result;
  }

  async cancel(id: string, actorId: UserId): Promise<PurchaseOrderWithItems> {
    const result = await this.purchaseOrders.cancel(id);
    await this.auditLog.record({
      actorId,
      action: 'PURCHASE_ORDER_CANCELLED',
      entityType: 'PurchaseOrder',
      entityId: id,
      newValue: { status: result.purchaseOrder.status },
    });
    return result;
  }
}
