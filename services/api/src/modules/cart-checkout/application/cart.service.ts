import { randomBytes } from 'node:crypto';

import { asProductSkuId, type CartItemOptionType } from '@iecp/types';
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { PricingService as CatalogPricingService } from '../../catalog/application/pricing.service';
import { ProductsService } from '../../catalog/application/products.service';
import { SkusService } from '../../catalog/application/skus.service';
import { StockQueryService } from '../../inventory/application/stock-query.service';
import {
  CART_REPOSITORY,
  type CartRepositoryPort,
  type CartWithItems,
} from '../domain/ports/cart.repository.port';
import { CartConsolidationRules } from '../domain/services/cart-consolidation-rules';
import { CartQuantityRules } from '../domain/services/cart-quantity-rules';
import { DiscountCalculator } from '../domain/services/discount-calculator';

import { CartPricingService } from './cart-pricing.service';

export interface CartActor {
  customerId: string | null;
  guestToken: string | null;
}

export interface AddCartItemRequest {
  productSkuId: string;
  quantity: number;
  configuration?: Record<string, unknown> | null;
  options?: { optionType: CartItemOptionType; optionKey: string; optionLabel?: string | null }[];
}

/** How long an untouched cart survives before the `cart_abandonment`
 * BullMQ sweep marks it `ABANDONED` — a rolling window: every meaningful
 * mutation (add/update/remove item, coupon, shipping) pushes `expiresAt`
 * forward again via `touch()`, so only a genuinely idle cart ever expires.
 * Deliberately longer than `CheckoutService`'s `DEFAULT_CHECKOUT_TTL_MINUTES`
 * — a cart is meant to persist across browsing sessions, a checkout
 * session is not. */
const DEFAULT_CART_TTL_DAYS = 30;

/** blueprint §16 orchestration — the application-layer home for
 * everything `cart_rules` in the brief asks for: guest/authenticated
 * support, quantity/consolidation rules, product/SKU/inventory validation
 * on every add (never trusting a client-supplied price or availability).
 */
@Injectable()
export class CartService {
  constructor(
    @Inject(CART_REPOSITORY) private readonly carts: CartRepositoryPort,
    private readonly products: ProductsService,
    private readonly skus: SkusService,
    private readonly catalogPricing: CatalogPricingService,
    private readonly stock: StockQueryService,
    private readonly pricing: CartPricingService,
  ) {}

  static generateGuestToken(): string {
    return randomBytes(32).toString('base64url');
  }

  async getOrCreateForGuest(guestToken: string | null): Promise<CartWithItems> {
    if (guestToken) {
      const existing = await this.carts.findByGuestToken(guestToken);
      if (existing?.cart.isActive) return existing;
    }
    const token = CartService.generateGuestToken();
    const cart = await this.carts.create({ guestToken: token, expiresAt: this.nextExpiry() });
    return { cart, items: [], coupon: null, shippingSelection: null };
  }

  async getOrCreateForCustomer(customerId: string): Promise<CartWithItems> {
    const existing = await this.carts.findActiveByCustomerId(customerId);
    if (existing) return existing;
    const cart = await this.carts.create({ customerId, expiresAt: this.nextExpiry() });
    return { cart, items: [], coupon: null, shippingSelection: null };
  }

  private nextExpiry(): Date {
    return new Date(Date.now() + DEFAULT_CART_TTL_DAYS * 24 * 60 * 60_000);
  }

  /** Resets the abandonment clock — called after every meaningful
   * mutation so an actively-used cart never expires mid-session. Errors
   * are swallowed: touching `expiresAt` is a best-effort freshness signal,
   * never something a mutation should fail over. */
  private async touch(cartId: string): Promise<void> {
    await this.carts.extendExpiry(cartId, this.nextExpiry()).catch(() => undefined);
  }

  async getById(cartId: string, actor: CartActor): Promise<CartWithItems> {
    const cart = await this.carts.findById(cartId);
    if (!cart) throw new NotFoundException('Cart not found');
    this.assertOwnership(cart, actor);
    return cart;
  }

