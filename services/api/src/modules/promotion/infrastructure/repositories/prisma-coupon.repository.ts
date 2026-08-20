import { randomUUID } from 'node:crypto';

import { Prisma, prisma, type PrismaClient } from '@iecp/database';
import type { CouponStatus } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { CouponRedemption } from '../../domain/entities/coupon-redemption.entity';
import { Coupon } from '../../domain/entities/coupon.entity';
import { CouponUsageLimitExceededError } from '../../domain/errors/promotion-domain.errors';
import type {
  CouponRepositoryPort,
  CreateCouponInput,
} from '../../domain/ports/coupon.repository.port';

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Row-locks the coupon (if `couponId` given) or the promotion
 * (couponless path) with `SELECT ... FOR UPDATE` — the same technique
 * `mutateInventoryItem`/`lockAndSumFulfilled` already established — so
 * two truly concurrent reservation attempts for the same coupon/promotion
 * serialize on this lock rather than racing a check-then-insert. */
async function lockCounterRow(
  tx: TxClient,
  table: 'coupons' | 'promotions',
  id: string,
): Promise<{ usageCount: number; usageLimit: number | null }> {
  const rows = await tx.$queryRaw<{ usage_count: number; usage_limit: number | null }[]>(
    Prisma.sql`SELECT usage_count, usage_limit FROM marketing.${Prisma.raw(table)} WHERE id = ${id}::uuid FOR UPDATE`,
  );
  const row = rows[0];
  if (!row) throw new Error(`${table} row ${id} not found`);
  return { usageCount: row.usage_count, usageLimit: row.usage_limit };
}

async function countActive(
  tx: TxClient,
  where: { promotionId?: string; couponId?: string; customerId?: string },
): Promise<number> {
  const conditions: Prisma.Sql[] = [Prisma.sql`status IN ('RESERVED', 'REDEEMED')`];
  if (where.promotionId) conditions.push(Prisma.sql`promotion_id = ${where.promotionId}::uuid`);
  if (where.couponId) conditions.push(Prisma.sql`coupon_id = ${where.couponId}::uuid`);
  if (where.customerId) conditions.push(Prisma.sql`customer_id = ${where.customerId}::uuid`);
  const rows = await tx.$queryRaw<{ count: bigint }[]>(
    Prisma.sql`SELECT COUNT(*)::bigint AS count FROM marketing.coupon_redemptions WHERE ${Prisma.join(conditions, ' AND ')}`,
  );
  return Number(rows[0]?.count ?? 0n);
}

function toEntity(row: {
  id: string;
  promotionId: string;
  couponId: string | null;
  customerId: string | null;
  guestToken: string | null;
  checkoutSessionId: string;
  orderId: string | null;
  status: CouponRedemption['status'];
  discountAmount: bigint;
}): CouponRedemption {
  return CouponRedemption.fromPersistence(row);
}

