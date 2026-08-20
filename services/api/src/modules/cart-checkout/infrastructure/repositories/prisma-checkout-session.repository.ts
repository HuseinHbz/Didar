import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@iecp/database';
import type { CheckoutStatus } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { CheckoutSession } from '../../domain/entities/checkout-session.entity';
import type { PriceLineBreakdown } from '../../domain/entities/price-breakdown.types';
import type {
  CheckoutSessionRepositoryPort,
  CheckoutSessionWithDetail,
} from '../../domain/ports/checkout-session.repository.port';
import { breakdownToJson } from '../cart.mapper';
import {
  checkoutAddressToDomain,
  checkoutReservationToDomain,
  checkoutSessionToDomain,
  checkoutTotalsToDomain,
  checkoutValidationToDomain,
} from '../checkout.mapper';

const DETAIL_INCLUDE = {
  address: true,
  totalsHistory: { orderBy: { calculatedAt: 'desc' as const }, take: 1 },
  validations: { orderBy: { validatedAt: 'desc' as const }, take: 1 },
  reservations: true,
} as const;

@Injectable()
export class PrismaCheckoutSessionRepository implements CheckoutSessionRepositoryPort {
  async findById(id: string): Promise<CheckoutSessionWithDetail | null> {
    const row = await prisma.checkoutSession.findUnique({ where: { id }, include: DETAIL_INCLUDE });
    if (!row) return null;
    return {
      session: checkoutSessionToDomain(row),
      address: row.address ? checkoutAddressToDomain(row.address) : null,
      latestTotals: row.totalsHistory[0] ? checkoutTotalsToDomain(row.totalsHistory[0]) : null,
      latestValidation: row.validations[0] ? checkoutValidationToDomain(row.validations[0]) : null,
      reservations: row.reservations.map(checkoutReservationToDomain),
    };
  }

  async findByIdempotencyKey(key: string): Promise<CheckoutSession | null> {
    const row = await prisma.checkoutSession.findUnique({ where: { idempotencyKey: key } });
    return row ? checkoutSessionToDomain(row) : null;
  }

  async listExpirable(now: Date): Promise<CheckoutSession[]> {
    const rows = await prisma.checkoutSession.findMany({
      where: {
        status: { in: ['OPEN', 'VALIDATING', 'READY_FOR_PAYMENT'] },
        expiresAt: { lt: now },
      },
    });
    return rows.map(checkoutSessionToDomain);
  }

  async listConvertedSince(since: Date): Promise<CheckoutSession[]> {
    const rows = await prisma.checkoutSession.findMany({
      where: { status: 'CONVERTED', updatedAt: { gte: since } },
    });
    return rows.map(checkoutSessionToDomain);
  }

  /**
   * Idempotent even under raw concurrent duplicate submissions — not just
   * on a retried request one-at-a-time. `upsert()` alone is not enough:
   * two simultaneous callers can both evaluate "no row for this
   * idempotencyKey yet" and both attempt the `create` branch, and
   * Postgres correctly lets exactly one of those `INSERT`s through,
   * surfacing the loser as a `P2002` unique-constraint violation rather
   * than silently falling back to `update` (confirmed empirically under
   * this module's own concurrency e2e test). The loser re-reads the
   * winner's row by the same `idempotencyKey` and returns it — the
   * brief's own "a retried request with the same key always resolves to
   * the same logical result, never a duplicate checkout session" holds
   * for concurrent racers, not only sequential retries.
   */
  async create(props: {
    cartId: string;
    customerId?: string | null;
    guestToken?: string | null;
    currency: string;
    idempotencyKey: string;
    expiresAt?: Date | null;
  }): Promise<CheckoutSession> {
    try {
      const row = await prisma.checkoutSession.upsert({
        where: { idempotencyKey: props.idempotencyKey },
        create: {
          id: randomUUID(),
          cartId: props.cartId,
          customerId: props.customerId ?? null,
          guestToken: props.guestToken ?? null,
          currency: props.currency,
          idempotencyKey: props.idempotencyKey,
          expiresAt: props.expiresAt ?? null,
        },
        update: {},
      });
      return checkoutSessionToDomain(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        (error.meta?.['target'] as string[] | undefined)?.includes('idempotency_key')
      ) {
        const existing = await prisma.checkoutSession.findUnique({
          where: { idempotencyKey: props.idempotencyKey },
        });
        if (existing) return checkoutSessionToDomain(existing);
      }
      throw error;
    }
  }

