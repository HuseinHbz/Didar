import type { OrderExceptionStatus, OrderExceptionType } from '@iecp/types';

/** Raised when something tries to advance an order that still has an `OPEN`
 * exception. A 409: the order exists and the request is well-formed, it just
 * cannot proceed until a human has dealt with the exception. */
export class OrderHasOpenExceptionError extends Error {
  constructor(
    public readonly orderId: string,
    public readonly openExceptions: readonly { id: string; type: OrderExceptionType }[],
  ) {
    super(
      `Order ${orderId} has ${openExceptions.length} open exception(s) ` +
        `(${openExceptions.map((e) => e.type).join(', ')}); ` +
        `resolve ${openExceptions.length === 1 ? 'it' : 'them'} before the order can be approved`,
    );
    this.name = 'OrderHasOpenExceptionError';
  }
}

/** Raised when a retry of the allocation finds the stock is still not there.
 * A 409: the exception stays OPEN and nothing was changed. */
export class StockStillShortError extends Error {
  constructor(
    public readonly exceptionId: string,
    public readonly reason: string,
  ) {
    super(`Stock is still short for order exception ${exceptionId}: ${reason}`);
    this.name = 'StockStillShortError';
  }
}

/**
 * Pure rules for `OrderException` — no I/O.
 *
 * The central invariant (gap P0-5): **a paid order with an open exception does
 * not move toward fulfillment.** The order itself is `PAID` (the customer has
 * paid; pretending otherwise would hide money), but `approve` — the only edge
 * out of `PAID` — is refused until every exception is `RESOLVED`. There is no
 * override: the way out is real stock (`ALLOCATED`) or cancelling the order
 * (`ORDER_CANCELLED`, which refunds).
 */
export class OrderExceptionPolicy {
  static assertApprovable(
    orderId: string,
    exceptions: readonly { id: string; type: OrderExceptionType; status: OrderExceptionStatus }[],
  ): void {
    const open = exceptions.filter((e) => e.status === 'OPEN');
    if (open.length > 0) {
      throw new OrderHasOpenExceptionError(
        orderId,
        open.map((e) => ({ id: e.id, type: e.type })),
      );
    }
  }

  /** One shortfall exception per (order, SKU) — what makes racing conversions,
   * sweeps and retries collapse onto a single row. */
  static stockShortfallKey(orderId: string, productSkuId: string): string {
    return `STOCK_SHORTFALL:${orderId}:${productSkuId}`;
  }
}
