import type {
  OrderExceptionResolution,
  OrderExceptionStatus,
  OrderExceptionType,
} from '@iecp/types';

import type { OrderException } from '../entities/order-exception.entity';

export const ORDER_EXCEPTION_REPOSITORY = Symbol('ORDER_EXCEPTION_REPOSITORY');

export interface OrderExceptionListFilter {
  orderId?: string;
  status?: OrderExceptionStatus;
  limit: number;
  cursor?: string | null;
}

export interface OrderExceptionRepositoryPort {
  findById(id: string): Promise<OrderException | null>;

  findByDedupeKey(dedupeKey: string): Promise<OrderException | null>;

  /** Every `OPEN` exception of one order — what `OrderService.approve()`
   * checks and `OrderService.cancel()` closes. */
  listOpenByOrderId(orderId: string): Promise<OrderException[]>;

  list(
    filter: OrderExceptionListFilter,
  ): Promise<{ items: OrderException[]; nextCursor: string | null }>;

  /**
   * Opens the exception identified by `dedupeKey`, or returns the one that
   * already exists. Race-safe: `dedupeKey` is `@unique`, so of N concurrent
   * callers exactly one `INSERT` succeeds and the rest catch the resulting
   * `P2002` and re-read the winner (the pattern every idempotent write in
   * this codebase uses). `wasNew` is true only for the call that actually
   * created the row — the one caller that should audit/log "opened".
   */
  openOrGet(props: {
    orderId: string;
    type: OrderExceptionType;
    productSkuId: string | null;
    requestedQuantity: number | null;
    dedupeKey: string;
    detail: Record<string, unknown> | null;
  }): Promise<{ exception: OrderException; wasNew: boolean }>;

  /**
   * Closes an `OPEN` exception — one conditional `UPDATE … WHERE status =
   * 'OPEN'`, so of N concurrent resolvers exactly one performs the transition
   * (`transitioned: true`) and the rest observe the already-resolved row.
   * There is deliberately no way to reopen or to force-close without a
   * resolution.
   */
  resolve(
    id: string,
    resolution: OrderExceptionResolution,
    resolvedBy: string | null,
  ): Promise<{ exception: OrderException; transitioned: boolean }>;
}