  async updateStatus(
    id: string,
    status: CheckoutStatus,
    extra?: { cancelledAt?: Date; convertedAt?: Date },
  ): Promise<CheckoutSession> {
    const row = await prisma.checkoutSession.update({
      where: { id },
      data: { status, cancelledAt: extra?.cancelledAt, convertedAt: extra?.convertedAt },
    });
    return checkoutSessionToDomain(row);
  }

  async extendExpiry(id: string, expiresAt: Date): Promise<CheckoutSession> {
    const row = await prisma.checkoutSession.update({ where: { id }, data: { expiresAt } });
    return checkoutSessionToDomain(row);
  }

  async setAddress(
    checkoutSessionId: string,
    props: {
      customerAddressId?: string | null;
      recipientName: string;
      phone: string;
      province: string;
      city: string;
      addressLine1: string;
      addressLine2?: string | null;
      postalCode?: string | null;
    },
  ) {
    const row = await prisma.checkoutAddress.upsert({
      where: { checkoutSessionId },
      create: {
        id: randomUUID(),
        checkoutSessionId,
        customerAddressId: props.customerAddressId ?? null,
        recipientName: props.recipientName,
        phone: props.phone,
        province: props.province,
        city: props.city,
        addressLine1: props.addressLine1,
        addressLine2: props.addressLine2 ?? null,
        postalCode: props.postalCode ?? null,
      },
      update: {
        customerAddressId: props.customerAddressId ?? null,
        recipientName: props.recipientName,
        phone: props.phone,
        province: props.province,
        city: props.city,
        addressLine1: props.addressLine1,
        addressLine2: props.addressLine2 ?? null,
        postalCode: props.postalCode ?? null,
      },
    });
    return checkoutAddressToDomain(row);
  }

  async recordTotals(
    checkoutSessionId: string,
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
    return prisma.$transaction(async (tx) => {
      await tx.checkoutSession.update({
        where: { id: checkoutSessionId },
        data: {
          currency: props.currency,
          subtotal: props.subtotal,
          discountTotal: props.discountTotal,
          taxTotal: props.taxTotal,
          shippingTotal: props.shippingTotal,
          grandTotal: props.grandTotal,
        },
      });
      const row = await tx.checkoutTotals.create({
        data: {
          id: randomUUID(),
          checkoutSessionId,
          currency: props.currency,
          subtotal: props.subtotal,
          discountTotal: props.discountTotal,
          taxTotal: props.taxTotal,
          shippingTotal: props.shippingTotal,
          grandTotal: props.grandTotal,
          breakdown: breakdownToJson(props.breakdown),
        },
      });
      return checkoutTotalsToDomain(row);
    });
  }

  async recordValidation(
    checkoutSessionId: string,
    props: {
      outcome: 'PASSED' | 'FAILED';
      issues: readonly { code: string; message: string; productSkuId?: string }[];
    },
  ) {
    const row = await prisma.checkoutValidationResult.create({
      data: {
        id: randomUUID(),
        checkoutSessionId,
        outcome: props.outcome,
        issues: props.issues,
      },
    });
    return checkoutValidationToDomain(row);
  }

  async addReservation(
    checkoutSessionId: string,
    props: {
      productSkuId: string;
      warehouseId: string;
      inventoryReservationId: string;
      quantity: number;
    },
  ) {
    const row = await prisma.checkoutReservation.upsert({
      where: {
        checkoutSessionId_productSkuId: { checkoutSessionId, productSkuId: props.productSkuId },
      },
      create: {
        id: randomUUID(),
        checkoutSessionId,
        productSkuId: props.productSkuId,
        warehouseId: props.warehouseId,
        inventoryReservationId: props.inventoryReservationId,
        quantity: props.quantity,
      },
      update: {
        warehouseId: props.warehouseId,
        inventoryReservationId: props.inventoryReservationId,
        quantity: props.quantity,
      },
    });
    return checkoutReservationToDomain(row);
  }

  async freezeSnapshots(
    checkoutSessionId: string,
    props: {
      pricingSnapshot: Record<string, unknown>;
      shippingSnapshot: Record<string, unknown> | null;
      addressSnapshot: Record<string, unknown>;
    },
  ): Promise<CheckoutSession> {
    const row = await prisma.checkoutSession.update({
      where: { id: checkoutSessionId },
      data: {
        pricingSnapshot: props.pricingSnapshot as Prisma.InputJsonValue,
        shippingSnapshot: (props.shippingSnapshot ?? undefined) as
          Prisma.InputJsonValue | undefined,
        addressSnapshot: props.addressSnapshot as Prisma.InputJsonValue,
      },
    });
    return checkoutSessionToDomain(row);
  }
}
