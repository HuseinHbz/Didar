import type { CartItemOptionType } from '@iecp/types';

import type { CartCoupon } from '../entities/cart-coupon.entity';
import type { CartItemOption } from '../entities/cart-item-option.entity';
import type { CartItem } from '../entities/cart-item.entity';
import type { CartPriceSnapshot } from '../entities/cart-price-snapshot.entity';
import type { CartShippingSelection } from '../entities/cart-shipping-selection.entity';
import type { Cart } from '../entities/cart.entity';
import type { PriceLineBreakdown } from '../entities/price-breakdown.types';

export const CART_REPOSITORY = Symbol('CART_REPOSITORY');

export interface CartWithItems {
  cart: Cart;
  items: (CartItem & { options: CartItemOption[] })[];
  coupon: CartCoupon | null;
  shippingSelection: CartShippingSelection | null;
}

export interface AddCartItemInput {
  productSkuId: string;
  quantity: number;
  unitPriceSnapshot: bigint;
  currency: string;
  configurationSnapshot?: Record<string, unknown> | null;
  configurationHash: string;
  options?: {
    optionType: CartItemOptionType;
    optionKey: string;
    optionLabel?: string | null;
    priceAdjustment?: bigint | null;
  }[];
}

/**
 * `Cart` is the aggregate root for this whole subtree — `CartItem`(+
 * `CartItemOption`), `CartPriceSnapshot`, `CartCoupon`, and
 * `CartShippingSelection` are all managed through composite operations
 * here rather than each getting its own top-level repository port. This
 * mirrors the precedent Phase 006's `StockTransferRepositoryPort` already
 * set for `StockTransferItem` (a child entity with no independent
 * lifecycle of its own) — none of these five entities is ever created,
 * read, or deleted independently of the `Cart` they belong to.
 */
export interface CartRepositoryPort {
  findById(id: string): Promise<CartWithItems | null>;
  findByGuestToken(guestToken: string): Promise<CartWithItems | null>;
  findActiveByCustomerId(customerId: string): Promise<CartWithItems | null>;
  /** Every `ACTIVE` cart whose `expiresAt` has already passed — what the
   * `cart_abandonment` sweep reads (mirrors Phase 006's `listExpirable`
   * naming for the analogous inventory-reservation sweep). */
  listExpirable(now: Date): Promise<Cart[]>;

  /** Pushes `expiresAt` forward — called on cart creation and again on
   * every meaningful mutation (add/update/remove item, coupon, shipping),
   * so an actively-used cart's abandonment clock keeps resetting. Mirrors
   * `CheckoutSessionRepositoryPort.extendExpiry`. */
  extendExpiry(id: string, expiresAt: Date): Promise<Cart>;

  create(props: {
    customerId?: string | null;
    guestToken?: string | null;
    currency?: string;
    expiresAt?: Date | null;
  }): Promise<Cart>;
  updateStatus(id: string, status: Cart['status']): Promise<Cart>;
  bindToCustomer(id: string, customerId: string): Promise<Cart>;
  delete(id: string): Promise<void>;

  /** Idempotent on `(cartId, productSkuId, configurationHash)` — a repeat
   * add of the same SKU+configuration increments quantity instead of
   * creating a second line (`cart_rules`'s "prevent duplicate cart lines
   * where business rules require consolidation"). */
  addItem(cartId: string, input: AddCartItemInput): Promise<CartItem>;
  updateItemQuantity(cartItemId: string, quantity: number): Promise<CartItem>;
  removeItem(cartItemId: string): Promise<void>;
  clearItems(cartId: string): Promise<void>;

  recordPriceSnapshot(
    cartId: string,
    props: {
      currency: string;
      subtotal: bigint;
      discountTotal: bigint;
      taxTotal: bigint;
      shippingTotal: bigint;
      grandTotal: bigint;
      breakdown: readonly PriceLineBreakdown[];
    },
  ): Promise<CartPriceSnapshot>;

  applyCoupon(
    cartId: string,
    props: { couponId: string; code: string; resolvedDiscount: bigint },
  ): Promise<CartCoupon>;
  removeCoupon(cartId: string): Promise<void>;

  setShippingSelection(
    cartId: string,
    props: { shippingMethodId: string; estimatedCost: bigint },
  ): Promise<CartShippingSelection>;
}
