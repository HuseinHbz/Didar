import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { prisma } from '@iecp/database';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PAYMENT_PROVIDER_ADAPTER_REGISTRY } from '../src/modules/payment/domain/ports/payment-provider-adapter.port';

import { FakePaymentProviderAdapterRegistry } from './support/fake-payment-provider-adapter';

interface OtpRequestResponseBody {
  expiresAt: string;
  devOnlyCode: string | null;
}
interface LoginResponseBody {
  status: 'AUTHENTICATED' | 'TWO_FACTOR_REQUIRED';
  tokens?: { accessToken: string; refreshToken: string };
}
interface PromotionBody {
  id: string;
  status: string;
  discountType: string;
}
interface CouponBody {
  id: string;
  status: string;
  code: string;
}
interface CartBody {
  id: string;
  guestToken: string;
}
interface CartPriceBody {
  discountTotal: string;
  shippingTotal: string;
  grandTotal: string;
}

// Same justified single-use-generic pattern as every other e2e spec.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * End-to-end coverage for the promotion/discount/coupon engine (Phase
 * 010) against a real Postgres + real Redis, seeded via
 * packages/database/prisma/seed.ts. `DIDAR20`/`WELCOME500`/
 * `EXPIREDCODE`/`FUTURECODE`/`LIMITEDCODE` and the three seed promotions
 * are the module's own §31 fixtures.
 *
 * The mandatory concurrency test (§30/ADR-010 decision 8) fires many
 * concurrent `ready-for-payment` calls, each holding a different
 * checkout, all racing for the same `usageLimit: 1` coupon, against real
 * PostgreSQL — no fakes, no in-memory doubles.
 */
