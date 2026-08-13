import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@iecp/database';
import { Injectable } from '@nestjs/common';

import type { CartItem } from '../../domain/entities/cart-item.entity';
import type { Cart } from '../../domain/entities/cart.entity';
import type { PriceLineBreakdown } from '../../domain/entities/price-breakdown.types';
import type {
  AddCartItemInput,
  CartRepositoryPort,
  CartWithItems,
} from '../../domain/ports/cart.repository.port';
import {
  breakdownToJson,
  cartCouponToDomain,
  cartItemOptionToDomain,
  cartItemToDomain,
  cartPriceSnapshotToDomain,
  cartShippingSelectionToDomain,
  cartToDomain,
} from '../cart.mapper';

const CART_INCLUDE = {
  items: { include: { options: true } },
  coupons: true,
  shippingSelection: true,
} as const;

@Injectable()
export class PrismaCartRepository implements CartRepositoryPort {
  async findById(id: string): Promise<CartWithItems | null> {
    const row = await prisma.cart.findUnique({ where: { id }, include: CART_INCLUDE });
    return row ? toAggregate(row) : null;
  }

  async findByGuestToken(guestToken: string): Promise<CartWithItems | null> {
    const row = await prisma.cart.findUnique({ where: { guestToken }, include: CART_INCLUDE });
    return row ? toAggregate(row) : null;
  }

  async findActiveByCustomerId(customerId: string): Promise<CartWithItems | null> {
    const row = await prisma.cart.findFirst({
      where: { customerId, status: 'ACTIVE' },
      include: CART_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return row ? toAggregate(row) : null;
  }

  async listExpirable(now: Date): Promise<Cart[]> {
    const rows = await prisma.cart.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
    });
    return rows.map(cartToDomain);
  }

  async create(props: {
    customerId?: string | null;
    guestToken?: string | null;
    currency?: string;
    expiresAt?: Date | null;
  }): Promise<Cart> {
    const row = await prisma.cart.create({
      data: {
        id: randomUUID(),
        customerId: props.customerId ?? null,
        guestToken: props.guestToken ?? null,
        currency: props.currency ?? 'IRR',
        expiresAt: props.expiresAt ?? null,
      },
    });
    return cartToDomain(row);
  }

  async updateStatus(id: string, status: Cart['status']): Promise<Cart> {
    const row = await prisma.cart.update({ where: { id }, data: { status } });
    return cartToDomain(row);
  }

  async extendExpiry(id: string, expiresAt: Date): Promise<Cart> {
    const row = await prisma.cart.update({ where: { id }, data: { expiresAt } });
    return cartToDomain(row);
  }

  async bindToCustomer(id: string, customerId: string): Promise<Cart> {
    const row = await prisma.cart.update({ where: { id }, data: { customerId, guestToken: null } });
    return cartToDomain(row);
  }

  async delete(id: string): Promise<void> {
    await prisma.cart.delete({ where: { id } });
  }

