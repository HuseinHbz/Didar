import type { PurchaseOrderStatus } from '@iecp/types';

/** Thrown by `assertTransition`/`assertCanReceive` — the presentation
 * layer maps this to a 409. */
export class InvalidPurchaseOrderTransitionError extends Error {
  constructor(
    public readonly from: PurchaseOrderStatus,
    public readonly to: PurchaseOrderStatus,
  ) {
    super(`Cannot transition purchase order from ${from} to ${to}`);
    this.name = 'InvalidPurchaseOrderTransitionError';
  }
}

/**
 * The 6-state Purchase Order graph — same "pure, no I/O" shape
 * `TransferStateMachine` established. `create()` writes the row directly
 * in `SUBMITTED` (mirroring `StockTransfer.create()`'s own choice to
 * skip a persisted `DRAFT` row — see `PURCHASE_ORDER_STATUSES`' own doc
 * comment in packages/types), so `DRAFT` here is the conceptual starting
 * point `assertTransition('DRAFT', 'SUBMITTED')` asserts against, never
 * a value actually read back from a stored row.
 *
 * Receiving is deliberately NOT modeled as a simple `canTransition`
 * lookup: a real supplier shipment rarely completes in one delivery, so
 * `receive()` can be called more than once against the same order while
 * it's `APPROVED` or already `PARTIALLY_RECEIVED`, and which of
 * `PARTIALLY_RECEIVED`/`RECEIVED` it lands on depends on whether *every*
 * line item is now fully received — a fact only the application layer
 * (which has the line items) can compute. `assertCanReceive` guards the
 * starting state; `nextStatusAfterReceipt` computes the destination.
 */
export class PurchaseOrderStateMachine {
  private static readonly TRANSITIONS: Readonly<
    Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]>
  > = {
    DRAFT: ['SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['APPROVED', 'CANCELLED'],
    APPROVED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
    PARTIALLY_RECEIVED: ['RECEIVED'],
    RECEIVED: [],
    CANCELLED: [],
  };

  static canTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
    return PurchaseOrderStateMachine.TRANSITIONS[from].includes(to);
  }

  static assertTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): void {
    if (!PurchaseOrderStateMachine.canTransition(from, to)) {
      throw new InvalidPurchaseOrderTransitionError(from, to);
    }
  }

  /** A purchase order can only receive stock while `APPROVED` or
   * `PARTIALLY_RECEIVED` — never `SUBMITTED` (not yet approved),
   * `RECEIVED`/`CANCELLED` (terminal). */
  static assertCanReceive(status: PurchaseOrderStatus): void {
    if (status !== 'APPROVED' && status !== 'PARTIALLY_RECEIVED') {
      throw new InvalidPurchaseOrderTransitionError(status, 'PARTIALLY_RECEIVED');
    }
  }

  /** `allLinesFullyReceived` is computed by the caller from the *current*
   * `PurchaseOrderItem.receivedQuantity` vs `orderedQuantity` for every
   * line, after this receipt's quantities have been applied. */
  static nextStatusAfterReceipt(allLinesFullyReceived: boolean): 'RECEIVED' | 'PARTIALLY_RECEIVED' {
    return allLinesFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
  }

  /** Cancellation is only allowed before any physical stock has moved —
   * the same "once something real happened, it's a new inverse
   * operation, not a status flip" rule `StockTransfer` enforces past
   * `DISPATCHED`. Reachable from every pre-receiving state. */
  static canCancel(status: PurchaseOrderStatus): boolean {
    return status === 'DRAFT' || status === 'SUBMITTED' || status === 'APPROVED';
  }

  static assertCanCancel(status: PurchaseOrderStatus): void {
    if (!PurchaseOrderStateMachine.canCancel(status)) {
      throw new InvalidPurchaseOrderTransitionError(status, 'CANCELLED');
    }
  }
}
