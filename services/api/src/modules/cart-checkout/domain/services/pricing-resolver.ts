import type { PriceLineBreakdown } from '../entities/price-breakdown.types';

import { DiscountCalculator, type PricingAdjustmentInput } from './discount-calculator';
import { TaxCalculator } from './tax-calculator';

export class NegativeTotalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NegativeTotalError';
  }
}

export interface PricingLineInput {
  productSkuId: string;
  quantity: number;
  basePrice: bigint;
  taxRateBasisPoints: number | null;
}

export interface PricingResolutionInput {
  lines: readonly PricingLineInput[];
  /** Every discount to apply — the coupon-gated promotion (if any) plus
   * every automatic promotion, already resolved and ordered by the
   * `promotion` module's pure `PromotionResolver` (ADR-010 decision 5/7).
   * A single cart-wide coupon (Phase 007's original shape) is just one
   * `{ scope: 'CART' }` entry — a strict subset of this shape, so
   * existing callers' numbers are unchanged. */
  adjustments: readonly PricingAdjustmentInput[];
  /** True if any accepted promotion is `FREE_SHIPPING` (ADR-010 decision
   * 3) — zeroes `shippingCost` before the grand-total sum. */
  freeShipping: boolean;
  defaultTaxRateBasisPoints: number;
  shippingCost: bigint;
}

export interface PricingResolution {
  lines: PriceLineBreakdown[];
  subtotal: bigint;
  discountTotal: bigint;
  taxTotal: bigint;
  shippingTotal: bigint;
  grandTotal: bigint;
}

/**
 * The one place base_price -> resolved_unit_price -> discount -> tax ->
 * shipping -> subtotal -> grand_total actually happens (the brief's exact
 * `pricing_engine.outputs` list) — pure, deterministic, zero I/O. Every
 * caller (cart price preview, checkout price recalculation) goes through
 * this same function, so "server-side" and "reproducible" are structural
 * properties, not conventions someone has to remember to follow.
 *
 * Order of operations: subtotal (sum of base_price * quantity) -> discount
 * (every accepted `PricingAdjustmentInput` — one coupon plus any number of
 * automatic promotions, already resolved and calculation-ordered by the
 * `promotion` module's pure `PromotionResolver`, ADR-010 decision 5/7 —
 * summed and allocated per line via `DiscountCalculator.applyAdjustments`)
 * -> tax (per line, on the *post-discount* amount, `TaxCalculator`) ->
 * shipping (a flat total, resolved by the caller via `ShippingCalculator`
 * and passed in already-computed, zeroed if `freeShipping`) -> grand
 * total. Never negative — a discount
 * larger than the subtotal is a bug in `DiscountCalculator` (which already
 * caps it), not something this function silently tolerates; it asserts
 * rather than trusts.
 */
export class PricingResolver {
  static resolve(input: PricingResolutionInput): PricingResolution {
    const lineSubtotals = input.lines.map((line) => line.basePrice * BigInt(line.quantity));
    const subtotal = lineSubtotals.reduce((sum, value) => sum + value, 0n);

    const perLineDiscount = DiscountCalculator.applyAdjustments(
      input.lines.map((line, index) => ({
        productSkuId: line.productSkuId,
        lineSubtotal: lineSubtotals[index] ?? 0n,
      })),
      input.adjustments,
    );
    const discountTotal = [...perLineDiscount.values()].reduce((sum, value) => sum + value, 0n);

    const lines: PriceLineBreakdown[] = input.lines.map((line, index) => {
      const lineSubtotal = lineSubtotals[index] ?? 0n;
      const lineDiscount = perLineDiscount.get(line.productSkuId) ?? 0n;
      const taxRateBasisPoints = TaxCalculator.effectiveRate(
        line.taxRateBasisPoints,
        input.defaultTaxRateBasisPoints,
      );
      const taxableAmount = lineSubtotal - lineDiscount;
      const lineTax = TaxCalculator.calculateLineTax(taxableAmount, taxRateBasisPoints);
      return {
        productSkuId: line.productSkuId,
        quantity: line.quantity,
        basePrice: line.basePrice,
        resolvedUnitPrice:
          line.quantity > 0 ? (lineSubtotal - lineDiscount) / BigInt(line.quantity) : 0n,
        lineDiscount,
        lineTax,
        lineSubtotal,
        taxRateBasisPoints,
      };
    });

    const taxTotal = lines.reduce((sum, line) => sum + line.lineTax, 0n);
    const shippingTotal = input.freeShipping ? 0n : input.shippingCost;
    const grandTotal = subtotal - discountTotal + taxTotal + shippingTotal;

    if (
      subtotal < 0n ||
      discountTotal < 0n ||
      taxTotal < 0n ||
      shippingTotal < 0n ||
      grandTotal < 0n
    ) {
      throw new NegativeTotalError('Pricing resolution produced a negative total');
    }

    return { lines, subtotal, discountTotal, taxTotal, shippingTotal, grandTotal };
  }
}