  /** Idempotent on `(cartId, productSkuId, configurationHash)` —
   * consolidates into the existing line (quantity summed) when one
   * already matches. The `$transaction`'s read-then-write is the
   * common-case fast path, not the actual race guard: Postgres's default
   * READ COMMITTED isolation does not stop two simultaneous callers from
   * both seeing "no existing line" and both attempting the `create`
   * branch — the unique index is what actually decides, letting exactly
   * one `INSERT` through and surfacing the loser as a `P2002` violation
   * (the exact same failure mode fixed in
   * `PrismaCheckoutSessionRepository.create`'s own doc comment). The
   * catch block below is the real backstop: on that violation, re-read
   * the now-existing row and consolidate into it instead of ever letting
   * a concurrent double-add throw. */
  async addItem(cartId: string, input: AddCartItemInput): Promise<CartItem> {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.cartItem.findUnique({
          where: {
            cartId_productSkuId_configurationHash: {
              cartId,
              productSkuId: input.productSkuId,
              configurationHash: input.configurationHash,
            },
          },
        });

        if (existing) {
          const updated = await tx.cartItem.update({
            where: { id: existing.id },
            data: {
              quantity: existing.quantity + input.quantity,
              unitPriceSnapshot: input.unitPriceSnapshot,
            },
          });
          return cartItemToDomain(updated);
        }

        const created = await tx.cartItem.create({
          data: {
            id: randomUUID(),
            cartId,
            productSkuId: input.productSkuId,
            quantity: input.quantity,
            unitPriceSnapshot: input.unitPriceSnapshot,
            currency: input.currency,
            configurationSnapshot: (input.configurationSnapshot ?? undefined) as
              Prisma.InputJsonValue | undefined,
            configurationHash: input.configurationHash,
          },
        });

        if (input.options && input.options.length > 0) {
          await tx.cartItemOption.createMany({
            data: input.options.map((option) => ({
              id: randomUUID(),
              cartItemId: created.id,
              optionType: option.optionType,
              optionKey: option.optionKey,
              optionLabel: option.optionLabel ?? null,
              priceAdjustment: option.priceAdjustment ?? null,
            })),
          });
        }

        return cartItemToDomain(created);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        // `meta.target` on Postgres is the violated column list, not the
        // constraint's name (confirmed empirically — Prisma does not
        // normalize this the way one might assume from other databases).
        (error.meta?.['target'] as string[] | undefined)?.includes('configuration_hash')
      ) {
        const existing = await prisma.cartItem.findUniqueOrThrow({
          where: {
            cartId_productSkuId_configurationHash: {
              cartId,
              productSkuId: input.productSkuId,
              configurationHash: input.configurationHash,
            },
          },
        });
        const updated = await prisma.cartItem.update({
          where: { id: existing.id },
          data: {
            quantity: existing.quantity + input.quantity,
            unitPriceSnapshot: input.unitPriceSnapshot,
          },
        });
        return cartItemToDomain(updated);
      }
      throw error;
    }
  }

  async updateItemQuantity(cartItemId: string, quantity: number): Promise<CartItem> {
    const row = await prisma.cartItem.update({ where: { id: cartItemId }, data: { quantity } });
    return cartItemToDomain(row);
  }

  async removeItem(cartItemId: string): Promise<void> {
    await prisma.cartItem.delete({ where: { id: cartItemId } });
  }

  async clearItems(cartId: string): Promise<void> {
    await prisma.cartItem.deleteMany({ where: { cartId } });
  }

  async recordPriceSnapshot(
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
  ) {
    const row = await prisma.cartPriceSnapshot.create({
      data: {
        id: randomUUID(),
        cartId,
        currency: props.currency,
        subtotal: props.subtotal,
        discountTotal: props.discountTotal,
        taxTotal: props.taxTotal,
        shippingTotal: props.shippingTotal,
        grandTotal: props.grandTotal,
        breakdown: breakdownToJson(props.breakdown),
      },
    });
    return cartPriceSnapshotToDomain(row);
  }

  async applyCoupon(
    cartId: string,
    props: { couponId: string; code: string; resolvedDiscount: bigint },
  ) {
    const row = await prisma.cartCoupon.upsert({
      where: { cartId },
      create: {
        id: randomUUID(),
        cartId,
        couponId: props.couponId,
        code: props.code,
        resolvedDiscount: props.resolvedDiscount,
      },
      update: {
        couponId: props.couponId,
        code: props.code,
        resolvedDiscount: props.resolvedDiscount,
        appliedAt: new Date(),
      },
    });
    return cartCouponToDomain(row);
  }

  async removeCoupon(cartId: string): Promise<void> {
    await prisma.cartCoupon.deleteMany({ where: { cartId } });
  }

  async setShippingSelection(
    cartId: string,
    props: { shippingMethodId: string; estimatedCost: bigint },
  ) {
    const row = await prisma.cartShippingSelection.upsert({
      where: { cartId },
      create: {
        id: randomUUID(),
        cartId,
        shippingMethodId: props.shippingMethodId,
        estimatedCost: props.estimatedCost,
      },
      update: { shippingMethodId: props.shippingMethodId, estimatedCost: props.estimatedCost },
    });
    return cartShippingSelectionToDomain(row);
  }
}

interface CartRowWithRelations {
  id: string;
  customerId: string | null;
  guestToken: string | null;
  status: Cart['status'];
  currency: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: (Parameters<typeof cartItemToDomain>[0] & {
    options: Parameters<typeof cartItemOptionToDomain>[0][];
  })[];
  coupons: Parameters<typeof cartCouponToDomain>[0][];
  shippingSelection: Parameters<typeof cartShippingSelectionToDomain>[0] | null;
}

function toAggregate(row: CartRowWithRelations): CartWithItems {
  return {
    cart: cartToDomain(row),
    items: row.items.map((item) =>
      Object.assign(cartItemToDomain(item), { options: item.options.map(cartItemOptionToDomain) }),
    ),
    coupon: row.coupons[0] ? cartCouponToDomain(row.coupons[0]) : null,
    shippingSelection: row.shippingSelection
      ? cartShippingSelectionToDomain(row.shippingSelection)
      : null,
  };
}
