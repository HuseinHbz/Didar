import type { PurchaseOrderStatus, SupplierId, WarehouseId } from '@iecp/types';

import type { PurchaseOrderItem } from '../entities/purchase-order-item.entity';
import type { PurchaseOrder } from '../entities/purchase-order.entity';

export const PURCHASE_ORDER_REPOSITORY = Symbol('PURCHASE_ORDER_REPOSITORY');

export interface PurchaseOrderWithItems {
  purchaseOrder: PurchaseOrder;
  items: PurchaseOrderItem[];
}

export interface ListPurchaseOrdersFilter {
  status?: PurchaseOrderStatus;
  supplierId?: SupplierId;
  warehouseId?: WarehouseId;
  cursor?: string;
  limit: number;
}

export interface PurchaseOrderRepositoryPort {
  findById(id: string): Promise<PurchaseOrderWithItems | null>;
  list(
    filter: ListPurchaseOrdersFilter,
  ): Promise<{ items: PurchaseOrder[]; nextCursor: string | null }>;
  /** Creates directly in `SUBMITTED` — the same "no persisted DRAFT row"
   * choice `StockTransfer.create()` made (see this module's README). */
  create(props: {
    poNumber: string;
    supplierId: string;
    warehouseId: string;
    createdBy?: string | null;
    notes?: string | null;
    items: { productSkuId: string; orderedQuantity: number; unitCost: bigint }[];
  }): Promise<PurchaseOrderWithItems>;
  approve(id: string, approvedBy: string): Promise<PurchaseOrderWithItems>;
  /**
   * `APPROVED`/`PARTIALLY_RECEIVED` -> `PARTIALLY_RECEIVED` or `RECEIVED`
   * (whichever every line's totals resolve to after this call). For each
   * `items` entry: validates the receipt against that line's outstanding
   * quantity, increments `PurchaseOrderItem.receivedQuantity`, and calls
   * `InventoryItemRepositoryPort.receiveStock()` — the *existing*
   * `PURCHASE_RECEIPT` ledger primitive (ADR-006 decision 9's own
   * "procurement/returns readiness seam") — for the real quantity
   * mutation, all inside one transaction. `idempotencyKey`, when
   * supplied, is forwarded to `receiveStock()` per line so a retried
   * "receive this delivery" call (same key) resolves to the *existing*
   * ledger entries instead of double-crediting stock — the same
   * P2002-catch-and-reread convention every other quantity-mutating
   * inventory operation already uses.
   */
  receive(
    id: string,
    props: {
      actorUserId?: string | null;
      correlationId: string;
      idempotencyKeyPrefix?: string | null;
      items: { productSkuId: string; receivedQuantity: number; locationId: string }[];
    },
  ): Promise<PurchaseOrderWithItems>;
  cancel(id: string): Promise<PurchaseOrderWithItems>;
}