@Injectable()
export class PrismaCouponRepository implements CouponRepositoryPort {
  async create(input: CreateCouponInput): Promise<Coupon> {
    const row = await prisma.coupon.create({
      data: {
        promotionId: input.promotionId,
        code: input.code,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        usageLimit: input.usageLimit,
        perCustomerLimit: input.perCustomerLimit,
        metadata: (input.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
    return Coupon.fromPersistence(row);
  }

  async findById(id: string): Promise<Coupon | null> {
    const row = await prisma.coupon.findUnique({ where: { id } });
    return row ? Coupon.fromPersistence(row) : null;
  }

  async findByCode(code: string): Promise<Coupon | null> {
    const row = await prisma.coupon.findUnique({ where: { code } });
    return row ? Coupon.fromPersistence(row) : null;
  }

  async listByPromotion(promotionId: string): Promise<Coupon[]> {
    const rows = await prisma.coupon.findMany({ where: { promotionId }, orderBy: { code: 'asc' } });
    return rows.map((row) => Coupon.fromPersistence(row));
  }

  async updateStatus(id: string, status: CouponStatus): Promise<Coupon> {
    const row = await prisma.coupon.update({ where: { id }, data: { status } });
    return Coupon.fromPersistence(row);
  }

  async listExpiredNotMarked(now: Date): Promise<Coupon[]> {
    const rows = await prisma.coupon.findMany({
      where: { status: { in: ['ACTIVE', 'PAUSED'] }, expiresAt: { lt: now } },
    });
    return rows.map((row) => Coupon.fromPersistence(row));
  }

  /** ADR-010 decision 8 — the one concurrency-critical write. See the
   * port's own doc comment for the full contract. */
  async reserve(input: {
    promotionId: string;
    couponId: string | null;
    customerId: string | null;
    guestToken: string | null;
    checkoutSessionId: string;
    discountAmount: bigint;
    promotionUsageLimit: number | null;
    promotionPerCustomerLimit: number | null;
    couponUsageLimit: number | null;
    couponPerCustomerLimit: number | null;
  }): Promise<CouponRedemption> {
    return prisma.$transaction(async (tx) => {
      // Row-lock the tightest-scoped counter first (coupon if present,
      // else the promotion itself) — serializes every concurrent
      // reservation attempt for this coupon/promotion on one lock.
      if (input.couponId) {
        await lockCounterRow(tx, 'coupons', input.couponId);
      } else {
        await lockCounterRow(tx, 'promotions', input.promotionId);
      }

      // Re-pricing the same checkout for the same promotion upserts its
      // existing reservation instead of creating a second one — check
      // first so an update never gets counted as new usage.
      const existing = await tx.couponRedemption.findUnique({
        where: {
          checkoutSessionId_promotionId: {
            checkoutSessionId: input.checkoutSessionId,
            promotionId: input.promotionId,
          },
        },
      });
      if (existing && existing.status !== 'RELEASED') {
        const updated = await tx.couponRedemption.update({
          where: { id: existing.id },
          data: { discountAmount: input.discountAmount },
        });
        return toEntity(updated);
      }

      const globalCount = await countActive(tx, {
        promotionId: input.promotionId,
        ...(input.couponId ? { couponId: input.couponId } : {}),
      });
      if (input.promotionUsageLimit !== null && globalCount >= input.promotionUsageLimit) {
        throw new CouponUsageLimitExceededError();
      }
      if (input.couponId && input.couponUsageLimit !== null) {
        const couponGlobalCount = await countActive(tx, { couponId: input.couponId });
        if (couponGlobalCount >= input.couponUsageLimit) {
          throw new CouponUsageLimitExceededError();
        }
      }
      if (input.customerId) {
        if (input.promotionPerCustomerLimit !== null) {
          const perCustomer = await countActive(tx, {
            promotionId: input.promotionId,
            customerId: input.customerId,
          });
          if (perCustomer >= input.promotionPerCustomerLimit) {
            throw new CouponUsageLimitExceededError();
          }
        }
        if (input.couponId && input.couponPerCustomerLimit !== null) {
          const perCustomer = await countActive(tx, {
            couponId: input.couponId,
            customerId: input.customerId,
          });
          if (perCustomer >= input.couponPerCustomerLimit) {
            throw new CouponUsageLimitExceededError();
          }
        }
      }

      const created = existing
        ? await tx.couponRedemption.update({
            where: { id: existing.id },
            data: {
              status: 'RESERVED',
              discountAmount: input.discountAmount,
              customerId: input.customerId,
              guestToken: input.guestToken,
              redeemedAt: null,
              releasedAt: null,
            },
          })
        : await tx.couponRedemption.create({
            data: {
              id: randomUUID(),
              promotionId: input.promotionId,
              couponId: input.couponId,
              customerId: input.customerId,
              guestToken: input.guestToken,
              checkoutSessionId: input.checkoutSessionId,
              discountAmount: input.discountAmount,
              status: 'RESERVED',
            },
          });

      // Bump the cached counters — the CHECK constraint
      // (`promotion_usage_within_limit`/`coupon_usage_within_limit`) is
      // the real backstop if this increment logic is ever wrong; it is
      // not the primary mechanism, the lock + re-sum above is.
      if (!existing) {
        await tx.promotion.update({
          where: { id: input.promotionId },
          data: { usageCount: { increment: 1 } },
        });
        if (input.couponId) {
          await tx.coupon.update({
            where: { id: input.couponId },
            data: { usageCount: { increment: 1 } },
          });
        }
      }

      return toEntity(created);
    });
  }

  async finalize(checkoutSessionId: string, orderId: string): Promise<CouponRedemption[]> {
    await prisma.couponRedemption.updateMany({
      where: { checkoutSessionId, status: 'RESERVED' },
      data: { status: 'REDEEMED', orderId, redeemedAt: new Date() },
    });
    const rows = await prisma.couponRedemption.findMany({ where: { checkoutSessionId } });
    return rows.map(toEntity);
  }

  async release(checkoutSessionId: string): Promise<CouponRedemption[]> {
    return prisma.$transaction(async (tx) => {
      const toRelease = await tx.couponRedemption.findMany({
        where: { checkoutSessionId, status: 'RESERVED' },
      });
      for (const redemption of toRelease) {
        await tx.couponRedemption.update({
          where: { id: redemption.id },
          data: { status: 'RELEASED', releasedAt: new Date() },
        });
        await tx.promotion.update({
          where: { id: redemption.promotionId },
          data: { usageCount: { decrement: 1 } },
        });
        if (redemption.couponId) {
          await tx.coupon.update({
            where: { id: redemption.couponId },
            data: { usageCount: { decrement: 1 } },
          });
        }
      }
      const rows = await tx.couponRedemption.findMany({ where: { checkoutSessionId } });
      return rows.map(toEntity);
    });
  }

  async listByCheckout(checkoutSessionId: string): Promise<CouponRedemption[]> {
    const rows = await prisma.couponRedemption.findMany({ where: { checkoutSessionId } });
    return rows.map(toEntity);
  }

  async countByCustomer(
    promotionId: string,
    couponId: string | null,
    customerId: string,
  ): Promise<number> {
    return prisma.couponRedemption.count({
      where: {
        promotionId,
        customerId,
        status: { in: ['RESERVED', 'REDEEMED'] },
        ...(couponId ? { couponId } : {}),
      },
    });
  }

  async listStaleReservations(olderThan: Date): Promise<CouponRedemption[]> {
    const rows = await prisma.couponRedemption.findMany({
      where: { status: 'RESERVED', reservedAt: { lt: olderThan } },
    });
    return rows.map(toEntity);
  }
}