  /** IDOR protection (the brief's own explicit rule): a guest may only act
   * on the cart matching their own `X-Cart-Token`; an authenticated
   * customer may only act on their own `customerId`'s cart. Neither may
   * touch the other's. */
  assertOwnership(cart: CartWithItems, actor: CartActor): void {
    if (cart.cart.customerId) {
      if (cart.cart.customerId !== actor.customerId) {
        throw new ForbiddenException('This cart does not belong to the current customer');
      }
      return;
    }
    if (cart.cart.guestToken && cart.cart.guestToken !== actor.guestToken) {
      throw new ForbiddenException('This cart does not belong to the current guest session');
    }
  }

  async addItem(
    cartId: string,
    actor: CartActor,
    request: AddCartItemRequest,
  ): Promise<CartWithItems> {
    const cart = await this.getById(cartId, actor);
    const skuId = asProductSkuId(request.productSkuId);

    const sku = await this.skus.get(skuId);
    if (sku.status !== 'ACTIVE') {
      throw new ForbiddenException('This SKU is not currently sellable');
    }
    const product = await this.products.get(sku.productId);
    if (product.status !== 'PUBLISHED') {
      throw new ForbiddenException('This product is not currently published');
    }

    const maxPerLine = await this.pricing.getMaxQuantityPerLine();
    CartQuantityRules.assertValid(request.quantity, maxPerLine);

    const availability = await this.stock.getAvailability(skuId);
    CartQuantityRules.assertAvailable(request.quantity, availability.totalAvailableQuantity);

    const price = await this.catalogPricing.get(skuId);
    const configurationHash = CartConsolidationRules.hashConfiguration(request.configuration);

    await this.carts.addItem(cart.cart.id, {
      productSkuId: request.productSkuId,
      quantity: request.quantity,
      unitPriceSnapshot: price.basePrice,
      currency: price.currency,
      configurationSnapshot: request.configuration ?? null,
      configurationHash,
      options: request.options,
    });
    await this.touch(cart.cart.id);

    return this.getById(cart.cart.id, actor);
  }

  async updateItemQuantity(
    cartId: string,
    actor: CartActor,
    cartItemId: string,
    quantity: number,
  ): Promise<CartWithItems> {
    const cart = await this.getById(cartId, actor);
    const item = cart.items.find((candidate) => candidate.id === cartItemId);
    if (!item) throw new NotFoundException('Cart item not found');

    const maxPerLine = await this.pricing.getMaxQuantityPerLine();
    CartQuantityRules.assertValid(quantity, maxPerLine);

    const availability = await this.stock.getAvailability(asProductSkuId(item.productSkuId));
    CartQuantityRules.assertAvailable(quantity, availability.totalAvailableQuantity);

    await this.carts.updateItemQuantity(cartItemId, quantity);
    await this.touch(cartId);
    return this.getById(cartId, actor);
  }

  async removeItem(cartId: string, actor: CartActor, cartItemId: string): Promise<CartWithItems> {
    const cart = await this.getById(cartId, actor);
    const item = cart.items.find((candidate) => candidate.id === cartItemId);
    if (!item) throw new NotFoundException('Cart item not found');
    await this.carts.removeItem(cartItemId);
    await this.touch(cartId);
    return this.getById(cartId, actor);
  }

  async deleteCart(cartId: string, actor: CartActor): Promise<void> {
    const cart = await this.getById(cartId, actor);
    await this.carts.delete(cart.cart.id);
  }

