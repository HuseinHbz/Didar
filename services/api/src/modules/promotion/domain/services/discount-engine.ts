import { Money } from '@iecp/types';

import type { Promotion } from '../entities/promotion.entity';

export interface DiscountTargetLine {
  productSkuId: string;
  quantity: number;
  /** The line's *currently remaining* amount at this calculation step
   * (post every earlier-applied promotion in this same resolution,
   * ADR-010 decision 5) — never the original base price once an earlier
   * step has already discounted it. */
  remaining: bigint;
}

export interface DiscountResult {
  /** Total discount for this promotion, already capped by
   * `maximumDiscount` and never exceeding the targeted lines' remaining
   * total. Zero for `FREE_SHIPPING`. */
  totalDiscount: bigint;
  /** Per-`productSkuId` share of `totalDiscount` — floor-rounded,
   * remainder assigned to the last targeted line, so the sum always
   * equals `totalDiscount` to the Rial (same convention
   * `DiscountCalculator.allocateByLineShare` already established). */
  perLine: ReadonlyMap<string, bigint>;
  freeShipping: boolean;
}

/** Proportional allocation with floor rounding + remainder-to-last —
 * generalized from `DiscountCalculator.allocateByLineShare` to arbitrary
 * keys (not just array index), so both cart-checkout's coupon math and
 * this engine's per-type math share one rounding rule. */
function allocateProportional(
  total: bigint,
  lines: readonly { key: string; amount: bigint }[],
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  const sumAmount = lines.reduce((sum, line) => sum + line.amount, 0n);
  if (sumAmount === 0n || lines.length === 0) {
    for (const line of lines) result.set(line.key, 0n);
    return result;
  }
  let allocated = 0n;
  lines.forEach((line, index) => {
    const share =
      index === lines.length - 1 ? total - allocated : (total * line.amount) / sumAmount;
    result.set(line.key, (result.get(line.key) ?? 0n) + share);
    allocated += share;
  });
  return result;
}

function capDiscount(promotion: Promotion, raw: bigint, targetedTotal: bigint): bigint {
  let discount = raw < 0n ? 0n : raw;
  if (discount > targetedTotal) discount = targetedTotal;
  if (promotion.maximumDiscount !== null && discount > promotion.maximumDiscount) {
    discount = promotion.maximumDiscount;
  }
  return discount;
}

/**
 * ADR-010 decision 3 — pure per-type discount math, zero I/O. Each
 * function receives the targeted lines' *current* remaining amounts
 * (post-earlier-step, per ADR-010 decision 5) and the winning promotion,
 * and returns a capped, line-allocated result. `DiscountEngine.compute()`
 * dispatches by `promotion.discountType` — the one entry point
 * `PromotionResolver` calls.
 */
export class DiscountEngine {
  static compute(promotion: Promotion, targeted: readonly DiscountTargetLine[]): DiscountResult {
    switch (promotion.discountType) {
      case 'PERCENTAGE':
        return this.percentage(promotion, targeted);
      case 'FIXED_AMOUNT':
        return this.fixedAmount(promotion, targeted);
      case 'FIXED_PRICE':
        return this.fixedPrice(promotion, targeted, promotion.discountValue ?? 0n);
      case 'BUNDLE_PRICE':
        return this.fixedPrice(promotion, targeted, promotion.bundlePrice ?? 0n);
      case 'BUY_X_GET_Y':
        return this.buyXGetY(promotion, targeted);
      case 'FREE_SHIPPING':
        return { totalDiscount: 0n, perLine: new Map(), freeShipping: true };
      /* istanbul ignore next -- exhaustive switch, PromotionActionType has no other member */
      default:
        return { totalDiscount: 0n, perLine: new Map(), freeShipping: false };
    }
  }

  private static targetedTotal(targeted: readonly DiscountTargetLine[]): bigint {
    return targeted.reduce((sum, line) => sum + line.remaining, 0n);
  }

