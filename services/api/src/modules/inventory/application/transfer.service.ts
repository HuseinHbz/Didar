import { randomUUID } from 'node:crypto';

import type { StockTransferStatus, UserId, WarehouseId } from '@iecp/types';
import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import type { StockTransfer } from '../domain/entities/stock-transfer.entity';
import {
  INVENTORY_EVENT_PUBLISHER,
  type InventoryEventPublisherPort,
} from '../domain/ports/inventory-event-publisher.port';
import {
  STOCK_TRANSFER_REPOSITORY,
  type StockTransferRepositoryPort,
  type StockTransferWithItems,
} from '../domain/ports/stock-transfer.repository.port';

/**
 * Warehouse transfer workflow — create/approve/dispatch/receive/cancel,
 * each a real `TransferStateMachine` transition (see the Prisma
 * repository). Dispatch and receive are explicitly required to be audited
 * (the brief's own critical_rule); approve is audited too, since it's the
 * point a transfer commits to actually moving stock.
 */
@Injectable()
export class TransferService {
  constructor(
    @Inject(STOCK_TRANSFER_REPOSITORY) private readonly transfers: StockTransferRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
    @Optional()
    @Inject(INVENTORY_EVENT_PUBLISHER)
    private readonly events?: InventoryEventPublisherPort,
  ) {}

  async get(id: string): Promise<StockTransferWithItems> {
    const transfer = await this.transfers.findById(id);
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }

  list(filter: {
    status?: StockTransferStatus;
    sourceWarehouseId?: WarehouseId;
    destinationWarehouseId?: WarehouseId;
    cursor?: string;
    limit: number;
  }): Promise<{ items: StockTransfer[]; nextCursor: string | null }> {
    return this.transfers.list(filter);
  }

  async create(input: {
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    requestedBy?: UserId | null;
    items: { productSkuId: string; requestedQuantity: number }[];
  }): Promise<StockTransferWithItems> {
    const result = await this.transfers.create({
      referenceNumber: `TRF-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`,
      sourceWarehouseId: input.sourceWarehouseId,
      destinationWarehouseId: input.destinationWarehouseId,
      requestedBy: input.requestedBy,
      items: input.items,
    });
    await this.events?.publish('inventory_transfer_created', randomUUID(), {
      transferId: result.transfer.id,
      referenceNumber: result.transfer.referenceNumber,
      sourceWarehouseId: result.transfer.sourceWarehouseId,
      destinationWarehouseId: result.transfer.destinationWarehouseId,
    });
    return result;
  }

  async approve(
    id: string,
    approvedBy: UserId,
    items?: { productSkuId: string; approvedQuantity: number }[],
  ): Promise<StockTransferWithItems> {
    const result = await this.transfers.approve(id, { approvedBy, items });
    await this.auditLog.record({
      actorId: approvedBy,
      action: 'INVENTORY_TRANSFER_APPROVED',
      entityType: 'StockTransfer',
      entityId: id,
      newValue: { status: result.transfer.status },
    });
    return result;
  }

  async dispatch(
    id: string,
    actorUserId: UserId,
    items?: { productSkuId: string; dispatchedQuantity: number }[],
  ): Promise<StockTransferWithItems> {
    const correlationId = randomUUID();
    const result = await this.transfers.dispatch(id, { actorUserId, correlationId, items });
    await this.auditLog.record({
      actorId: actorUserId,
      action: 'INVENTORY_TRANSFER_DISPATCHED',
      entityType: 'StockTransfer',
      entityId: id,
      newValue: { status: result.transfer.status, correlationId },
    });
    await this.events?.publish('inventory_transfer_dispatched', correlationId, {
      transferId: id,
      status: result.transfer.status,
    });
    return result;
  }

  async receive(
    id: string,
    actorUserId: UserId,
    items: { productSkuId: string; receivedQuantity: number }[],
  ): Promise<StockTransferWithItems> {
    const correlationId = randomUUID();
    const result = await this.transfers.receive(id, { actorUserId, correlationId, items });
    await this.auditLog.record({
      actorId: actorUserId,
      action: 'INVENTORY_TRANSFER_RECEIVED',
      entityType: 'StockTransfer',
      entityId: id,
      newValue: { status: result.transfer.status, correlationId },
    });
    await this.events?.publish('inventory_transfer_received', correlationId, {
      transferId: id,
      status: result.transfer.status,
    });
    return result;
  }

  cancel(id: string): Promise<StockTransferWithItems> {
    return this.transfers.cancel(id);
  }
}
