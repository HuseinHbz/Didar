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
   * actually enforced (ADR-006 decision 3).
   *
   * CP-031 — every *stored* bucket must be non-negative too, not just the
   * derived `available`. `available` is a signed sum, so two wrong buckets
   * can cancel out: a double-applied `convert` took `reservedQuantity` and
   * `onHandQuantity` negative together and `available` still read as a
   * healthy positive number — phantom stock nothing could see. A negative
   * bucket is never a legitimate state (you cannot have −1 units reserved),
   * so it is refused at the same choke point, before any write. */
  static assertNonNegative(snapshot: QuantitySnapshot): number {
    for (const [bucket, value] of AvailableQuantityCalculator.buckets(snapshot)) {
      if (value < 0) {
        throw new InsufficientStockError(bucket, 0, value);
      }
    }
    const available = AvailableQuantityCalculator.compute(snapshot);
    if (available < 0) {
      throw new InsufficientStockError('available_quantity', 0, available);
    }
    return available;
  }

  private static buckets(snapshot: QuantitySnapshot): readonly (readonly [string, number])[] {
    return [
      ['on_hand_quantity', snapshot.onHandQuantity],
      ['reserved_quantity', snapshot.reservedQuantity],
      ['in_transit_quantity', snapshot.inTransitQuantity],
      ['damaged_quantity', snapshot.damagedQuantity],
      ['quarantined_quantity', snapshot.quarantinedQuantity],
      ['blocked_quantity', snapshot.blockedQuantity],
    ];
  }
}
