import type { StockCountStatus, WarehouseId } from '@iecp/types';

import type { StockCountItem } from '../entities/stock-count-item.entity';
import type { StockCount } from '../entities/stock-count.entity';

export const STOCK_COUNT_REPOSITORY = Symbol('STOCK_COUNT_REPOSITORY');

export interface StockCountWithItems {
  stockCount: StockCount;
  items: StockCountItem[];
}

export interface StockCountRepositoryPort {
  findById(id: string): Promise<StockCountWithItems | null>;
  list(filter: {
    warehouseId?: WarehouseId;
    status?: StockCountStatus;
    cursor?: string;
    limit: number;
  }): Promise<{ items: StockCount[]; nextCursor: string | null }>;
  /** Snapshots the current `onHandQuantity` for every listed SKU as
   * `expectedQuantity` at creation time — a count compares the physical
   * floor against that snapshot, not a value read at submit time. */
  create(props: {
    warehouseId: string;
    locationId?: string | null;
    productSkuIds: string[];
  }): Promise<StockCountWithItems>;
  /** PLANNED/IN_PROGRESS -> COUNTED, recording `countedQuantity` and
   * `variance` (`StockCountVarianceCalculator`) per item. */
  submit(
    id: string,
    props: { countedBy: string; items: { productSkuId: string; countedQuantity: number }[] },
  ): Promise<StockCountWithItems>;
  /**
   * COUNTED/UNDER_REVIEW -> APPROVED: for every item with a non-zero
   * variance, transactionally row-locks the item, applies the variance to
   * `onHandQuantity`, and writes a `COUNT_ADJUSTMENT` ledger entry.
   */
  approve(
    id: string,
    props: { approvedBy: string; correlationId: string },
  ): Promise<StockCountWithItems>;
  reject(id: string, props: { approvedBy: string }): Promise<StockCountWithItems>;
}
