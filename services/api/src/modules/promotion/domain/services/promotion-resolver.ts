import type { PromotionActionType } from '@iecp/types';

import { type DiscountTargetLine, DiscountEngine } from './discount-engine';
import {
  type EligibilityCandidate,
  type EligibilityCartLine,
  type EligibilityContext,
  EligibilityEngine,
} from './eligibility-engine';

export interface ResolvedPromotionAdjustment {
  promotionId: string;
  promotionName: string;
  couponId: string | null;
  couponCode: string | null;
  discountType: PromotionActionType;
  discountAmount: bigint;
  /** `productSkuId -> discount amount` for the lines this promotion
   * actually discounted. */
  perLineDiscount: ReadonlyMap<string, bigint>;
  freeShipping: boolean;
}

export interface PromotionResolution {
  accepted: readonly ResolvedPromotionAdjustment[];
  discountTotal: bigint;
  freeShipping: boolean;
}

/** ADR-010 decision 5 — the calculation-order group each discount type
 * falls into, independent of the acceptance-order (`priority ASC, id
 * ASC`) used for stacking/exclusivity. Item-level `FIXED_AMOUNT` (has
 * explicit targets) runs before `PERCENTAGE`; cart-level `FIXED_AMOUNT`
 * (targets the whole cart) runs after. */
function calculationRank(discountType: PromotionActionType, targetsWholeCart: boolean): number {
  switch (discountType) {
    case 'FIXED_PRICE':
    case 'BUNDLE_PRICE':
      return 0;
    case 'FIXED_AMOUNT':
      return targetsWholeCart ? 4 : 1;
    case 'BUY_X_GET_Y':
      return 2;
    case 'PERCENTAGE':
      return 3;
    case 'FREE_SHIPPING':
      return 5;
    /* istanbul ignore next -- exhaustive switch */
    default:
      return 6;
  }
}

/**
 * ADR-010 decision 5/25 — the single pure evaluation entry point:
 * `resolve(lines, candidates, context) -> PromotionResolution`. No DB
 * calls; every candidate promotion/coupon and every context input
 * (customer segment membership, first-purchase flag, usage counts) is
 * already resolved by the caller. Deterministic: the same lines +
 * candidates + context always produce the same result, never dependent
 * on database row order (`ORDER BY priority ASC, id ASC` is applied here,
 * in memory, not assumed from the fetch).
 */
export class PromotionResolver {
  static resolve(
    lines: readonly EligibilityCartLine[],
    candidates: readonly EligibilityCandidate[],
    ctx: EligibilityContext,
  ): PromotionResolution {
    const eligible = candidates.filter((candidate) =>
      EligibilityEngine.isEligible(candidate, lines, ctx),
    );

    // Deterministic acceptance order: priority ASC, id ASC — never DB row
    // order (ADR-010 decision 5/11).
    const byAcceptanceOrder = [...eligible].sort((a, b) => {
      if (a.promotion.priority !== b.promotion.priority) {
        return a.promotion.priority - b.promotion.priority;
      }
      return a.promotion.id < b.promotion.id ? -1 : a.promotion.id > b.promotion.id ? 1 : 0;
    });

    const accepted: EligibilityCandidate[] = [];
    let exclusiveAccepted = false;
    let nonStackableAccepted = false;
    for (const candidate of byAcceptanceOrder) {
      const { promotion } = candidate;
      if (exclusiveAccepted) break; // rule 2 — an accepted exclusive locks out everything after it
      if (promotion.exclusive && accepted.length > 0) continue; // rule 3 — exclusive never joins a stack in progress
      if (!promotion.stackable && nonStackableAccepted) continue; // rule 5 — a non-stackable base blocks later non-stackables
      accepted.push(candidate);
      if (promotion.exclusive) exclusiveAccepted = true;
      if (!promotion.stackable) nonStackableAccepted = true;
    }

    // Calculation order (ADR-010 decision 5) — independent of acceptance
    // order above.
    const byCalculationOrder = [...accepted].sort((a, b) => {
      const rankA = calculationRank(a.promotion.discountType, a.promotion.targetsWholeCart);
      const rankB = calculationRank(b.promotion.discountType, b.promotion.targetsWholeCart);
      if (rankA !== rankB) return rankA - rankB;
      if (a.promotion.priority !== b.promotion.priority) {
        return a.promotion.priority - b.promotion.priority;
      }
      return a.promotion.id < b.promotion.id ? -1 : a.promotion.id > b.promotion.id ? 1 : 0;
    });

    const remaining = new Map<string, bigint>(
      lines.map((line) => [line.productSkuId, line.lineSubtotal]),
    );
    const resolved: ResolvedPromotionAdjustment[] = [];
    let discountTotal = 0n;
    let freeShipping = false;

    for (const candidate of byCalculationOrder) {
      const { promotion, coupon } = candidate;
      const targeted = EligibilityEngine.targetedLines(promotion, lines);
      const targetLines: DiscountTargetLine[] = targeted.map((line) => ({
        productSkuId: line.productSkuId,
        quantity: line.quantity,
        remaining: remaining.get(line.productSkuId) ?? 0n,
      }));
      const result = DiscountEngine.compute(promotion, targetLines);

      for (const [productSkuId, amount] of result.perLine) {
        const current = remaining.get(productSkuId) ?? 0n;
        const next = current - amount;
        remaining.set(productSkuId, next < 0n ? 0n : next);
      }

      resolved.push({
        promotionId: promotion.id,
        promotionName: promotion.name,
        couponId: coupon?.id ?? null,
        couponCode: coupon?.code ?? null,
        discountType: promotion.discountType,
        discountAmount: result.totalDiscount,
        perLineDiscount: result.perLine,
        freeShipping: result.freeShipping,
      });
      discountTotal += result.totalDiscount;
      if (result.freeShipping) freeShipping = true;
    }

    return { accepted: resolved, discountTotal, freeShipping };
  }
}
