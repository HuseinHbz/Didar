import type { PaymentAttemptStatus } from '@iecp/types';

export class InvalidPaymentAttemptTransitionError extends Error {
  constructor(from: PaymentAttemptStatus, to: PaymentAttemptStatus) {
    super(`Cannot transition payment attempt from ${from} to ${to}`);
    this.name = 'InvalidPaymentAttemptTransitionError';
  }
}

/**
 * `INITIATED -> REDIRECTED -> RETURNED`, with `ABANDONED`/`EXPIRED`
 * reachable from either non-terminal state (ADR-008 decision 2) — the
 * `checkout_expiration`-style sweep this module's own BullMQ queue runs
 * detects an attempt whose customer never returned and marks it
 * `ABANDONED`, or whose `providerAuthority` outlived the gateway's own
 * TTL and marks it `EXPIRED`. `RETURNED` is terminal for the attempt
 * itself — what happens next (verify, transaction, intent status) is the
 * `PaymentIntent`/`PaymentTransaction` state machines' job, not this
 * one's.
 */
export class PaymentAttemptStateMachine {
  private static readonly GRAPH: Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]> = {
    INITIATED: ['REDIRECTED', 'ABANDONED', 'EXPIRED'],
    REDIRECTED: ['RETURNED', 'ABANDONED', 'EXPIRED'],
    RETURNED: [],
    ABANDONED: [],
    EXPIRED: [],
  };

  static isNoOp(from: PaymentAttemptStatus, to: PaymentAttemptStatus): boolean {
    return from === to;
  }

  static canTransition(from: PaymentAttemptStatus, to: PaymentAttemptStatus): boolean {
    return this.isNoOp(from, to) || this.GRAPH[from].includes(to);
  }

  static assertTransition(from: PaymentAttemptStatus, to: PaymentAttemptStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidPaymentAttemptTransitionError(from, to);
    }
  }
}
