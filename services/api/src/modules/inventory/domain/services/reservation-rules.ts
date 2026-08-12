import {
  AvailableQuantityCalculator,
  InsufficientStockError,
  type QuantitySnapshot,
} from './available-quantity-calculator';

export { InsufficientStockError };

/** Thrown when a release/convert targets more than what's actually
 * reserved, or targets a reservation that's no longer ACTIVE. */
export class InvalidReservationOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReservationOperationError';
  }
}

/**
 * Pure business rules for reserve/release/convert — no I/O, no Prisma.
 * The infrastructure layer calls these from inside a row-locked
 * transaction (`SELECT ... FOR UPDATE` on the target `InventoryItem`),
 * feeding it the just-locked snapshot, so two concurrent callers can never
 * both compute "this is still allowed" from a stale read
 * (ADR-006 decisions 3-4 — the concurrency test in this module's README
 * is the actual proof, not this file alone).
 */
export class ReservationRules {
  /** Reserving `quantity` more units is only allowed if doing so keeps
   * `available_quantity >= 0` — computed from the *current* locked
   * snapshot, not the caller's belief about it. */
  static assertCanReserve(current: QuantitySnapshot, quantity: number): void {
    if (quantity <= 0) {
      throw new InvalidReservationOperationError(
        `Reservation quantity must be positive, got ${quantity}`,
      );
    }
    const projected: QuantitySnapshot = {
      ...current,
      reservedQuantity: current.reservedQuantity + quantity,
    };
    AvailableQuantityCalculator.assertNonNegative(projected);
  }

  /** A release can never take `reservedQuantity` below zero — releasing
   * more than is currently reserved is a bug in the caller, not a valid
   * "release everything" shortcut. */
  static assertCanRelease(current: QuantitySnapshot, quantity: number): void {
    if (quantity <= 0) {
      throw new InvalidReservationOperationError(
        `Release quantity must be positive, got ${quantity}`,
      );
    }
    if (quantity > current.reservedQuantity) {
      throw new InvalidReservationOperationError(
        `Cannot release ${quantity} units — only ${current.reservedQuantity} reserved`,
      );
    }
  }

  /** Converting a reservation to a sale removes the same quantity from
   * both `reservedQuantity` and `onHandQuantity` (the unit physically
   * leaves the warehouse) — same "don't release more than reserved" guard. */
  static assertCanConvert(current: QuantitySnapshot, quantity: number): void {
    ReservationRules.assertCanRelease(current, quantity);
    if (quantity > current.onHandQuantity) {
      throw new InvalidReservationOperationError(
        `Cannot convert ${quantity} units — only ${current.onHandQuantity} on hand`,
      );
    }
  }
}