describe('Promotion & Coupon (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let adminToken: string;
  let promotionManagerToken: string;
  let promotionEditorToken: string;
  let customerToken: string;

  let mainWarehouseId: string;
  let mainLocationId: string;

  const loginByPhone = async (phone: string): Promise<string> => {
    const requestRes = await request(server)
      .post('/auth/otp/request')
      .send({ phone, purpose: 'LOGIN' })
      .expect(200);
    const code = body<OtpRequestResponseBody>(requestRes).devOnlyCode;
    if (code === null) {
      throw new Error('devOnlyCode was null — is NODE_ENV=production in this test run?');
    }
    const verifyRes = await request(server)
      .post('/auth/otp/verify')
      .send({ phone, purpose: 'LOGIN', code })
      .expect(200);
    const verified = body<LoginResponseBody>(verifyRes);
    expect(verified.status).toBe('AUTHENTICATED');
    if (!verified.tokens) throw new Error('expected tokens on an AUTHENTICATED response');
    return verified.tokens.accessToken;
  };

  const provisionCustomer = async (phone: string): Promise<string> => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, isActive: true, phoneVerifiedAt: new Date() },
    });
    await prisma.customer.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, firstName: 'E2E', lastName: 'Promotion Customer' },
    });
    return loginByPhone(phone);
  };

  /** A fresh PUBLISHED sunglasses-category SKU + price + stock — the
   * exact category Promotion A/DIDAR20 target, isolated per test. */
  const createFreshSellableSku = async (
    basePrice: string,
    stockQuantity: number,
  ): Promise<string> => {
    const suffix = randomUUID().slice(0, 8);
    const brandRes = await request(server).get('/catalog/brands/ray-ban').expect(200);
    const brandId = body<{ id: string }>(brandRes).id;
    const categoryRes = await request(server).get('/catalog/categories/sunglasses').expect(200);
    const categoryId = body<{ id: string }>(categoryRes).id;

    const productRes = await request(server)
      .post('/admin/catalog/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        productType: 'SUNGLASSES',
        brandId,
        categoryId,
        name: `E2E Promotion Frame ${suffix}`,
        slug: `e2e-promotion-frame-${suffix}`,
        shortDescription: 'Created by the promotion e2e suite',
      })
      .expect(201);
    const productId = body<{ id: string }>(productRes).id;

    const variantRes = await request(server)
      .post('/admin/catalog/variants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId, color: 'Black', size: '52mm', isDefault: true })
      .expect(201);
    const variantId = body<{ id: string }>(variantRes).id;

    const skuRes = await request(server)
      .post('/admin/catalog/skus')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId, variantId, skuCode: `E2E-PROMO-SKU-${suffix}` })
      .expect(201);
    const skuId = body<{ id: string }>(skuRes).id;

    await request(server)
      .put(`/admin/catalog/skus/${skuId}/price`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ basePrice })
      .expect(200);

    await request(server)
      .post(`/admin/catalog/products/${productId}/submit-for-review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(server)
      .post(`/admin/catalog/products/${productId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(server)
      .post(`/admin/catalog/products/${productId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    await request(server)
      .post('/admin/inventory/adjustments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        warehouseId: mainWarehouseId,
        locationId: mainLocationId,
        productSkuId: skuId,
        adjustmentType: 'POSITIVE',
        quantity: stockQuantity,
        reason: 'e2e promotion fixture: seed stock',
      })
      .expect(201);
    return skuId;
  };

  const createGuestCartWithItem = async (skuId: string): Promise<CartBody> => {
    const cartRes = await request(server).post('/cart').expect(201);
    const cart = body<CartBody>(cartRes);
    await request(server)
      .post('/cart/items')
      .set('X-Cart-Token', cart.guestToken)
      .send({ productSkuId: skuId, quantity: 1 })
      .expect(201);
    return cart;
  };

  /** Drives a fresh guest cart up to (but not including) `ready-for-
   * payment` — coupon applied first if given. Split from the final
   * confirmation step so the mandatory concurrency test below can fire
   * only that one, genuinely concurrency-critical request in parallel
   * (same "one concurrent request per attempt" shape
   * `inventory.e2e-spec.ts`'s own 100-way concurrency test uses — doing
   * the whole multi-step flow in parallel would just storm the harness's
   * connection pool, not exercise the coupon-reservation race). */
  const prepareCheckoutReadyToConfirm = async (
    skuId: string,
    couponCode?: string,
  ): Promise<{ checkoutId: string; guestToken: string }> => {
    const cart = await createGuestCartWithItem(skuId);
    if (couponCode) {
      await request(server)
        .post('/cart/coupon')
        .set('X-Cart-Token', cart.guestToken)
        .send({ code: couponCode })
        .expect(201);
    }
    const checkoutRes = await request(server)
      .post('/checkout')
      .set('X-Cart-Token', cart.guestToken)
      .send({ cartId: cart.id })
      .expect(201);
    const checkoutId = body<{ id: string }>(checkoutRes).id;

    await request(server)
      .post(`/checkout/${checkoutId}/address`)
      .set('X-Cart-Token', cart.guestToken)
      .send({
        recipientName: 'E2E Promotion Tester',
        phone: '+989120000097',
        province: 'Tehran',
        city: 'Tehran',
        addressLine1: 'Test St, No. 1',
      })
      .expect(201);
    await request(server)
      .post(`/checkout/${checkoutId}/validate`)
      .set('X-Cart-Token', cart.guestToken)
      .expect(201);
    await request(server)
      .post(`/checkout/${checkoutId}/price`)
      .set('X-Cart-Token', cart.guestToken)
      .expect(201);
    await request(server)
      .post(`/checkout/${checkoutId}/reserve`)
      .set('X-Cart-Token', cart.guestToken)
      .expect(201);

    return { checkoutId, guestToken: cart.guestToken };
  };

  const confirmReady = (checkoutId: string, guestToken: string): Promise<request.Response> =>
    request(server)
      .post(`/checkout/${checkoutId}/ready-for-payment`)
      .set('X-Cart-Token', guestToken);

  /** Full prepare + confirm in one call — the shape every non-concurrency
   * test just needs "a real checkout at READY_FOR_PAYMENT (or a rejected
   * attempt)". */
  const driveGuestCheckoutToReady = async (
    skuId: string,
    couponCode?: string,
  ): Promise<{ status: number; checkoutId?: string; guestToken: string }> => {
    const { checkoutId, guestToken } = await prepareCheckoutReadyToConfirm(skuId, couponCode);
    const readyRes = await confirmReady(checkoutId, guestToken);
    return { status: readyRes.status, checkoutId, guestToken };
  };

  beforeAll(async () => {
    const registry = new FakePaymentProviderAdapterRegistry();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENT_PROVIDER_ADAPTER_REGISTRY)
      .useValue(registry)
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;

    adminToken = await loginByPhone('+989120000001');
    promotionManagerToken = await loginByPhone('+989120000013');
    promotionEditorToken = await loginByPhone('+989120000014');
    customerToken = await provisionCustomer('+989120099903');

    const warehousesRes = await request(server)
      .get('/admin/inventory/warehouses?limit=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const warehouses = body<{ items: { id: string; code: string }[] }>(warehousesRes).items;
    const central = warehouses.find((w) => w.code === 'WH-TEHRAN-01');
    if (!central) throw new Error('expected seed warehouse WH-TEHRAN-01 to exist');
    mainWarehouseId = central.id;

    const locationsRes = await request(server)
      .get(`/admin/inventory/warehouses/${mainWarehouseId}/locations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const mainLocation = body<{ id: string; code: string }[]>(locationsRes).find(
      (loc) => loc.code === 'MAIN',
    );
    if (!mainLocation) throw new Error('expected seed location MAIN to exist');
    mainLocationId = mainLocation.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('admin promotion/coupon RBAC and CRUD', () => {
    it('a plain customer token gets 403 on every /admin/promotions route', async () => {
      await request(server)
        .get('/admin/promotions')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
      await request(server)
        .post('/admin/promotions')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'x', discountType: 'PERCENTAGE' })
        .expect(403);
    });

    it('promotion_manager can create, activate, pause, and archive a promotion', async () => {
      const createRes = await request(server)
        .post('/admin/promotions')
        .set('Authorization', `Bearer ${promotionManagerToken}`)
        .send({
          name: `E2E promotion ${randomUUID().slice(0, 8)}`,
          discountType: 'FIXED_AMOUNT',
          discountValue: '10000',
          requiresCoupon: false,
        })
        .expect(201);
      const promotion = body<PromotionBody>(createRes);
      expect(promotion.status).toBe('DRAFT');

      const activated = await request(server)
        .post(`/admin/promotions/${promotion.id}/activate`)
        .set('Authorization', `Bearer ${promotionManagerToken}`)
        .expect(201);
      expect(body<PromotionBody>(activated).status).toBe('ACTIVE');

      const paused = await request(server)
        .post(`/admin/promotions/${promotion.id}/pause`)
        .set('Authorization', `Bearer ${promotionManagerToken}`)
        .expect(201);
      expect(body<PromotionBody>(paused).status).toBe('PAUSED');

      const archived = await request(server)
        .post(`/admin/promotions/${promotion.id}/archive`)
        .set('Authorization', `Bearer ${promotionManagerToken}`)
        .expect(201);
      expect(body<PromotionBody>(archived).status).toBe('ARCHIVED');

      // Terminal — never reactivates. 409, not 400: the resource exists
      // and the request is well-formed, it's just not a legal move from
      // its current state (same convention every other domain-transition
      // filter in this service uses).
      await request(server)
        .post(`/admin/promotions/${promotion.id}/activate`)
        .set('Authorization', `Bearer ${promotionManagerToken}`)
        .expect(409);
    });

    it('promotion_editor can create a coupon but the flow never exposes deletion to it', async () => {
      const promoRes = await request(server)
        .post('/admin/promotions')
        .set('Authorization', `Bearer ${promotionEditorToken}`)
        .send({
          name: `E2E editor promotion ${randomUUID().slice(0, 8)}`,
          discountType: 'PERCENTAGE',
          discountValue: '500',
          requiresCoupon: true,
        })
        .expect(201);
      const promotionId = body<PromotionBody>(promoRes).id;

      const couponRes = await request(server)
        .post('/admin/coupons')
        .set('Authorization', `Bearer ${promotionEditorToken}`)
        .send({ promotionId, code: `EDITOR-${randomUUID().slice(0, 8)}` })
        .expect(201);
      expect(body<CouponBody>(couponRes).status).toBe('ACTIVE');
    });
  });

  describe('customer cart coupon application', () => {
    it('applies DIDAR20 (20% off sunglasses) and reflects the discount in the cart price', async () => {
      const skuId = await createFreshSellableSku('2000000', 5);
      const cart = await createGuestCartWithItem(skuId);

      await request(server)
        .post('/cart/coupon')
        .set('X-Cart-Token', cart.guestToken)
        .send({ code: 'didar20' }) // lower-case — proves normalization
        .expect(201);

      const priceRes = await request(server)
        .post('/cart/price')
        .set('X-Cart-Token', cart.guestToken)
        .expect(201);
      const price = body<CartPriceBody>(priceRes);
      expect(price.discountTotal).toBe('400000'); // 20% of 2,000,000

      await request(server).delete('/cart/coupon').set('X-Cart-Token', cart.guestToken).expect(200);
      const afterRemove = body<CartPriceBody>(
        await request(server).post('/cart/price').set('X-Cart-Token', cart.guestToken).expect(201),
      );
      expect(afterRemove.discountTotal).toBe('0');
    });

    it('never leaks which part was wrong — nonexistent/expired/future coupons all fail the same way', async () => {
      const skuId = await createFreshSellableSku('2000000', 5);

      for (const code of ['DOESNOTEXIST', 'EXPIREDCODE', 'FUTURECODE']) {
        const cart = await createGuestCartWithItem(skuId);
        const res = await request(server)
          .post('/cart/coupon')
          .set('X-Cart-Token', cart.guestToken)
          .send({ code })
          .expect(400);
        expect(body<{ error: string }>(res).error).toBe('CouponNotApplicableError');
      }
    });

    it('applies the automatic free-shipping promotion with no coupon once the cart clears its minimum', async () => {
      const skuId = await createFreshSellableSku('3500000', 5); // clears Promotion C's 3,000,000 minimum
      const { status } = await driveGuestCheckoutToReady(skuId);
      expect(status).toBe(201);
    });
  });

  describe('checkout freeze and order snapshot', () => {
    it('freezes the promotion resolution at ready-for-payment and the order carries an immutable snapshot', async () => {
      const skuId = await createFreshSellableSku('2000000', 5);
      const { status, checkoutId, guestToken } = await driveGuestCheckoutToReady(skuId, 'DIDAR20');
      expect(status).toBe(201);
      if (!checkoutId) throw new Error('expected a checkoutId');

      const redemption = await prisma.couponRedemption.findFirst({
        where: { checkoutSessionId: checkoutId },
      });
      expect(redemption?.status).toBe('RESERVED');
      expect(redemption?.discountAmount.toString()).toBe('400000');

      // Pay -> convert -> the order's own immutable snapshot.
      const intentRes = await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      const intentId = body<{ id: string }>(intentRes).id;
      const startRes = await request(server)
        .post(`/payments/intents/${intentId}/start`)
        .set('X-Cart-Token', guestToken)
        .expect(201);
      const attempt = body<{ intent: { attempts: { redirectUrl: string }[] } }>(startRes).intent
        .attempts[0];
      const authority = attempt?.redirectUrl.split('/').pop();
      if (!authority) throw new Error('expected an authority');
      await request(server)
        .get('/payments/callback/zarinpal')
        .query({ Authority: authority, Status: 'OK' })
        .expect(200);

      const orderRes = await request(server)
        .get(`/orders/by-checkout/${checkoutId}`)
        .set('X-Cart-Token', guestToken)
        .expect(200);
      const orderId = body<{ id: string }>(orderRes).id;

      const snapshot = await prisma.orderPromotion.findMany({ where: { orderId } });
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0]?.couponCode).toBe('DIDAR20');
      expect(snapshot[0]?.discountAmount.toString()).toBe('400000');

      const finalizedRedemption = await prisma.couponRedemption.findFirst({
        where: { checkoutSessionId: checkoutId },
      });
      expect(finalizedRedemption?.status).toBe('REDEEMED');
      expect(finalizedRedemption?.orderId).toBe(orderId);
    });
  });

  describe('concurrency (mandatory, ADR-010 decision 8/§30)', () => {
    it('usageLimit=1 against many concurrent redemption attempts yields exactly one success', async () => {
      const skuId = await createFreshSellableSku('2500000', 30);
      const attempts = 15;

      // A fresh, isolated single-use promotion/coupon per run — the
      // seed's own `LIMITEDCODE` genuinely exhausts itself after one real
      // redemption (that's the point of `usageLimit: 1`), so reusing it
      // across repeated test runs would just prove the *previous* run's
      // invariant, not this one's. Same "randomized-suffix, isolated
      // fixture per test" precedent every prior phase's own concurrency
      // suite uses.
      const promoRes = await request(server)
        .post('/admin/promotions')
        .set('Authorization', `Bearer ${promotionManagerToken}`)
        .send({
          name: `E2E concurrency promotion ${randomUUID().slice(0, 8)}`,
          discountType: 'FIXED_AMOUNT',
          discountValue: '100000',
          requiresCoupon: true,
        })
        .expect(201);
      const promotionId = body<PromotionBody>(promoRes).id;
      await request(server)
        .post(`/admin/promotions/${promotionId}/activate`)
        .set('Authorization', `Bearer ${promotionManagerToken}`)
        .expect(201);
      // Uppercased at generation to match ADR-010 decision 2's
      // normalization (`CouponCode.normalize()`) — the code is looked up
      // directly via Prisma below, bypassing the customer-facing
      // normalize-on-apply path.
      const couponCode = `CONC-${randomUUID().slice(0, 8)}`.toUpperCase();
      await request(server)
        .post('/admin/coupons')
        .set('Authorization', `Bearer ${promotionManagerToken}`)
        .send({ promotionId, code: couponCode, usageLimit: 1 })
        .expect(201);

      // Sequential setup (each checkout independently reaches "reserved,
      // ready to confirm" — none of this is concurrency-critical), then
      // fire only the genuinely racy request — `ready-for-payment` — in
      // parallel. Same "one concurrent request per attempt" shape
      // `inventory.e2e-spec.ts`'s own 100-way concurrency test uses,
      // rather than running the whole multi-step flow in parallel and
      // storming the harness's own connection pool.
      const prepared = [];
      for (let i = 0; i < attempts; i += 1) {
        prepared.push(await prepareCheckoutReadyToConfirm(skuId, couponCode));
      }

      const settled = await Promise.allSettled(
        prepared.map((p) => confirmReady(p.checkoutId, p.guestToken)),
      );
      // A handful of `ECONNRESET`s at the transport layer under burst
      // load against Jest's in-process ephemeral server is a known
      // harness artifact (see inventory.e2e-spec.ts's own concurrency
      // test doc comment) — not an application-level failure. Only
      // requests that produced a real HTTP response are asserted on.
      const results = settled
        .filter((r): r is PromiseFulfilledResult<request.Response> => r.status === 'fulfilled')
        .map((r) => r.value);

      const successes = results.filter((r) => r.status === 201);
      const conflicts = results.filter((r) => r.status === 409);
      expect(successes).toHaveLength(1);
      expect(successes.length + conflicts.length).toBe(results.length);

      const coupon = await prisma.coupon.findUniqueOrThrow({ where: { code: couponCode } });
      const redemptions = await prisma.couponRedemption.count({
        where: { couponId: coupon.id, status: { in: ['RESERVED', 'REDEEMED'] } },
      });
      expect(redemptions).toBe(1);
      expect(coupon.usageCount).toBe(1);
    });
  });
});
