import { prisma } from '@iecp/database';
import { asProductSkuId } from '@iecp/types';
import { Injectable, Inject } from '@nestjs/common';

import { SkusService } from '../../catalog/application/skus.service';
import { PromotionResolutionService } from '../../promotion/application/promotion-resolution.service';
import { CouponNotApplicableError } from '../../promotion/domain/errors/promotion-domain.errors';
import type { CartItem } from '../domain/entities/cart-item.entity';
import type { PriceLineBreakdown } from '../domain/entities/price-breakdown.types';
import {
  SHIPPING_METHOD_REPOSITORY,
  type ShippingMethodRepositoryPort,
} from '../domain/ports/shipping-method.repository.port';
import type { PricingAdjustmentInput } from '../domain/services/discount-calculator';
import { PricingResolver, type PricingResolution } from '../domain/services/pricing-resolver';
import { ShippingCalculator } from '../domain/services/shipping-calculator';

const DEFAULT_TAX_RATE_SETTING_KEY = 'pricing.default_tax_rate_basis_points';
const DEFAULT_MAX_QUANTITY_SETTING_KEY = 'cart.max_quantity_per_line';

/** Fallbacks used only if the corresponding `system.Setting` row has never
 * been created (e.g. a fresh database before the seed runs) — never used
 * as a silent substitute for a real, admin-configured value once one
 * exists. See `docs/adr/ADR-007-cart-checkout.md` decision 6. */
const FALLBACK_DEFAULT_TAX_RATE_BASIS_POINTS = 0;
const FALLBACK_MAX_QUANTITY_PER_LINE = 20;

export interface AppliedPromotionSnapshot {
  promotionId: string;
  promotionName: string;
  couponId: string | null;
  couponCode: string | null;
  discountType: string;
  discountAmount: string;
  affectedProductSkuIds: string[];
}

/**
 * The application-layer orchestration around `PricingResolver` (pure
 * domain logic) — reads the configurable inputs (tax default, shipping
 * methods) from real storage and resolves promotions/coupons via the
 * `promotion` module's `PromotionResolutionService` (Phase 010, ADR-010
 * decision 7 — extends this class in place, never duplicates the
 * pricing pipeline). Named `CartPricingService` (not `PricingService`) to
 * avoid colliding with `modules/catalog`'s own `PricingService` when both
 * are injected in this module.
 */
@Injectable()
export class CartPricingService {
  constructor(
    private readonly skus: SkusService,
    @Inject(SHIPPING_METHOD_REPOSITORY)
    private readonly shippingMethods: ShippingMethodRepositoryPort,
    private readonly promotionResolution: PromotionResolutionService,
  ) {}

  async getDefaultTaxRateBasisPoints(): Promise<number> {
    const setting = await prisma.setting.findUnique({
      where: { key: DEFAULT_TAX_RATE_SETTING_KEY },
    });
    if (!setting) return FALLBACK_DEFAULT_TAX_RATE_BASIS_POINTS;
    return Number(setting.value);
  }

  async getMaxQuantityPerLine(): Promise<number> {
    const setting = await prisma.setting.findUnique({
      where: { key: DEFAULT_MAX_QUANTITY_SETTING_KEY },
    });
    if (!setting) return FALLBACK_MAX_QUANTITY_PER_LINE;
    return Number(setting.value);
  }

  /** `CartService.applyCoupon()`'s own preview — resolves just the named
   * code's promotion against the current cart to compute the discount
   * cached on `CartCoupon.resolvedDiscount` at apply-time. Re-validated
   * (never blindly re-trusted) on every subsequent `price()` call via
   * `resolve()` below (ADR-010 decision 7), same as Phase 007's original
   * coupon flow. */
  async previewCouponDiscount(
    code: string,
    items: readonly CartItem[],
    customerId: string | null,
  ): Promise<{ couponId: string; code: string; discount: bigint }> {
    const lineInputs = items.map((item) => ({
      productSkuId: item.productSkuId,
      quantity: item.quantity,
      lineSubtotal: item.lineSubtotal,
    }));
    const resolution = await this.promotionResolution.resolveForCart({
      items: lineInputs,
      customerId,
      couponCode: code,
    });
    const accepted = resolution.accepted.find(
      (adjustment) =>
        adjustment.couponCode !== null && adjustment.couponCode === code.trim().toUpperCase(),
    );
    if (!accepted?.couponId) {
      throw new CouponNotApplicableError(`Coupon "${code}" is not applicable`);
    }
    return {
      couponId: accepted.couponId,
      code: accepted.couponCode ?? code,
      discount: accepted.discountAmount,
    };
  }

