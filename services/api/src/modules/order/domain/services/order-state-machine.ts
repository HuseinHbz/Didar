import type { OrderStatus } from '@iecp/types';

export class InvalidOrderTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Cannot transition order from ${from} to ${to}`);
    this.name = 'InvalidOrderTransitionError';
  }
}

/**
 * The 8-state lifecycle ADR-009 decision 5 defines:
 *
 * `PENDING_PAYMENT -> PAID -> PROCESSING -> READY_TO_FULFILL ->
 * {PARTIALLY_FULFILLED -> FULFILLED | FULFILLED} -> COMPLETED`, with
 * `CANCELLED` reachable from `PENDING_PAYMENT`/`PAID`/`PROCESSING`/
 * `READY_TO_FULFILL` only — never from `PARTIALLY_FULFILLED`/`FULFILLED`/
 * `COMPLETED` (the brief's own explicit examples: a shipped order must not
 * simply become CANCELLED, a delivered order must not be cancelled;
 * extended conservatively to PARTIALLY_FULFILLED since physical goods are
 * already moving once even one Fulfillment exists). `CANCELLED`/
 * `COMPLETED` are strictly terminal. Same no-op-is-not-an-error convention
 * every other state machine in this repo uses.
 */
export class OrderStateMachine {
  private static readonly GRAPH: Record<OrderStatus, readonly OrderStatus[]> = {
    PENDING_PAYMENT: ['PAID', 'CANCELLED'],
    PAID: ['PROCESSING', 'CANCELLED'],
    PROCESSING: ['READY_TO_FULFILL', 'CANCELLED'],
    READY_TO_FULFILL: ['PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED'],
    PARTIALLY_FULFILLED: ['FULFILLED'],
    FULFILLED: ['COMPLETED'],
    CANCELLED: [],
    COMPLETED: [],
  };

  static isNoOp(from: OrderStatus, to: OrderStatus): boolean {
    return from === to;
  }

  static canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return this.isNoOp(from, to) || this.GRAPH[from].includes(to);
  }

  static assertTransition(from: OrderStatus, to: OrderStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidOrderTransitionError(from, to);
    }
  }

  /** Whether `status` can still be cancelled at all — the same rule
   * `GRAPH`'s own `CANCELLED` edges encode, exposed directly so callers
   * (e.g. `OrderService.cancel()`) don't have to spell out
   * `canTransition(status, 'CANCELLED')` themselves. */
  static isCancellable(status: OrderStatus): boolean {
    return this.canTransition(status, 'CANCELLED') && status !== 'CANCELLED';
  }
}
