import { prisma } from '@iecp/database';
import { Inject, Injectable } from '@nestjs/common';

import type { Coupon } from '../domain/entities/coupon.entity';
import type { Promotion } from '../domain/entities/promotion.entity';
import {
  COUPON_REPOSITORY,
  type CouponRepositoryPort,
} from '../domain/ports/coupon.repository.port';
import {
  CUSTOMER_CONTEXT_PORT,
  type CustomerContextPort,
} from '../domain/ports/customer-context.port';
import {
  PROMOTION_REPOSITORY,
  type PromotionRepositoryPort,
} from '../domain/ports/promotion.repository.port';
import type {
  EligibilityCandidate,
  EligibilityCartLine,
} from '../domain/services/eligibility-engine';
import { PromotionResolver, type PromotionResolution } from '../domain/services/promotion-resolver';
import { CouponCode } from '../domain/value-objects/coupon-code';

export interface ResolveForCartInput {
  items: readonly { productSkuId: string; quantity: number; lineSubtotal: bigint }[];
  customerId: string | null;
  /** Raw, un-normalized coupon code as supplied by the caller — `null`
   * when the cart has none applied. Normalized internally
   * (`CouponCode.normalize`, ADR-010 decision 2). */
  couponCode: string | null;
}

/** Lightweight, application-layer-only catalog context read (ADR-010
 * decision 4) — direct Prisma reads rather than a new cross-module
 * domain port, since this is a simple lookup with no business logic of
 * its own (same pragmatism `CartPricingService` already applies reading
 * `system.Setting` directly). Domain layer stays Prisma-free regardless
 * — only this application service touches it. */
async function catalogContext(
  productSkuId: string,
): Promise<{
  productId: string | null;
  categoryId: string | null;
  brandId: string | null;
  collectionIds: string[];
}> {
  const sku = await prisma.productSku.findUnique({ where: { id: productSkuId } });
  if (!sku) return { productId: null, categoryId: null, brandId: null, collectionIds: [] };
  const product = await prisma.product.findUnique({ where: { id: sku.productId } });
  if (!product)
    return { productId: sku.productId, categoryId: null, brandId: null, collectionIds: [] };
  const collections = await prisma.collectionProduct.findMany({ where: { productId: product.id } });
  return {
    productId: product.id,
    categoryId: product.categoryId,
    brandId: product.brandId,
    collectionIds: collections.map((row) => row.collectionId),
  };
}

/**
 * The cart-facing entry point cart-checkout composes directly (ADR-010
 * decision 7, same "next phase adds an additive hook" composition
 * pattern every prior phase used). Resolves every candidate promotion
 * (automatic + the one coupon-gated promotion, if a valid code was
 * supplied), fetches every context input the pure engine needs, and
 * delegates the actual decision to `PromotionResolver` — this service
 * does I/O, the resolver stays pure.
 */
@Injectable()
export class PromotionResolutionService {
  constructor(
    @Inject(PROMOTION_REPOSITORY) private readonly promotions: PromotionRepositoryPort,
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepositoryPort,
    @Inject(CUSTOMER_CONTEXT_PORT) private readonly customerContext: CustomerContextPort,
  ) {}

  async resolveForCart(input: ResolveForCartInput): Promise<PromotionResolution> {
    const now = new Date();
    const active = await this.promotions.listActive(now);

    let couponCandidate: { coupon: Coupon; promotion: Promotion } | null = null;
    if (input.couponCode) {
      const normalized = CouponCode.normalize(input.couponCode);
      const coupon = await this.coupons.findByCode(normalized);
      if (coupon) {
        const promotion = await this.promotions.findById(coupon.promotionId);
        if (promotion) couponCandidate = { coupon, promotion };
      }
    }

    const candidates: EligibilityCandidate[] = active
      .filter((promotion) => !promotion.requiresCoupon)
      .map((promotion) => ({ promotion, coupon: null }));
    if (couponCandidate) {
      const gatedPromotionId = couponCandidate.promotion.id;
      if (!candidates.some((c) => c.promotion.id === gatedPromotionId)) {
        candidates.push({ promotion: couponCandidate.promotion, coupon: couponCandidate.coupon });
      }
    }

    const lines: EligibilityCartLine[] = [];
    for (const item of input.items) {
      const ctx = await catalogContext(item.productSkuId);
      lines.push({
        productSkuId: item.productSkuId,
        productId: ctx.productId,
        categoryIds: ctx.categoryId ? [ctx.categoryId] : [],
        brandId: ctx.brandId,
        collectionIds: ctx.collectionIds,
        quantity: item.quantity,
        lineSubtotal: item.lineSubtotal,
      });
    }

    const cartSubtotal = lines.reduce((sum, line) => sum + line.lineSubtotal, 0n);
    const customerSegmentKeys = await this.customerContext.listSegmentKeys(input.customerId);
    const isFirstPurchase = await this.customerContext.isFirstPurchase(input.customerId);

    const promotionCustomerUsageCounts = new Map<string, number>();
    const couponCustomerUsageCounts = new Map<string, number>();
    if (input.customerId) {
      for (const candidate of candidates) {
        if (candidate.promotion.perCustomerLimit !== null) {
          const used = await this.coupons.countByCustomer(
            candidate.promotion.id,
            null,
            input.customerId,
          );
          promotionCustomerUsageCounts.set(candidate.promotion.id, used);
        }
        if (candidate.coupon && candidate.coupon.perCustomerLimit !== null) {
          const used = await this.coupons.countByCustomer(
            candidate.promotion.id,
            candidate.coupon.id,
            input.customerId,
          );
          couponCustomerUsageCounts.set(candidate.coupon.id, used);
        }
      }
    }

    return PromotionResolver.resolve(lines, candidates, {
      now,
      customerId: input.customerId,
      cartSubtotal,
      customerSegmentKeys,
      isFirstPurchase,
      promotionUsageCounts: new Map(),
      promotionCustomerUsageCounts,
      couponUsageCounts: new Map(),
      couponCustomerUsageCounts,
    });
  }
}