  /** The one place cart/checkout lines get turned into a full
   * `PricingResolution` — reads each SKU's `taxRateBasisPoints` fresh
   * (never trusts the cart's own snapshot for tax purposes, since a SKU's
   * tax configuration can change after it was added to a cart), and
   * resolves every promotion/coupon adjustment live via the `promotion`
   * module (never a stale cached amount). */
  async resolve(
    items: readonly CartItem[],
    promotionContext: { customerId: string | null; couponCode: string | null },
    shippingCost: bigint,
  ): Promise<PricingResolution & { appliedPromotions: AppliedPromotionSnapshot[] }> {
    const defaultTaxRateBasisPoints = await this.getDefaultTaxRateBasisPoints();
    const skuTaxRates = new Map<string, number | null>();
    for (const item of items) {
      if (!skuTaxRates.has(item.productSkuId)) {
        const sku = await this.skus.get(asProductSkuId(item.productSkuId));
        skuTaxRates.set(item.productSkuId, sku.taxRateBasisPoints);
      }
    }

    const promotionResolution = await this.promotionResolution.resolveForCart({
      items: items.map((item) => ({
        productSkuId: item.productSkuId,
        quantity: item.quantity,
        lineSubtotal: item.lineSubtotal,
      })),
      customerId: promotionContext.customerId,
      couponCode: promotionContext.couponCode,
    });

    const adjustments: PricingAdjustmentInput[] = promotionResolution.accepted
      .filter((adjustment) => adjustment.discountAmount > 0n)
      .map((adjustment) => ({
        scope: { productSkuIds: [...adjustment.perLineDiscount.keys()] },
        amount: adjustment.discountAmount,
      }));

    const resolution = PricingResolver.resolve({
      lines: items.map((item) => ({
        productSkuId: item.productSkuId,
        quantity: item.quantity,
        basePrice: item.unitPriceSnapshot,
        taxRateBasisPoints: skuTaxRates.get(item.productSkuId) ?? null,
      })),
      adjustments,
      freeShipping: promotionResolution.freeShipping,
      defaultTaxRateBasisPoints,
      shippingCost,
    });

    return {
      ...resolution,
      appliedPromotions: promotionResolution.accepted.map((adjustment) => ({
        promotionId: adjustment.promotionId,
        promotionName: adjustment.promotionName,
        couponId: adjustment.couponId,
        couponCode: adjustment.couponCode,
        discountType: adjustment.discountType,
        discountAmount: adjustment.discountAmount.toString(),
        affectedProductSkuIds: [...adjustment.perLineDiscount.keys()],
      })),
    };
  }

  async resolveShippingCost(
    shippingMethodId: string,
    destination: { province: string; city: string },
    subtotal: bigint,
  ): Promise<bigint> {
    const methods = await this.shippingMethods.listActive();
    return ShippingCalculator.resolveCost(methods, shippingMethodId, destination, subtotal);
  }

  toJsonBreakdown(resolution: PricingResolution): {
    lines: (Omit<
      PriceLineBreakdown,
      'basePrice' | 'resolvedUnitPrice' | 'lineDiscount' | 'lineTax' | 'lineSubtotal'
    > & {
      basePrice: string;
      resolvedUnitPrice: string;
      lineDiscount: string;
      lineTax: string;
      lineSubtotal: string;
    })[];
    subtotal: string;
    discountTotal: string;
    taxTotal: string;
    shippingTotal: string;
    grandTotal: string;
  } {
    return {
      lines: resolution.lines.map((line) => ({
        productSkuId: line.productSkuId,
        quantity: line.quantity,
        basePrice: line.basePrice.toString(),
        resolvedUnitPrice: line.resolvedUnitPrice.toString(),
        lineDiscount: line.lineDiscount.toString(),
        lineTax: line.lineTax.toString(),
        lineSubtotal: line.lineSubtotal.toString(),
        taxRateBasisPoints: line.taxRateBasisPoints,
      })),
      subtotal: resolution.subtotal.toString(),
      discountTotal: resolution.discountTotal.toString(),
      taxTotal: resolution.taxTotal.toString(),
      shippingTotal: resolution.shippingTotal.toString(),
      grandTotal: resolution.grandTotal.toString(),
    };
  }
}
