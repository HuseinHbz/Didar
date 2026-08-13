import type { PaymentIntentStatus } from '@iecp/types';

export class InvalidPaymentIntentTransitionError extends Error {
  constructor(from: PaymentIntentStatus, to: PaymentIntentStatus) {
    super(`Cannot transition payment intent from ${from} to ${to}`);
    this.name = 'InvalidPaymentIntentTransitionError';
  }
}

/**
 * `CREATED -> AWAITING_PAYMENT -> PROCESSING -> {SUCCEEDED|FAILED|EXPIRED|
 * CANCELLED}` (ADR-008 decision 2), with one deliberate back edge:
 * `FAILED -> AWAITING_PAYMENT`, so a failed attempt can be retried with a
 * new `PaymentAttempt` without ever needing a second `PaymentIntent`
 * (ADR-008 consequences — "a payment can be retried ... without ever
 * risking a duplicate charge"). `SUCCEEDED` is strictly terminal, same
 * "verified state never regresses" discipline `PaymentTransaction` itself
 * enforces one level down. Same no-op-is-not-an-error convention as
 * `CheckoutStateMachine`.
 */
export class PaymentIntentStateMachine {
  private static readonly GRAPH: Record<PaymentIntentStatus, readonly PaymentIntentStatus[]> = {
    CREATED: ['AWAITING_PAYMENT', 'CANCELLED', 'EXPIRED'],
    AWAITING_PAYMENT: ['PROCESSING', 'FAILED', 'CANCELLED', 'EXPIRED'],
    PROCESSING: ['SUCCEEDED', 'FAILED'],
    SUCCEEDED: [],
    FAILED: ['AWAITING_PAYMENT'],
    EXPIRED: [],
    CANCELLED: [],
  };

  static isNoOp(from: PaymentIntentStatus, to: PaymentIntentStatus): boolean {
    return from === to;
  }

  static canTransition(from: PaymentIntentStatus, to: PaymentIntentStatus): boolean {
    return this.isNoOp(from, to) || this.GRAPH[from].includes(to);
  }

  static assertTransition(from: PaymentIntentStatus, to: PaymentIntentStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidPaymentIntentTransitionError(from, to);
    }
  }
}
