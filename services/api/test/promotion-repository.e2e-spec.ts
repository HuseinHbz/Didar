import { randomUUID } from 'node:crypto';

import { prisma } from '@iecp/database';

import { PrismaCouponRepository } from '../src/modules/promotion/infrastructure/repositories/prisma-coupon.repository';
import { PrismaPromotionRepository } from '../src/modules/promotion/infrastructure/repositories/prisma-promotion.repository';

/**
 * Repository/transaction-boundary integration tests for the promotion
 * engine (§29). Unlike `promotion.e2e-spec.ts`, this file boots no Nest
 * application and makes no HTTP calls — it drives `PrismaPromotionRepository`/
 * `PrismaCouponRepository` directly against a real Postgres, the same way
 * `promotion.e2e-spec.ts` exercises the HTTP surface against one. This is
 * this codebase's own established "integration" tier: no prior phase
 * (identity through order) ever introduced a separate Jest project for
 * it, so — matching that precedent exactly — this file lives alongside
 * the HTTP e2e suite and runs under the same `test:e2e` script/real-DB
 * setup, just skipping the controller/guard/HTTP layer entirely to isolate
 * the repository's own transaction/lock behavior.
 *
 * `CouponRedemption.checkoutSessionId` is a deliberately unenforced
 * cross-schema pointer (ADR-010 decision 8's own doc comment; same
 * "cross-schema pointer, not FK-enforced" convention every prior phase
 * uses for `Order.checkoutSessionId`-adjacent fields) — every
 * `checkoutSessionId` below is a bare `randomUUID()`, no real checkout
 * session required to exercise the reservation ledger in isolation.
 *
 * Every promotion created here targets one throwaway `randomUUID()` SKU
 * (never zero target rows) — ADR-010 decision 4's "zero target rows
 * means the whole cart" rule means an untargeted `ACTIVE` promotion
 * would otherwise auto-apply to every real cart in this shared database,
 * corrupting `promotion.e2e-spec.ts`'s own `discountTotal` assertions
 * when both files run in the same `test:e2e` process — a real bug this
 * suite found and fixed on itself the first time it ran alongside its
 * sibling.
 */