  /** Folds a guest cart's lines into the now-authenticated customer's
   * cart (ADR-007 decision 10): duplicates (same SKU+configuration)
   * consolidate quantity, distinct lines are preserved from both sides.
   * The guest cart is marked `ABANDONED` — no sixth `CartStatus` value
   * for "merged away". */
  async mergeGuestIntoCustomer(guestToken: string, customerId: string): Promise<CartWithItems> {
    const guestCart = await this.carts.findByGuestToken(guestToken);
    const target = await this.getOrCreateForCustomer(customerId);
    if (!guestCart || guestCart.cart.id === target.cart.id) return target;

    for (const item of guestCart.items) {
      await this.carts.addItem(target.cart.id, {
        productSkuId: item.productSkuId,
        quantity: item.quantity,
        unitPriceSnapshot: item.unitPriceSnapshot,
        currency: item.currency,
        configurationSnapshot: item.configurationSnapshot,
        configurationHash: item.configurationHash,
        options: item.options.map((option) => ({
          optionType: option.optionType,
          optionKey: option.optionKey,
          optionLabel: option.optionLabel,
          priceAdjustment: option.priceAdjustment,
        })),
      });
    }
    await this.carts.updateStatus(guestCart.cart.id, 'ABANDONED');
    await this.touch(target.cart.id);
    return this.getById(target.cart.id, { customerId, guestToken: null });
  }

  async applyCoupon(cartId: string, actor: CartActor, code: string): Promise<CartWithItems> {
    const cart = await this.getById(cartId, actor);
    const {
      couponId,
      code: resolvedCode,
      rule,
    } = await this.pricing.resolveCouponRule(code, cart.cart.customerId);
    const subtotal = cart.items.reduce((sum, item) => sum + item.lineSubtotal, 0n);
    const discount = DiscountCalculator.calculateTotalDiscount(subtotal, rule);
    await this.carts.applyCoupon(cart.cart.id, {
      couponId,
      code: resolvedCode,
      resolvedDiscount: discount,
    });
    await this.touch(cartId);
    return this.getById(cartId, actor);
  }

  async removeCoupon(cartId: string, actor: CartActor): Promise<CartWithItems> {
    const cart = await this.getById(cartId, actor);
    await this.carts.removeCoupon(cart.cart.id);
    await this.touch(cartId);
    return this.getById(cartId, actor);
  }

  async selectShipping(
    cartId: string,
    actor: CartActor,
    shippingMethodId: string,
    destination: { province: string; city: string },
  ): Promise<CartWithItems> {
    const cart = await this.getById(cartId, actor);
    const subtotal = cart.items.reduce((sum, item) => sum + item.lineSubtotal, 0n);
    const cost = await this.pricing.resolveShippingCost(shippingMethodId, destination, subtotal);
    await this.carts.setShippingSelection(cart.cart.id, { shippingMethodId, estimatedCost: cost });
    await this.touch(cartId);
    return this.getById(cartId, actor);
  }

  /** Consumer-side counterpart to the mutation-driven `touch()` calls
   * above — invoked by the `cart_abandonment` BullMQ processor (mirrors
   * `CheckoutService.expire()`'s shape), never by an HTTP controller.
   * Idempotent: marking an already-`ABANDONED` (or otherwise non-`ACTIVE`)
   * cart abandoned again is a silent no-op. Carts hold no inventory
   * reservations of their own (that only happens once a `CheckoutSession`
   * calls `reserve()`), so unlike `CheckoutService.expire()` there is
   * nothing here to release. */
  async abandon(cartId: string): Promise<void> {
    const cart = await this.carts.findById(cartId);
    if (cart?.cart.status !== 'ACTIVE') return;
    await this.carts.updateStatus(cartId, 'ABANDONED');
  }

  async price(cartId: string, actor: CartActor) {
    const cart = await this.getById(cartId, actor);
    const couponRule = cart.coupon
      ? ((
          await this.pricing
            .resolveCouponRule(cart.coupon.code, cart.cart.customerId)
            .catch(() => null)
        )?.rule ?? null)
      : null;
    const shippingCost = cart.shippingSelection?.estimatedCost ?? 0n;
    const resolution = await this.pricing.resolve(cart.items, couponRule, shippingCost);
    await this.carts.recordPriceSnapshot(cart.cart.id, {
      currency: cart.cart.currency,
      subtotal: resolution.subtotal,
      discountTotal: resolution.discountTotal,
      taxTotal: resolution.taxTotal,
      shippingTotal: resolution.shippingTotal,
      grandTotal: resolution.grandTotal,
      breakdown: resolution.lines,
    });
    return resolution;
  }
}
