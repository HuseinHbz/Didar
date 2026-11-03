import type { RefundStatus } from '@iecp/types';

export class InvalidRefundTransitionError extends Error {
  constructor(from: RefundStatus, to: RefundStatus) {
    super(`Cannot transition refund from ${from} to ${to}`);
    this.name = 'InvalidRefundTransitionError';
  }
}

/** A refund can be sent to the provider by exactly one caller, once (CP-031).
 * Thrown to every other caller — a concurrent request that lost the claim, or
 * a later one that finds the refund already `PROCESSING` — so nothing is sent a
 * second time. Not an illegal *transition* (the refund is where it should be);
 * it is a conflict with work already in flight, hence its own type and a 409. */
export class RefundAlreadyProcessingError extends Error {
  constructor(
    public readonly refundId: string,
    public readonly status: string,
  ) {
    super(
      `Refund ${refundId} has already been picked up for processing (status: ${status}); ` +
        `it will not be sent to the payment provider a second time.`,
    );
    this.name = 'RefundAlreadyProcessingError';
  }
}

/**
 * `PENDING -> PROCESSING -> {COMPLETED|FAILED|REJECTED}` (ADR-008
 * decision 6) — `PROCESSING` is "submitted to the provider adapter's
 * `refundPayment()`"; `COMPLETED` is provider-confirmed, `FAILED` is a
 * retryable transport/technical failure, `REJECTED` is the provider's own
 * business decline. `RefundValidator`'s amount guard runs before a
 * `Refund` row is ever created, so there is no `PENDING -> REJECTED`
 * edge here — a refund that fails validation is never persisted at all.
 */
export class RefundStateMachine {
  private static readonly GRAPH: Record<RefundStatus, readonly RefundStatus[]> = {
    PENDING: ['PROCESSING'],
    PROCESSING: ['COMPLETED', 'FAILED', 'REJECTED'],
    COMPLETED: [],
    FAILED: [],
    REJECTED: [],
  };

  static isNoOp(from: RefundStatus, to: RefundStatus): boolean {
    return from === to;
  }

  static canTransition(from: RefundStatus, to: RefundStatus): boolean {
    return this.isNoOp(from, to) || this.GRAPH[from].includes(to);
  }

  static assertTransition(from: RefundStatus, to: RefundStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidRefundTransitionError(from, to);
    }
  }
}
