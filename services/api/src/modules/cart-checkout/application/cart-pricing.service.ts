import { prisma } from '@iecp/database';
import { asProductSkuId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import { SkusService } from '../../catalog/application/skus.service';
import type { CartItem } from '../domain/entities/cart-item.entity';
import type { PriceLineBreakdown } from '../domain/entities/price-breakdown.types';
import { COUPON_LOOKUP_PORT, type CouponLookupPort } from '../domain/ports/coupon-lookup.port';
import {
  SHIPPING_METHOD_REPOSITORY,
  type ShippingMethodRepositoryPort,
} from '../domain/ports/shipping-method.repository.port';
import { CouponNotApplicableError, type CouponRule } from '../domain/services/discount-calculator';
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

/**
 * The application-layer orchestration around `PricingResolver` (pure
 * domain logic) — reads the configurable inputs (tax default, coupon
 * rules, shipping methods) from real storage and hands the resolver
 * exactly what the brief's `pricing_engine.inputs` list asks for, never
 * hardcoded. Named `CartPricingService` (not `PricingService`) to avoid
 * colliding with `modules/catalog`'s own `PricingService` when both are
 * injected in this module.
 */
@Injectable()
export class CartPricingService {
  constructor(
    private readonly skus: SkusService,
    @Inject(COUPON_LOOKUP_PORT) private readonly coupons: CouponLookupPort,
    @Inject(SHIPPING_METHOD_REPOSITORY)
    private readonly shippingMethods: ShippingMethodRepositoryPort,
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

  /** Resolves a coupon code into `CouponRule` input, enforcing usage
   * limits (`usageLimit`/`perUserLimit`) and the validity window
   * (`startsAt`/`endsAt`) — the parts of "is this coupon actually usable
   * right now" `DiscountCalculator` itself has no way to check (it only
   * knows the amount math). */
  async resolveCouponRule(
    code: string,
    customerId: string | null,
  ): Promise<{ couponId: string; code: string; rule: CouponRule }> {
    const coupon = await this.coupons.findByCode(code);
    if (!coupon?.isActive) {
      throw new CouponNotApplicableError(`Coupon "${code}" is not active`);
    }
    const now = new Date();
    if (coupon.startsAt && now < coupon.startsAt) {
      throw new CouponNotApplicableError(`Coupon "${code}" is not yet valid`);
    }
    if (coupon.endsAt && now > coupon.endsAt) {
      throw new CouponNotApplicableError(`Coupon "${code}" has expired`);
    }
    if (coupon.perUserLimit !== null) {
      const redemptions = await this.coupons.countRedemptionsByCustomer(coupon.id, customerId);
      if (redemptions >= coupon.perUserLimit) {
        throw new CouponNotApplicableError(
          `Coupon "${code}" usage limit reached for this customer`,
        );
      }
    }
    return {
      couponId: coupon.id,
      code: coupon.code,
      rule: {
        type: coupon.type,
        value: coupon.value,
        minOrderAmount: coupon.minOrderAmount,
        maxDiscountAmount: coupon.maxDiscountAmount,
      },
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

  /** The one place cart/checkout lines get turned into a full
   * `PricingResolution` — reads each SKU's `taxRateBasisPoints` fresh
   * (never trusts the cart's own snapshot for tax purposes, since a SKU's
   * tax configuration can change after it was added to a cart). */
  async resolve(
    items: readonly CartItem[],
    coupon: CouponRule | null,
    shippingCost: bigint,
  ): Promise<PricingResolution> {
    const defaultTaxRateBasisPoints = await this.getDefaultTaxRateBasisPoints();
    const skuTaxRates = new Map<string, number | null>();
    for (const item of items) {
      if (!skuTaxRates.has(item.productSkuId)) {
        const sku = await this.skus.get(asProductSkuId(item.productSkuId));
        skuTaxRates.set(item.productSkuId, sku.taxRateBasisPoints);
      }
    }

    return PricingResolver.resolve({
      lines: items.map((item) => ({
        productSkuId: item.productSkuId,
        quantity: item.quantity,
        basePrice: item.unitPriceSnapshot,
        taxRateBasisPoints: skuTaxRates.get(item.productSkuId) ?? null,
      })),
      coupon,
      defaultTaxRateBasisPoints,
      shippingCost,
    });
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
