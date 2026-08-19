import type { FulfillmentStatus } from '@iecp/types';

export class InvalidFulfillmentTransitionError extends Error {
  constructor(from: FulfillmentStatus, to: FulfillmentStatus) {
    super(`Cannot transition fulfillment from ${from} to ${to}`);
    this.name = 'InvalidFulfillmentTransitionError';
  }
}

/**
 * `PENDING -> ALLOCATED -> PROCESSING -> PACKED -> READY -> SHIPPED ->
 * DELIVERED` (ADR-009 decision 8), with `CANCELLED` reachable up through
 * `READY` only — never once `SHIPPED`/`DELIVERED` (same "physical reality"
 * rule `OrderStateMachine` applies one level up).
 */
export class FulfillmentStateMachine {
  private static readonly GRAPH: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
    PENDING: ['ALLOCATED', 'CANCELLED'],
    ALLOCATED: ['PROCESSING', 'CANCELLED'],
    PROCESSING: ['PACKED', 'CANCELLED'],
    PACKED: ['READY', 'CANCELLED'],
    READY: ['SHIPPED', 'CANCELLED'],
    SHIPPED: ['DELIVERED'],
    DELIVERED: [],
    CANCELLED: [],
  };

  static isNoOp(from: FulfillmentStatus, to: FulfillmentStatus): boolean {
    return from === to;
  }

  static canTransition(from: FulfillmentStatus, to: FulfillmentStatus): boolean {
    return this.isNoOp(from, to) || this.GRAPH[from].includes(to);
  }

  static assertTransition(from: FulfillmentStatus, to: FulfillmentStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidFulfillmentTransitionError(from, to);
    }
  }
}
