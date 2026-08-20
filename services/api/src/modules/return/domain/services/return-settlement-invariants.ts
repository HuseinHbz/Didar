/**
 * ADR-013 decision 10 — the two settlement-specific invariants that are
 * genuine domain-data problems, never transient: thrown by
 * `ReturnSettlementService` (application layer) when it discovers one,
 * always mapped to `FAILED_TERMINAL`, never auto-retried. Both are pure
 * assertions, zero I/O — same "small validator, static assert methods,
 * its own error classes" shape `ReturnQuantityValidator`/
 * `RefundValidator` already established.
 */
export class MissingImmutableSnapshotError extends Error {
  constructor(returnItemId: string, missingField: string) {
    super(
      `ReturnItem ${returnItemId} is missing its own required snapshot field (${missingField}) — cannot compute settlement`,
    );
    this.name = 'MissingImmutableSnapshotError';
  }
}

export class NonPositiveRestockQuantityError extends Error {
  constructor(returnItemId: string, quantity: number) {
    super(`Cannot restock a non-positive quantity (${quantity}) for return item ${returnItemId}`);
    this.name = 'NonPositiveRestockQuantityError';
  }
}

export class ReturnSettlementInvariants {
  /** Every field a restock/settlement step reads from `OrderItem`'s own
   * immutable snapshot must actually be present — a null here means the
   * historical data itself is corrupted (e.g. `productSkuId` missing on
   * a line the catalog SKU was later deleted from, discovered only when
   * actually trying to restock it), not something a retry can fix. */
  static assertSnapshotPresent<T>(
    value: T | null | undefined,
    returnItemId: string,
    fieldName: string,
  ): T {
    if (value === null || value === undefined) {
      throw new MissingImmutableSnapshotError(returnItemId, fieldName);
    }
    return value;
  }

  static assertPositiveRestockQuantity(returnItemId: string, quantity: number): void {
    if (quantity <= 0) {
      throw new NonPositiveRestockQuantityError(returnItemId, quantity);
    }
  }
}