describe('Promotion/Coupon repositories (integration)', () => {
  const promotions = new PrismaPromotionRepository();
  const coupons = new PrismaCouponRepository();

  const createActivePromotion = async (
    overrides: Partial<{
      usageLimit: number | null;
      perCustomerLimit: number | null;
      requiresCoupon: boolean;
    }> = {},
  ) => {
    const promotion = await promotions.create({
      name: `Integration promotion ${randomUUID().slice(0, 8)}`,
      description: null,
      priority: 100,
      startsAt: null,
      endsAt: null,
      usageLimit: overrides.usageLimit ?? null,
      perCustomerLimit: overrides.perCustomerLimit ?? null,
      stackable: true,
      exclusive: false,
      minimumCartValue: null,
      maximumDiscount: null,
      currency: 'IRR',
      requiresCoupon: overrides.requiresCoupon ?? false,
      discountType: 'FIXED_AMOUNT',
      discountValue: 50_000n,
      buyQuantity: null,
      getQuantity: null,
      getDiscountBasisPoints: null,
      bundlePrice: null,
      rules: [],
      // Never zero rows — see the file-level doc comment above.
      targets: [{ type: 'SKU', refId: randomUUID() }],
    });
    return promotions.updateStatus(promotion.id, 'ACTIVE');
  };

  const createActiveCoupon = async (
    promotionId: string,
    usageLimit: number | null,
    perCustomerLimit: number | null = null,
  ) => {
    const coupon = await coupons.create({
      promotionId,
      code: `INT-${randomUUID().slice(0, 8)}`.toUpperCase(),
      startsAt: null,
      expiresAt: null,
      usageLimit,
      perCustomerLimit,
      metadata: null,
    });
    return coupons.updateStatus(coupon.id, 'ACTIVE');
  };

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('reserve() concurrency at the repository layer, no HTTP involved', () => {
    it('usageLimit=1 against 20 concurrent reserve() calls yields exactly one RESERVED row', async () => {
      const promotion = await createActivePromotion({ requiresCoupon: true });
      const coupon = await createActiveCoupon(promotion.id, 1);

      const attempts = 20;
      const settled = await Promise.allSettled(
        Array.from({ length: attempts }, () =>
          coupons.reserve({
            promotionId: promotion.id,
            couponId: coupon.id,
            customerId: null,
            guestToken: randomUUID(),
            checkoutSessionId: randomUUID(),
            discountAmount: 50_000n,
            promotionUsageLimit: null,
            promotionPerCustomerLimit: null,
            couponUsageLimit: 1,
            couponPerCustomerLimit: null,
          }),
        ),
      );

      const succeeded = settled.filter((r) => r.status === 'fulfilled');
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(attempts - 1);
      for (const failure of rejected) {
        expect((failure.reason as Error).name).toBe('CouponUsageLimitExceededError');
      }

      const finalCoupon = await coupons.findById(coupon.id);
      expect(finalCoupon?.usageCount).toBe(1);
      const activeRedemptions = await prisma.couponRedemption.count({
        where: { couponId: coupon.id, status: { in: ['RESERVED', 'REDEEMED'] } },
      });
      expect(activeRedemptions).toBe(1);
    });

    it('perCustomerLimit=1 blocks a second reservation from the same customer even with global capacity left', async () => {
      const promotion = await createActivePromotion({ requiresCoupon: true });
      const coupon = await createActiveCoupon(promotion.id, 100, 1);
      const customerId = randomUUID();

      await coupons.reserve({
        promotionId: promotion.id,
        couponId: coupon.id,
        customerId,
        guestToken: null,
        checkoutSessionId: randomUUID(),
        discountAmount: 50_000n,
        promotionUsageLimit: null,
        promotionPerCustomerLimit: null,
        couponUsageLimit: 100,
        couponPerCustomerLimit: 1,
      });

      await expect(
        coupons.reserve({
          promotionId: promotion.id,
          couponId: coupon.id,
          customerId,
          guestToken: null,
          checkoutSessionId: randomUUID(),
          discountAmount: 50_000n,
          promotionUsageLimit: null,
          promotionPerCustomerLimit: null,
          couponUsageLimit: 100,
          couponPerCustomerLimit: 1,
        }),
      ).rejects.toThrow('Coupon usage limit reached');

      // A different customer against the same coupon is unaffected — the
      // limit is genuinely per-customer, not a disguised global one.
      const other = await coupons.reserve({
        promotionId: promotion.id,
        couponId: coupon.id,
        customerId: randomUUID(),
        guestToken: null,
        checkoutSessionId: randomUUID(),
        discountAmount: 50_000n,
        promotionUsageLimit: null,
        promotionPerCustomerLimit: null,
        couponUsageLimit: 100,
        couponPerCustomerLimit: 1,
      });
      expect(other.status).toBe('RESERVED');
    });

    it('re-reserving the same (checkoutSessionId, promotionId) pair upserts, never double-counts usage', async () => {
      const promotion = await createActivePromotion({ requiresCoupon: true });
      const coupon = await createActiveCoupon(promotion.id, 5);
      const checkoutSessionId = randomUUID();

      const first = await coupons.reserve({
        promotionId: promotion.id,
        couponId: coupon.id,
        customerId: null,
        guestToken: randomUUID(),
        checkoutSessionId,
        discountAmount: 50_000n,
        promotionUsageLimit: null,
        promotionPerCustomerLimit: null,
        couponUsageLimit: 5,
        couponPerCustomerLimit: null,
      });
      // Same checkout re-prices/re-freezes with a different amount — this
      // must update the existing row, not insert a second one.
      const second = await coupons.reserve({
        promotionId: promotion.id,
        couponId: coupon.id,
        customerId: null,
        guestToken: randomUUID(),
        checkoutSessionId,
        discountAmount: 60_000n,
        promotionUsageLimit: null,
        promotionPerCustomerLimit: null,
        couponUsageLimit: 5,
        couponPerCustomerLimit: null,
      });

      expect(second.id).toBe(first.id);
      expect(second.discountAmount).toBe(60_000n);
      const finalCoupon = await coupons.findById(coupon.id);
      expect(finalCoupon?.usageCount).toBe(1);
    });
  });

  describe('the RESERVED -> REDEEMED / RELEASED lifecycle, transactionally', () => {
    it('finalize() moves every RESERVED redemption for a checkout to REDEEMED with the order id set', async () => {
      const promotionA = await createActivePromotion();
      const promotionB = await createActivePromotion();
      const checkoutSessionId = randomUUID();
      const orderId = randomUUID();

      await coupons.reserve({
        promotionId: promotionA.id,
        couponId: null,
        customerId: null,
        guestToken: randomUUID(),
        checkoutSessionId,
        discountAmount: 10_000n,
        promotionUsageLimit: null,
        promotionPerCustomerLimit: null,
        couponUsageLimit: null,
        couponPerCustomerLimit: null,
      });
      await coupons.reserve({
        promotionId: promotionB.id,
        couponId: null,
        customerId: null,
        guestToken: randomUUID(),
        checkoutSessionId,
        discountAmount: 20_000n,
        promotionUsageLimit: null,
        promotionPerCustomerLimit: null,
        couponUsageLimit: null,
        couponPerCustomerLimit: null,
      });

      const finalized = await coupons.finalize(checkoutSessionId, orderId);
      expect(finalized).toHaveLength(2);
      expect(finalized.every((r) => r.status === 'REDEEMED')).toBe(true);
      expect(finalized.every((r) => r.orderId === orderId)).toBe(true);

      // Idempotent — re-running finalize() on an already-REDEEMED checkout
      // changes nothing (the sweep/order-conversion resumption path relies
      // on exactly this).
      const replay = await coupons.finalize(checkoutSessionId, orderId);
      expect(replay.every((r) => r.status === 'REDEEMED')).toBe(true);
    });

    it('release() decrements usageCount and is idempotent against an already-released checkout', async () => {
      const promotion = await createActivePromotion({ requiresCoupon: true });
      const coupon = await createActiveCoupon(promotion.id, 5);
      const checkoutSessionId = randomUUID();

      await coupons.reserve({
        promotionId: promotion.id,
        couponId: coupon.id,
        customerId: null,
        guestToken: randomUUID(),
        checkoutSessionId,
        discountAmount: 50_000n,
        promotionUsageLimit: null,
        promotionPerCustomerLimit: null,
        couponUsageLimit: 5,
        couponPerCustomerLimit: null,
      });
      expect((await coupons.findById(coupon.id))?.usageCount).toBe(1);

      const released = await coupons.release(checkoutSessionId);
      expect(released.every((r) => r.status === 'RELEASED')).toBe(true);
      expect((await coupons.findById(coupon.id))?.usageCount).toBe(0);

      // Releasing again is a no-op — it must never decrement past zero.
      await coupons.release(checkoutSessionId);
      expect((await coupons.findById(coupon.id))?.usageCount).toBe(0);

      // Capacity freed by release() is usable again by a fresh checkout.
      const reReserved = await coupons.reserve({
        promotionId: promotion.id,
        couponId: coupon.id,
        customerId: null,
        guestToken: randomUUID(),
        checkoutSessionId: randomUUID(),
        discountAmount: 50_000n,
        promotionUsageLimit: null,
        promotionPerCustomerLimit: null,
        couponUsageLimit: 5,
        couponPerCustomerLimit: null,
      });
      expect(reReserved.status).toBe('RESERVED');
    });

    it('listStaleReservations() only returns RESERVED rows older than the cutoff', async () => {
      const promotion = await createActivePromotion();
      const checkoutSessionId = randomUUID();
      await coupons.reserve({
        promotionId: promotion.id,
        couponId: null,
        customerId: null,
        guestToken: randomUUID(),
        checkoutSessionId,
        discountAmount: 10_000n,
        promotionUsageLimit: null,
        promotionPerCustomerLimit: null,
        couponUsageLimit: null,
        couponPerCustomerLimit: null,
      });

      const cutoffInFuture = new Date(Date.now() + 60_000);
      const stale = await coupons.listStaleReservations(cutoffInFuture);
      expect(stale.some((r) => r.checkoutSessionId === checkoutSessionId)).toBe(true);

      const cutoffInPast = new Date(Date.now() - 60_000);
      const notYetStale = await coupons.listStaleReservations(cutoffInPast);
      expect(notYetStale.some((r) => r.checkoutSessionId === checkoutSessionId)).toBe(false);
    });
  });

  describe('promotion repository transitions', () => {
    it('listActive() only returns promotions whose window covers now', async () => {
      const now = new Date();
      const past = await promotions.create({
        name: `Integration expired promotion ${randomUUID().slice(0, 8)}`,
        description: null,
        priority: 100,
        startsAt: new Date(now.getTime() - 2 * 60 * 60_000),
        endsAt: new Date(now.getTime() - 60 * 60_000),
        usageLimit: null,
        perCustomerLimit: null,
        stackable: true,
        exclusive: false,
        minimumCartValue: null,
        maximumDiscount: null,
        currency: 'IRR',
        requiresCoupon: false,
        discountType: 'FIXED_AMOUNT',
        discountValue: 10_000n,
        buyQuantity: null,
        getQuantity: null,
        getDiscountBasisPoints: null,
        bundlePrice: null,
        rules: [],
        targets: [{ type: 'SKU', refId: randomUUID() }],
      });
      await promotions.updateStatus(past.id, 'ACTIVE');
      const current = await createActivePromotion();

      const active = await promotions.listActive(now);
      const activeIds = new Set(active.map((p) => p.id));
      expect(activeIds.has(current.id)).toBe(true);
      expect(activeIds.has(past.id)).toBe(false);
    });

    it('listExpiredNotMarked() finds an ACTIVE promotion whose endsAt has passed', async () => {
      const now = new Date();
      const promotion = await promotions.create({
        name: `Integration sweep-target promotion ${randomUUID().slice(0, 8)}`,
        description: null,
        priority: 100,
        startsAt: null,
        endsAt: new Date(now.getTime() - 60_000),
        usageLimit: null,
        perCustomerLimit: null,
        stackable: true,
        exclusive: false,
        minimumCartValue: null,
        maximumDiscount: null,
        currency: 'IRR',
        requiresCoupon: false,
        discountType: 'FIXED_AMOUNT',
        discountValue: 10_000n,
        buyQuantity: null,
        getQuantity: null,
        getDiscountBasisPoints: null,
        bundlePrice: null,
        rules: [],
        targets: [{ type: 'SKU', refId: randomUUID() }],
      });
      await promotions.updateStatus(promotion.id, 'ACTIVE');

      const due = await promotions.listExpiredNotMarked(now);
      expect(due.some((p) => p.id === promotion.id)).toBe(true);

      const expired = await promotions.updateStatus(promotion.id, 'EXPIRED');
      expect(expired.status).toBe('EXPIRED');
      const dueAfter = await promotions.listExpiredNotMarked(now);
      expect(dueAfter.some((p) => p.id === promotion.id)).toBe(false);
    });
  });
});
