import type { CheckoutStatus } from '@iecp/types';

export class InvalidCheckoutTransitionError extends Error {
  constructor(from: CheckoutStatus, to: CheckoutStatus) {
    super(`Cannot transition checkout session from ${from} to ${to}`);
    this.name = 'InvalidCheckoutTransitionError';
  }
}

/**
 * `OPEN -> VALIDATING -> READY_FOR_PAYMENT`, with `EXPIRED`/`CANCELLED`
 * reachable from any non-terminal state and `CONVERTED` reachable only
 * from `READY_FOR_PAYMENT` (a future payment/order phase's exit point —
 * ADR-007 decision 1). Idempotent by design where the brief asks for it:
 * calling a transition that would land on the session's *current* status
 * is a no-op (returns true) rather than an error — cancelling an
 * already-`CANCELLED` session, for instance, is not a bug to reject.
 */
export class CheckoutStateMachine {
  private static readonly GRAPH: Record<CheckoutStatus, readonly CheckoutStatus[]> = {
    OPEN: ['VALIDATING', 'EXPIRED', 'CANCELLED'],
    VALIDATING: ['OPEN', 'READY_FOR_PAYMENT', 'EXPIRED', 'CANCELLED'],
    READY_FOR_PAYMENT: ['CONVERTED', 'EXPIRED', 'CANCELLED'],
    EXPIRED: [],
    CANCELLED: [],
    CONVERTED: [],
  };

  static isNoOp(from: CheckoutStatus, to: CheckoutStatus): boolean {
    return from === to;
  }

  static canTransition(from: CheckoutStatus, to: CheckoutStatus): boolean {
    return this.isNoOp(from, to) || this.GRAPH[from].includes(to);
  }

  static assertTransition(from: CheckoutStatus, to: CheckoutStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidCheckoutTransitionError(from, to);
    }
  }
}
