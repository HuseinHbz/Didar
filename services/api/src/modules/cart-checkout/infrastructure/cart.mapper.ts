import type {
  Cart as PrismaCart,
  CartCoupon as PrismaCartCoupon,
  CartItem as PrismaCartItem,
  CartItemOption as PrismaCartItemOption,
  CartPriceSnapshot as PrismaCartPriceSnapshot,
  CartShippingSelection as PrismaCartShippingSelection,
  Prisma,
} from '@iecp/database';

import { CartCoupon } from '../domain/entities/cart-coupon.entity';
import { CartItemOption } from '../domain/entities/cart-item-option.entity';
import { CartItem } from '../domain/entities/cart-item.entity';
import { CartPriceSnapshot } from '../domain/entities/cart-price-snapshot.entity';
import { CartShippingSelection } from '../domain/entities/cart-shipping-selection.entity';
import { Cart } from '../domain/entities/cart.entity';
import type { PriceLineBreakdown } from '../domain/entities/price-breakdown.types';

export function cartToDomain(row: PrismaCart): Cart {
  return Cart.create({
    id: row.id,
    customerId: row.customerId,
    guestToken: row.guestToken,
    status: row.status,
    currency: row.currency,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function cartItemToDomain(row: PrismaCartItem): CartItem {
  return CartItem.create({
    id: row.id,
    cartId: row.cartId,
    productSkuId: row.productSkuId,
    quantity: row.quantity,
    unitPriceSnapshot: row.unitPriceSnapshot,
    currency: row.currency,
    configurationSnapshot: (row.configurationSnapshot as Record<string, unknown> | null) ?? null,
    configurationHash: row.configurationHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function cartItemOptionToDomain(row: PrismaCartItemOption): CartItemOption {
  return CartItemOption.create({
    id: row.id,
    cartItemId: row.cartItemId,
    optionType: row.optionType as CartItemOption['optionType'],
    optionKey: row.optionKey,
    optionLabel: row.optionLabel,
    priceAdjustment: row.priceAdjustment,
    createdAt: row.createdAt,
  });
}

export function cartCouponToDomain(row: PrismaCartCoupon): CartCoupon {
  return CartCoupon.create({
    id: row.id,
    cartId: row.cartId,
    couponId: row.couponId,
    code: row.code,
    resolvedDiscount: row.resolvedDiscount,
    appliedAt: row.appliedAt,
  });
}

export function cartShippingSelectionToDomain(
  row: PrismaCartShippingSelection,
): CartShippingSelection {
  return CartShippingSelection.create({
    id: row.id,
    cartId: row.cartId,
    shippingMethodId: row.shippingMethodId,
    estimatedCost: row.estimatedCost,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function cartPriceSnapshotToDomain(row: PrismaCartPriceSnapshot): CartPriceSnapshot {
  return CartPriceSnapshot.create({
    id: row.id,
    cartId: row.cartId,
    currency: row.currency,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    taxTotal: row.taxTotal,
    shippingTotal: row.shippingTotal,
    grandTotal: row.grandTotal,
    breakdown: breakdownFromJson(row.breakdown),
    calculatedAt: row.calculatedAt,
  });
}

/** `breakdown` is a JSON column storing `PriceLineBreakdown[]` with bigint
 * amounts serialized as decimal strings (JSON has no bigint) — this
 * reverses that at the read boundary. Mirrors the JSON-column-casting
 * convention `modules/catalog/infrastructure/json.util.ts` already
 * established for typed `Json?` columns. */
export function breakdownToJson(lines: readonly PriceLineBreakdown[]): Prisma.InputJsonValue {
  return lines.map((line) => ({
    productSkuId: line.productSkuId,
    quantity: line.quantity,
    basePrice: line.basePrice.toString(),
    resolvedUnitPrice: line.resolvedUnitPrice.toString(),
    lineDiscount: line.lineDiscount.toString(),
    lineTax: line.lineTax.toString(),
    lineSubtotal: line.lineSubtotal.toString(),
    taxRateBasisPoints: line.taxRateBasisPoints,
  }));
}

export function breakdownFromJson(value: Prisma.JsonValue): PriceLineBreakdown[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const line = raw as Record<string, unknown>;
    return {
      productSkuId: String(line['productSkuId']),
      quantity: Number(line['quantity']),
      basePrice: BigInt(String(line['basePrice'])),
      resolvedUnitPrice: BigInt(String(line['resolvedUnitPrice'])),
      lineDiscount: BigInt(String(line['lineDiscount'])),
      lineTax: BigInt(String(line['lineTax'])),
      lineSubtotal: BigInt(String(line['lineSubtotal'])),
      taxRateBasisPoints: Number(line['taxRateBasisPoints']),
    };
  });
}
