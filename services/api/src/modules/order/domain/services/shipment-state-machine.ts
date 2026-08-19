import type { ShipmentStatus } from '@iecp/types';

export class InvalidShipmentTransitionError extends Error {
  constructor(from: ShipmentStatus, to: ShipmentStatus) {
    super(`Cannot transition shipment from ${from} to ${to}`);
    this.name = 'InvalidShipmentTransitionError';
  }
}

/** `PENDING -> IN_TRANSIT -> {DELIVERED|FAILED}`, with `CANCELLED`
 * reachable from `PENDING` only (ADR-009 decision 12). */
export class ShipmentStateMachine {
  private static readonly GRAPH: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
    PENDING: ['IN_TRANSIT', 'CANCELLED'],
    IN_TRANSIT: ['DELIVERED', 'FAILED'],
    DELIVERED: [],
    FAILED: [],
    CANCELLED: [],
  };

  static isNoOp(from: ShipmentStatus, to: ShipmentStatus): boolean {
    return from === to;
  }

  static canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
    return this.isNoOp(from, to) || this.GRAPH[from].includes(to);
  }

  static assertTransition(from: ShipmentStatus, to: ShipmentStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidShipmentTransitionError(from, to);
    }
  }
}
