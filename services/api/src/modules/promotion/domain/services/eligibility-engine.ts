import type { Coupon } from '../entities/coupon.entity';
import type { PromotionTarget } from '../entities/promotion-target.entity';
import type { Promotion } from '../entities/promotion.entity';

export interface EligibilityCartLine {
  productSkuId: string;
  productId: string | null;
  categoryIds: readonly string[];
  brandId: string | null;
  collectionIds: readonly string[];
  quantity: number;
  lineSubtotal: bigint;
}

export interface EligibilityContext {
  now: Date;
  customerId: string | null;
  cartSubtotal: bigint;
  /** Pre-resolved by the application layer (`customer.CustomerSegment`
   * reuse, ADR-010 decision 6) — the pure engine never queries. */
  customerSegmentKeys: readonly string[];
  isFirstPurchase: boolean;
  /** Pre-resolved usage counts, keyed by id — a defense-in-depth
   * eligibility pre-check only. The authoritative, race-safe check is
   * the DB reservation at checkout freeze time (ADR-010 decision 8);
   * this engine never trusts a stale count as the final word. */
  promotionUsageCounts: ReadonlyMap<string, number>;
  promotionCustomerUsageCounts: ReadonlyMap<string, number>;
  couponUsageCounts: ReadonlyMap<string, number>;
  couponCustomerUsageCounts: ReadonlyMap<string, number>;
}

export interface EligibilityCandidate {
  promotion: Promotion;
  /** Set only when this candidate was matched via a supplied coupon
   * code. `null` for an automatic (couponless) promotion. */
  coupon: Coupon | null;
}

/**
 * ADR-010 decision 6 — the only place that decides *whether* a promotion
 * applies. Never computes a discount amount (`DiscountEngine`'s job) and
 * never performs I/O — every input is already resolved by the caller.
 */
export class EligibilityEngine {
  static isEligible(
    candidate: EligibilityCandidate,
    lines: readonly EligibilityCartLine[],
    ctx: EligibilityContext,
  ): boolean {
    const { promotion, coupon } = candidate;
    if (promotion.status !== 'ACTIVE') return false;
    if (!promotion.isWithinWindow(ctx.now)) return false;
    if (promotion.minimumCartValue !== null && ctx.cartSubtotal < promotion.minimumCartValue) {
      return false;
    }
    if (!this.hasTargetedLine(promotion, lines)) return false;
    if (!this.rulesSatisfied(promotion, lines, ctx)) return false;
    if (!this.withinPromotionUsageLimits(promotion, ctx)) return false;

    if (promotion.requiresCoupon) {
      if (coupon?.promotionId !== promotion.id) return false;
      if (!coupon.isUsable(ctx.now)) return false;
      if (!this.withinCouponUsageLimits(coupon, ctx)) return false;
    }
    return true;
  }

  static lineMatchesAnyTarget(
    targets: readonly PromotionTarget[],
    line: EligibilityCartLine,
  ): boolean {
    return targets.some((target) => {
      switch (target.type) {
        case 'PRODUCT':
          return line.productId === target.refId;
        case 'SKU':
          return line.productSkuId === target.refId;
        case 'CATEGORY':
          return line.categoryIds.includes(target.refId);
        case 'BRAND':
          return line.brandId === target.refId;
        case 'COLLECTION':
          return line.collectionIds.includes(target.refId);
        default:
          return false;
      }
    });
  }

  /** Zero target rows = whole cart (ADR-010 decision 4). */
  static targetedLines(
    promotion: Promotion,
    lines: readonly EligibilityCartLine[],
  ): EligibilityCartLine[] {
    if (promotion.targetsWholeCart) return [...lines];
    return lines.filter((line) => this.lineMatchesAnyTarget(promotion.targets, line));
  }

  private static hasTargetedLine(
    promotion: Promotion,
    lines: readonly EligibilityCartLine[],
  ): boolean {
    return this.targetedLines(promotion, lines).length > 0;
  }

  private static rulesSatisfied(
    promotion: Promotion,
    lines: readonly EligibilityCartLine[],
    ctx: EligibilityContext,
  ): boolean {
    return promotion.rules.every((rule) => {
      switch (rule.type) {
        case 'MINIMUM_QUANTITY': {
          const config = rule.config as { minimumQuantity?: number };
          const targeted = this.targetedLines(promotion, lines);
          const totalQuantity = targeted.reduce((sum, line) => sum + line.quantity, 0);
          return totalQuantity >= (config.minimumQuantity ?? 0);
        }
        case 'CUSTOMER_SEGMENT': {
          const config = rule.config as { customerSegmentKey?: string };
          return config.customerSegmentKey
            ? ctx.customerSegmentKeys.includes(config.customerSegmentKey)
            : true;
        }
        case 'FIRST_PURCHASE_ONLY':
          return ctx.isFirstPurchase;
        default:
          return true;
      }
    });
  }

  private static withinPromotionUsageLimits(
    promotion: Promotion,
    ctx: EligibilityContext,
  ): boolean {
    if (promotion.usageLimit !== null) {
      const used = ctx.promotionUsageCounts.get(promotion.id) ?? promotion.usageCount;
      if (used >= promotion.usageLimit) return false;
    }
    if (promotion.perCustomerLimit !== null && ctx.customerId) {
      const used = ctx.promotionCustomerUsageCounts.get(promotion.id) ?? 0;
      if (used >= promotion.perCustomerLimit) return false;
    }
    return true;
  }

  private static withinCouponUsageLimits(coupon: Coupon, ctx: EligibilityContext): boolean {
    if (coupon.usageLimit !== null) {
      const used = ctx.couponUsageCounts.get(coupon.id) ?? coupon.usageCount;
      if (used >= coupon.usageLimit) return false;
    }
    if (coupon.perCustomerLimit !== null && ctx.customerId) {
      const used = ctx.couponCustomerUsageCounts.get(coupon.id) ?? 0;
      if (used >= coupon.perCustomerLimit) return false;
    }
    return true;
  }
}
