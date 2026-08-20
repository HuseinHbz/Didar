import type { OrderPaymentStatus, OrderStatus } from '@iecp/types';

export class ReturnNotEligibleError extends Error {
  constructor(public readonly reasons: readonly string[]) {
    super(`Order is not eligible for return: ${reasons.join('; ')}`);
    this.name = 'ReturnNotEligibleError';
  }
}

const MS_PER_DAY = 86_400_000;

/**
 * A return must be validated against the actual server-known order
 * state, never trusted from the client (ADR-012 decision 3). Pure, zero
 * I/O — the caller (`ReturnService.create()`) fetches every fact this
 * needs (the order's real status/paymentStatus, and each requested
 * line's real delivered date, resolved from its own `Fulfillment
 * .deliveredAt`) and the `returns.window_days` `Setting` value, same
 * "application layer reads config, domain layer just decides" split
 * `CartPricingService.getMaxQuantityPerLine()` already established.
 */
export class ReturnEligibilityValidator {
  static assertEligible(input: {
    orderStatus: OrderStatus;
    orderPaymentStatus: OrderPaymentStatus;
    /** One entry per requested order item — `deliveredAt: null` means
     * that line was never actually delivered (still pending/shipped
     * fulfillment, or the order was cancelled before fulfillment). */
    items: readonly { orderItemId: string; deliveredAt: Date | null }[];
    windowDays: number;
    now: Date;
  }): void {
    const reasons: string[] = [];

    if (input.orderStatus !== 'FULFILLED' && input.orderStatus !== 'COMPLETED') {
      reasons.push(
        `order status ${input.orderStatus} is not eligible for return (must be FULFILLED or COMPLETED)`,
      );
    }
    if (input.orderPaymentStatus !== 'PAID' && input.orderPaymentStatus !== 'PARTIALLY_REFUNDED') {
      reasons.push(
        `order payment status ${input.orderPaymentStatus} is not eligible for return (payment must be settled)`,
      );
    }
    if (input.items.length === 0) {
      reasons.push('at least one order item must be named in the return request');
    }
    for (const item of input.items) {
      if (!item.deliveredAt) {
        reasons.push(`order item ${item.orderItemId} has not been delivered yet`);
        continue;
      }
      const deadline = new Date(item.deliveredAt.getTime() + input.windowDays * MS_PER_DAY);
      if (input.now.getTime() > deadline.getTime()) {
        reasons.push(
          `order item ${item.orderItemId}'s return window has expired ` +
            `(delivered ${item.deliveredAt.toISOString()}, window ${input.windowDays} days)`,
        );
      }
    }

    if (reasons.length > 0) {
      throw new ReturnNotEligibleError(reasons);
    }
  }

  static isEligible(
    input: Parameters<typeof ReturnEligibilityValidator.assertEligible>[0],
  ): boolean {
    try {
      this.assertEligible(input);
      return true;
    } catch {
      return false;
    }
  }
}
