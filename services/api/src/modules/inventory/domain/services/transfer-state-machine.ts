import type { StockTransferStatus } from '@iecp/types';

/** Thrown by `assertTransition` — the presentation layer maps this to a 409. */
export class InvalidTransferTransitionError extends Error {
  constructor(
    public readonly from: StockTransferStatus,
    public readonly to: StockTransferStatus,
  ) {
    super(`Cannot transition transfer from ${from} to ${to}`);
    this.name = 'InvalidTransferTransitionError';
  }
}

/**
 * The brief's exact 9-state transfer graph. Pure, no I/O — the application
 * layer loads the current `StockTransfer.status`, calls
 * `assertTransition`, and only then writes. `CANCELLED` is reachable from
 * every pre-dispatch state (nothing to physically undo yet); once
 * `DISPATCHED`, cancelling requires an inverse transfer instead, so it's
 * no longer a status transition on this same record.
 */
export class TransferStateMachine {
  private static readonly TRANSITIONS: Readonly<
    Record<StockTransferStatus, readonly StockTransferStatus[]>
  > = {
    DRAFT: ['REQUESTED', 'CANCELLED'],
    REQUESTED: ['APPROVED', 'CANCELLED'],
    APPROVED: ['PICKING', 'CANCELLED'],
    PICKING: ['DISPATCHED', 'CANCELLED'],
    DISPATCHED: ['IN_TRANSIT'],
    IN_TRANSIT: ['PARTIALLY_RECEIVED', 'RECEIVED'],
    PARTIALLY_RECEIVED: ['RECEIVED'],
    RECEIVED: [],
    CANCELLED: [],
  };

  static canTransition(from: StockTransferStatus, to: StockTransferStatus): boolean {
    return TransferStateMachine.TRANSITIONS[from].includes(to);
  }

  static assertTransition(from: StockTransferStatus, to: StockTransferStatus): void {
    if (!TransferStateMachine.canTransition(from, to)) {
      throw new InvalidTransferTransitionError(from, to);
    }
  }
}
