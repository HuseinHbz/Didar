/** Thrown whenever a computed quantity bucket would go negative — the
 * database has no CHECK constraint for this (ADR-006 decision 3), so this
 * is the actual enforcement point, always called before a write. */
export class InsufficientStockError extends Error {
  constructor(
    public readonly bucket: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(`Insufficient ${bucket}: requested ${requested}, available ${available}`);
    this.name = 'InsufficientStockError';
  }
}

export interface QuantitySnapshot {
  onHandQuantity: number;
  reservedQuantity: number;
  inTransitQuantity: number;
  damagedQuantity: number;
  quarantinedQuantity: number;
  blockedQuantity: number;
}

/**
 * The brief's own authoritative formula: `available = on_hand - reserved -
 * damaged - quarantined - blocked`. Pure, no I/O — called by the
 * infrastructure layer inside the same row-locked transaction that writes
 * the mutation, never trusted as already-correct input (ADR-006 decision 2).
 */
export class AvailableQuantityCalculator {
  static compute(snapshot: QuantitySnapshot): number {
    return (
      snapshot.onHandQuantity -
      snapshot.reservedQuantity -
      snapshot.damagedQuantity -
      snapshot.quarantinedQuantity -
      snapshot.blockedQuantity
    );
  }

  /** Throws `InsufficientStockError` if the computed available quantity for
   * this snapshot would be negative — the one place this invariant is
   * actually enforced (ADR-006 decision 3). */
  static assertNonNegative(snapshot: QuantitySnapshot): number {
    const available = AvailableQuantityCalculator.compute(snapshot);
    if (available < 0) {
      throw new InsufficientStockError('available_quantity', 0, available);
    }
    return available;
  }
}
