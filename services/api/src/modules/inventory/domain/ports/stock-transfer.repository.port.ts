import type { StockTransferStatus, WarehouseId } from '@iecp/types';

import type { StockTransferItem } from '../entities/stock-transfer-item.entity';
import type { StockTransfer } from '../entities/stock-transfer.entity';

export const STOCK_TRANSFER_REPOSITORY = Symbol('STOCK_TRANSFER_REPOSITORY');

export interface StockTransferWithItems {
  transfer: StockTransfer;
  items: StockTransferItem[];
}

export interface ListTransfersFilter {
  status?: StockTransferStatus;
  sourceWarehouseId?: WarehouseId;
  destinationWarehouseId?: WarehouseId;
  cursor?: string;
  limit: number;
}

export interface StockTransferRepositoryPort {
  findById(id: string): Promise<StockTransferWithItems | null>;
  list(filter: ListTransfersFilter): Promise<{ items: StockTransfer[]; nextCursor: string | null }>;
  /** Creates DRAFT, then immediately transitions to REQUESTED — this phase
   * exposes one creation endpoint (`POST /admin/inventory/transfers`), not
   * a separate draft-editing flow (see this module's README). */
  create(props: {
    referenceNumber: string;
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    requestedBy?: string | null;
    items: { productSkuId: string; requestedQuantity: number }[];
  }): Promise<StockTransferWithItems>;
  approve(
    id: string,
    props: { approvedBy: string; items?: { productSkuId: string; approvedQuantity: number }[] },
  ): Promise<StockTransferWithItems>;
  /**
   * APPROVED -> PICKING -> DISPATCHED in one call (no separate
   * scan-driven picking UI this phase — see this module's README).
   * Decrements the source warehouse's on-hand for every item (writing a
   * `TRANSFER_OUT` ledger row each) and increments the destination's
   * in-transit quantity by the same amount.
   */
  dispatch(
    id: string,
    props: {
      actorUserId?: string | null;
      correlationId: string;
      items?: { productSkuId: string; dispatchedQuantity: number }[];
    },
  ): Promise<StockTransferWithItems>;
  /**
   * DISPATCHED/IN_TRANSIT -> PARTIALLY_RECEIVED or RECEIVED (whichever the
   * totals resolve to). Decrements the destination's in-transit quantity
   * and increments its on-hand for every item received, writing a
   * `TRANSFER_IN` ledger row each.
   */
  receive(
    id: string,
    props: {
      actorUserId?: string | null;
      correlationId: string;
      items: { productSkuId: string; receivedQuantity: number }[];
    },
  ): Promise<StockTransferWithItems>;
  cancel(id: string): Promise<StockTransferWithItems>;
}
