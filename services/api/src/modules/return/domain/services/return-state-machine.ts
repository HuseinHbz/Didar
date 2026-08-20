import type { ReturnStatus } from '@iecp/types';

export class InvalidReturnTransitionError extends Error {
  constructor(from: ReturnStatus, to: ReturnStatus) {
    super(`Cannot transition return from ${from} to ${to}`);
    this.name = 'InvalidReturnTransitionError';
  }
}

/**
 * The 10-state lifecycle ADR-012 decision 1 defines:
 *
 * `REQUESTED -> APPROVED -> CUSTOMER_SHIPPING -> RECEIVED -> INSPECTING
 * -> APPROVED_FOR_REFUND -> REFUNDED -> COMPLETED`, with `REJECTED`
 * reachable from `REQUESTED`/`APPROVED`/`INSPECTING` (an admin can
 * decline before shipping, or the physical goods can fail inspection —
 * both real outcomes, never reachable once `APPROVED_FOR_REFUND`) and
 * `CANCELLED` reachable from `REQUESTED`/`APPROVED`/`CUSTOMER_SHIPPING`
 * only (the customer's own withdrawal option, gone once the warehouse
 * has physically received the goods). `REJECTED`/`CANCELLED`/
 * `COMPLETED` are strictly terminal. Same no-op-is-not-an-error
 * convention every other state machine in this repo uses.
 */
export class ReturnStateMachine {
  private static readonly GRAPH: Record<ReturnStatus, readonly ReturnStatus[]> = {
    REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
    APPROVED: ['CUSTOMER_SHIPPING', 'REJECTED', 'CANCELLED'],
    CUSTOMER_SHIPPING: ['RECEIVED', 'CANCELLED'],
    RECEIVED: ['INSPECTING'],
    INSPECTING: ['APPROVED_FOR_REFUND', 'REJECTED'],
    APPROVED_FOR_REFUND: ['REFUNDED'],
    REFUNDED: ['COMPLETED'],
    COMPLETED: [],
    REJECTED: [],
    CANCELLED: [],
  };

  static isNoOp(from: ReturnStatus, to: ReturnStatus): boolean {
    return from === to;
  }

  static canTransition(from: ReturnStatus, to: ReturnStatus): boolean {
    return this.isNoOp(from, to) || this.GRAPH[from].includes(to);
  }

  static assertTransition(from: ReturnStatus, to: ReturnStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidReturnTransitionError(from, to);
    }
  }

  /** Whether `status` can still be cancelled at all — exposed directly
   * so callers (e.g. `ReturnService.cancel()`) don't have to spell out
   * `canTransition(status, 'CANCELLED')` themselves, same convention
   * `OrderStateMachine.isCancellable()` established. */
  static isCancellable(status: ReturnStatus): boolean {
    return this.canTransition(status, 'CANCELLED') && status !== 'CANCELLED';
  }
}
