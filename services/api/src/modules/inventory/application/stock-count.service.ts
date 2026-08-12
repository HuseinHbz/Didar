import { randomUUID } from 'node:crypto';

import type { StockCountStatus, UserId, WarehouseId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import type { StockCount } from '../domain/entities/stock-count.entity';
import {
  STOCK_COUNT_REPOSITORY,
  type StockCountRepositoryPort,
  type StockCountWithItems,
} from '../domain/ports/stock-count.repository.port';

@Injectable()
export class StockCountService {
  constructor(
    @Inject(STOCK_COUNT_REPOSITORY) private readonly counts: StockCountRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
  ) {}

  async get(id: string): Promise<StockCountWithItems> {
    const count = await this.counts.findById(id);
    if (!count) throw new NotFoundException('Stock count not found');
    return count;
  }

  list(filter: {
    warehouseId?: WarehouseId;
    status?: StockCountStatus;
    cursor?: string;
    limit: number;
  }): Promise<{ items: StockCount[]; nextCursor: string | null }> {
    return this.counts.list(filter);
  }

  create(input: {
    warehouseId: string;
    locationId?: string | null;
    productSkuIds: string[];
  }): Promise<StockCountWithItems> {
    return this.counts.create(input);
  }

  submit(
    id: string,
    countedBy: UserId,
    items: { productSkuId: string; countedQuantity: number }[],
  ): Promise<StockCountWithItems> {
    return this.counts.submit(id, { countedBy, items });
  }

  /** Approving reconciles every non-zero-variance item into the ledger —
   * always audited (the brief's "receiving and dispatch operations must
   * be audited" spirit extends to reconciliation, since it's the same
   * class of "stock quantity changed for a reason an auditor should be
   * able to find"). */
  async approve(id: string, approvedBy: UserId): Promise<StockCountWithItems> {
    const correlationId = randomUUID();
    const result = await this.counts.approve(id, { approvedBy, correlationId });
    await this.auditLog.record({
      actorId: approvedBy,
      action: 'INVENTORY_COUNT_APPROVED',
      entityType: 'StockCount',
      entityId: id,
      newValue: {
        status: result.stockCount.status,
        itemsWithVariance: result.items.filter((i) => i.variance).length,
        correlationId,
      },
    });
    return result;
  }

  reject(id: string, approvedBy: UserId): Promise<StockCountWithItems> {
    return this.counts.reject(id, { approvedBy });
  }
}
