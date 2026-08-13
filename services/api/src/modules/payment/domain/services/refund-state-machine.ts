import type { RefundStatus } from '@iecp/types';

export class InvalidRefundTransitionError extends Error {
  constructor(from: RefundStatus, to: RefundStatus) {
    super(`Cannot transition refund from ${from} to ${to}`);
    this.name = 'InvalidRefundTransitionError';
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
