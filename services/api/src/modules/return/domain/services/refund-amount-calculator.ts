/**
 * Refund/credit-note amounts must be derived entirely from an
 * `OrderItem`'s own immutable historical snapshot — never the live
 * catalog, never `OrderPromotion` (read only for display, see ADR-012
 * decision 4), never a client-supplied total. `OrderItem.lineTotal` is
 * the *pre*-discount, *pre*-tax subtotal (`basePrice * quantity`, see
 * `PricingResolver.resolve()`); the real amount actually paid for the
 * line is `lineTotal - discountAmount + taxAmount` — that figure is what
 * this calculator allocates, never `lineTotal` alone.
 *
 * Pure, zero I/O, deterministic. The caller supplies every input; this
 * class never fetches anything itself.
 */
export class RefundAmountCalculator {
  /** The real amount actually paid for one `OrderItem` line — every
   * unit's promotion/discount/tax already baked in by the pricing
   * pipeline at order-creation time. */
  static lineTotalPayable(lineTotal: bigint, discountAmount: bigint, taxAmount: bigint): bigint {
    return lineTotal - discountAmount + taxAmount;
  }

  /**
   * Deterministic per-unit slot amounts for one line's total payable
   * amount — floor-divided, with the remainder assigned to the *first*
   * `remainder` slots (by ordinal position), the same "floor-rounded,
   * deterministic remainder allocation" family `DiscountCalculator`/
   * `TaxCalculator` already established elsewhere in this codebase, but
   * applied across *time* (successive partial returns of the same line)
   * rather than across sibling lines in one call. Because units are
   * fungible and always consumed in slot order (0, 1, 2, ...) as
   * returns accumulate against a line, summing every return ever made
   * against one `OrderItem`, in order, always equals this line's real
   * historical payable amount exactly — no rounding leakage across
   * multiple partial-return cycles.
   */
  static perUnitAmounts(totalPayable: bigint, quantity: number): bigint[] {
    if (quantity <= 0) return [];
    const base = totalPayable / BigInt(quantity);
    const remainder = totalPayable - base * BigInt(quantity);
    return Array.from({ length: quantity }, (_, index) =>
      BigInt(index) < remainder ? base + 1n : base,
    );
  }

  /** The refund amount for returning `returningQuantity` units of a
   * line, given how many units of that same line have already been
   * consumed by earlier (non-rejected/non-cancelled) returns. Slices
   * the deterministic per-unit slot array starting at
   * `alreadyReturnedQuantity` — the exact slots this request consumes,
   * so the running total across a line's whole lifetime of returns
   * never drifts from `lineTotalPayable()`. */
  static amountForReturnedUnits(
    totalPayable: bigint,
    orderedQuantity: number,
    alreadyReturnedQuantity: number,
    returningQuantity: number,
  ): bigint {
    const perUnit = this.perUnitAmounts(totalPayable, orderedQuantity);
    return perUnit
      .slice(alreadyReturnedQuantity, alreadyReturnedQuantity + returningQuantity)
      .reduce((sum, value) => sum + value, 0n);
  }

  /**
   * Whether an order's shipping charge should be included in a return's
   * refund — only when the return, combined with every prior non-
   * rejected/non-cancelled return against the same order, would leave
   * zero remaining returnable quantity across every line (a real,
   * documented business-rule choice, ADR-012 decision 4: shipping is
   * refunded on a full-order return only, never a share of it on a
   * partial one).
   */
  static isFullOrderReturn(
    lines: readonly { orderedQuantity: number; returnedQuantityAfterThisRequest: number }[],
  ): boolean {
    if (lines.length === 0) return false;
    return lines.every((line) => line.returnedQuantityAfterThisRequest >= line.orderedQuantity);
  }
}
