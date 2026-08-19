import type { FulfillmentStatus, OrderFulfillmentStatus, OrderPaymentStatus } from '@iecp/types';

export class OrderNotReadyToCompleteError extends Error {
  constructor(public readonly reasons: readonly string[]) {
    super(`Order is not ready to complete: ${reasons.join('; ')}`);
    this.name = 'OrderNotReadyToCompleteError';
  }
}

/**
 * ADR-011 decision 3 — the real server-side fact "is this order actually
 * done" that `OrderService.complete()` now checks *before* ever asserting
 * the `OrderStateMachine`'s `FULFILLED -> COMPLETED` edge. Pure, zero I/O:
 * every fact it needs is passed in already-fetched, the same convention
 * `FulfillmentQuantityValidator` already established one level down.
 *
 * `Order.status === 'FULFILLED'`/`Order.fulfillmentStatus === 'FULFILLED'`
 * alone is not sufficient — that cache is derived from `FulfillmentItem`
 * *quantity* sums (`FulfillmentService.syncOrderFulfillmentState()`),
 * which can reach 100% the instant a `Fulfillment` is *created*, well
 * before it has actually shipped or been delivered. This validator adds
 * the two facts that were missing: every non-`CANCELLED` `Fulfillment`
 * must itself be `DELIVERED`, and the order must not still be owed money.
 */
export class OrderCompletionValidator {
  static assertReady(input: {
    fulfillmentStatus: OrderFulfillmentStatus;
    paymentStatus: OrderPaymentStatus;
    fulfillments: readonly { status: FulfillmentStatus }[];
  }): void {
    const reasons: string[] = [];

    if (input.fulfillmentStatus !== 'FULFILLED') {
      reasons.push(`fulfillmentStatus is ${input.fulfillmentStatus}, expected FULFILLED`);
    }
    if (input.paymentStatus === 'UNPAID' || input.paymentStatus === 'PARTIALLY_PAID') {
      reasons.push(`paymentStatus is ${input.paymentStatus}, order is not yet fully paid`);
    }

    const active = input.fulfillments.filter((f) => f.status !== 'CANCELLED');
    if (active.length === 0) {
      reasons.push('order has no active (non-cancelled) fulfillment');
    }
    const undelivered = active.filter((f) => f.status !== 'DELIVERED');
    if (undelivered.length > 0) {
      reasons.push(
        `${undelivered.length} of ${active.length} active fulfillment(s) are not yet DELIVERED`,
      );
    }

    if (reasons.length > 0) {
      throw new OrderNotReadyToCompleteError(reasons);
    }
  }

  /** Same facts as `assertReady()`, without throwing — for a read-only
   * "is this order completable" surface (e.g. an admin UI hint) without
   * duplicating the rule itself. */
  static isReady(input: Parameters<typeof OrderCompletionValidator.assertReady>[0]): boolean {
    try {
      this.assertReady(input);
      return true;
    } catch {
      return false;
    }
  }
}