  private static percentage(
    promotion: Promotion,
    targeted: readonly DiscountTargetLine[],
  ): DiscountResult {
    const total = this.targetedTotal(targeted);
    const raw = Money.ofRial(total).applyBasisPoints(Number(promotion.discountValue ?? 0n)).amount;
    const totalDiscount = capDiscount(promotion, raw, total);
    const perLine = allocateProportional(
      totalDiscount,
      targeted.map((line) => ({ key: line.productSkuId, amount: line.remaining })),
    );
    return { totalDiscount, perLine, freeShipping: false };
  }

  private static fixedAmount(
    promotion: Promotion,
    targeted: readonly DiscountTargetLine[],
  ): DiscountResult {
    const total = this.targetedTotal(targeted);
    const totalDiscount = capDiscount(promotion, promotion.discountValue ?? 0n, total);
    const perLine = allocateProportional(
      totalDiscount,
      targeted.map((line) => ({ key: line.productSkuId, amount: line.remaining })),
    );
    return { totalDiscount, perLine, freeShipping: false };
  }

  private static fixedPrice(
    promotion: Promotion,
    targeted: readonly DiscountTargetLine[],
    forcedPrice: bigint,
  ): DiscountResult {
    const total = this.targetedTotal(targeted);
    const raw = total - forcedPrice;
    const totalDiscount = capDiscount(promotion, raw, total);
    const perLine = allocateProportional(
      totalDiscount,
      targeted.map((line) => ({ key: line.productSkuId, amount: line.remaining })),
    );
    return { totalDiscount, perLine, freeShipping: false };
  }

  /** Cheapest units first, per ADR-010 decision 3 — expands targeted
   * lines into individual per-unit remaining amounts, sorts ascending,
   * and marks the first `getQuantity` units of every full
   * `(buyQuantity + getQuantity)` chunk as discounted. */
  private static buyXGetY(
    promotion: Promotion,
    targeted: readonly DiscountTargetLine[],
  ): DiscountResult {
    const buy = promotion.buyQuantity ?? 0;
    const get = promotion.getQuantity ?? 0;
    const basisPoints = promotion.getDiscountBasisPoints ?? 0;
    if (buy <= 0 || get <= 0 || basisPoints <= 0) {
      return { totalDiscount: 0n, perLine: new Map(), freeShipping: false };
    }

    const units: { productSkuId: string; unitAmount: bigint }[] = [];
    for (const line of targeted) {
      if (line.quantity <= 0) continue;
      const unitAmount = line.remaining / BigInt(line.quantity);
      for (let i = 0; i < line.quantity; i += 1) {
        units.push({ productSkuId: line.productSkuId, unitAmount });
      }
    }
    units.sort((a, b) => (a.unitAmount < b.unitAmount ? -1 : a.unitAmount > b.unitAmount ? 1 : 0));

    const chunkSize = buy + get;
    let raw = 0n;
    const perLineRaw = new Map<string, bigint>();
    for (let start = 0; start + chunkSize <= units.length; start += chunkSize) {
      for (let i = start; i < start + get; i += 1) {
        const unit = units[i];
        if (!unit) continue;
        const unitDiscount = Money.ofRial(unit.unitAmount).applyBasisPoints(basisPoints).amount;
        raw += unitDiscount;
        perLineRaw.set(unit.productSkuId, (perLineRaw.get(unit.productSkuId) ?? 0n) + unitDiscount);
      }
    }

    const total = this.targetedTotal(targeted);
    const totalDiscount = capDiscount(promotion, raw, total);
    // If capping reduced the raw total, redistribute proportionally by
    // each line's own raw share rather than dropping the excess from
    // just the last line — keeps BOGO's per-line attribution meaningful.
    const perLine =
      totalDiscount === raw
        ? perLineRaw
        : allocateProportional(
            totalDiscount,
            [...perLineRaw.entries()].map(([key, amount]) => ({ key, amount })),
          );
    return { totalDiscount, perLine, freeShipping: false };
  }
}
