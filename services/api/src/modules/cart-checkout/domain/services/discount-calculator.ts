/**
 * Deterministic, floor-rounded, remainder-to-last-line proportional
 * allocation — the one rounding rule this module (and, since Phase 010,
 * the `promotion` module's own `DiscountEngine`) always uses so a set of
 * per-line pieces always sums exactly to their total, never off by a few
 * Rial from naive independent per-line rounding.
 *
 * Phase 010 (ADR-010 decision 7) extended this file in place rather than
 * duplicating it: the single-coupon `CouponRule`/`calculateTotalDiscount`
 * shape this file used to own is now a strict subset of
 * `PricingAdjustmentInput` below — the promotion module's pure
 * `EligibilityEngine`/`DiscountEngine`/`PromotionResolver` compute *what*
 * discount applies (including the old single-coupon case), and this file
 * only ever allocates an already-decided total across cart lines.
 * `CouponNotApplicableError` also moved with that logic — it now lives in
 * `modules/promotion/domain/errors/promotion-domain.errors.ts`, thrown by
 * `PromotionResolutionService`/`CartPricingService.previewCouponDiscount()`,
 * never redefined here.
 */

/** One already-resolved discount to apply — `scope: 'CART'` allocates
 * proportionally across every line (the old single-coupon shape);
 * `scope: { productSkuIds }` allocates only across the named lines
 * (item-targeted promotions, ADR-010 decision 4/7). `amount` is already
 * capped/validated by the caller (the promotion module's `DiscountEngine`
 * for a promotion, or the legacy coupon path) — this class never
 * re-derives it. */
export interface PricingAdjustmentInput {
  scope: 'CART' | { productSkuIds: readonly string[] };
  amount: bigint;
}

export class DiscountCalculator {
  static allocateByLineShare(
    totalDiscount: bigint,
    lines: readonly { lineSubtotal: bigint }[],
    cartSubtotal: bigint,
  ): bigint[] {
    if (cartSubtotal === 0n || lines.length === 0) return lines.map(() => 0n);
    const allocations = lines.map((line) => (totalDiscount * line.lineSubtotal) / cartSubtotal);
    const allocatedSum = allocations.reduce((sum, value) => sum + value, 0n);
    const remainder = totalDiscount - allocatedSum;
    if (remainder !== 0n && allocations.length > 0) {
      allocations[allocations.length - 1] = (allocations[allocations.length - 1] ?? 0n) + remainder;
    }
    return allocations;
  }

  /** Same rounding rule as `allocateByLineShare`, generalized to an
   * arbitrary named subset of lines (by `productSkuId`) rather than
   * every line — the allocator item-targeted `PricingAdjustmentInput`s
   * use. */
  static allocateByProductSkuId(
    totalDiscount: bigint,
    lines: readonly { productSkuId: string; lineSubtotal: bigint }[],
  ): Map<string, bigint> {
    const result = new Map<string, bigint>();
    const total = lines.reduce((sum, line) => sum + line.lineSubtotal, 0n);
    if (total === 0n || lines.length === 0) {
      for (const line of lines) result.set(line.productSkuId, 0n);
      return result;
    }
    let allocated = 0n;
    lines.forEach((line, index) => {
      const share =
        index === lines.length - 1
          ? totalDiscount - allocated
          : (totalDiscount * line.lineSubtotal) / total;
      result.set(line.productSkuId, (result.get(line.productSkuId) ?? 0n) + share);
      allocated += share;
    });
    return result;
  }

  /** Applies every adjustment against `lines`, in the order given
   * (calculation order is already decided by the caller — the promotion
   * module's `PromotionResolver`, ADR-010 decision 5), returning the
   * total per-line discount summed across every adjustment. */
  static applyAdjustments(
    lines: readonly { productSkuId: string; lineSubtotal: bigint }[],
    adjustments: readonly PricingAdjustmentInput[],
  ): Map<string, bigint> {
    const perLine = new Map<string, bigint>(lines.map((line) => [line.productSkuId, 0n]));
    for (const adjustment of adjustments) {
      const targeted =
        adjustment.scope === 'CART'
          ? lines
          : lines.filter(
              (line) =>
                adjustment.scope !== 'CART' &&
                adjustment.scope.productSkuIds.includes(line.productSkuId),
            );
      const allocation = this.allocateByProductSkuId(adjustment.amount, targeted);
      for (const [productSkuId, amount] of allocation) {
        perLine.set(productSkuId, (perLine.get(productSkuId) ?? 0n) + amount);
      }
    }
    return perLine;
  }
}
