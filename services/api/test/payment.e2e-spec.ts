import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { prisma } from '@iecp/database';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PAYMENT_PROVIDER_ADAPTER_REGISTRY } from '../src/modules/payment/domain/ports/payment-provider-adapter.port';

import {
  type FakePaymentProviderAdapter,
  FakePaymentProviderAdapterRegistry,
} from './support/fake-payment-provider-adapter';

interface OtpRequestResponseBody {
  expiresAt: string;
  devOnlyCode: string | null;
}
interface LoginResponseBody {
  status: 'AUTHENTICATED' | 'TWO_FACTOR_REQUIRED';
  tokens?: { accessToken: string; refreshToken: string };
}

// Same justified single-use-generic pattern as identity/catalog/inventory/
// cart-checkout e2e specs.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * End-to-end coverage for the payment module (Phase 008) against a real
 * Postgres + real Redis, seeded via packages/database/prisma/seed.ts.
 * `+989120000001`/`+989120000002` are the seed's admin/customer users;
 * `+989120000009`/`+989120000010` are this phase's own `payment_manager`/
 * `finance_auditor` fixtures — all logged in via the real OTP flow.
 *
 * The real `PaymentProviderAdapterRegistry` is overridden with
 * `FakePaymentProviderAdapterRegistry` for the reason documented on that
 * class — every other layer (controllers, guards, services, repositories,
 * the state machines, the exception filter) is exercised for real.
 *
 * The mandatory concurrency tests (duplicate callback redelivery,
 * concurrent verification racing to create the same `PaymentTransaction`,
 * concurrent intent creation for the same checkout session) reuse a
 * fresh, isolated checkout-ready fixture per test, same "fresh fixture
 * per concurrency case" precedent inventory/cart-checkout's own e2e
 * suites set.
 */
describe('Payment (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let adminToken: string;
  let customerToken: string;
  let paymentManagerToken: string;
  let financeAuditorToken: string;
  let fakeAdapter: FakePaymentProviderAdapter;

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
    if (!verified.tokens) {
      throw new Error('expected tokens on an AUTHENTICATED response');
    }
    return verified.tokens.accessToken;
  };

  /** Creates a fresh PUBLISHED product + SKU + price + stock, isolated
   * from seed data and every other test — same precedent cart-checkout/
   * inventory's own e2e suites use. */
  const createFreshSellableSku = async (stockQuantity: number): Promise<string> => {
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
        name: `E2E Payment Frame ${suffix}`,
        slug: `e2e-payment-frame-${suffix}`,
        shortDescription: 'Created by the payment e2e suite',
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
      .send({ productId, variantId, skuCode: `E2E-PAYMENT-SKU-${suffix}` })
      .expect(201);
    const skuId = body<{ id: string }>(skuRes).id;

    await request(server)
      .put(`/admin/catalog/skus/${skuId}/price`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ basePrice: '5000000' })
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

    if (stockQuantity > 0) {
      await request(server)
        .post('/admin/inventory/adjustments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          warehouseId: mainWarehouseId,
          locationId: mainLocationId,
          productSkuId: skuId,
          adjustmentType: 'POSITIVE',
          quantity: stockQuantity,
          reason: 'e2e payment fixture: seed stock',
        })
        .expect(201);
    }
    return skuId;
  };

  /** Drives a fresh guest cart all the way to `READY_FOR_PAYMENT` —
   * every step `CheckoutController` exposes, none skipped. Returns the
   * checkout id, its guest token, and the frozen `grandTotal` this
   * checkout's payment intent must match. */
  const createReadyForPaymentCheckout = async (
    skuId: string,
  ): Promise<{ checkoutId: string; guestToken: string; grandTotal: string }> => {
    const cartRes = await request(server).post('/cart').expect(201);
    const cart = body<{ id: string; guestToken: string }>(cartRes);

    await request(server)
      .post('/cart/items')
      .set('X-Cart-Token', cart.guestToken)
      .send({ productSkuId: skuId, quantity: 1 })
      .expect(201);

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
        recipientName: 'E2E Payment Tester',
        phone: '+989120000099',
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

    const readyRes = await request(server)
      .post(`/checkout/${checkoutId}/ready-for-payment`)
      .set('X-Cart-Token', cart.guestToken)
      .expect(201);
    const ready = body<{ status: string; grandTotal: string }>(readyRes);
    expect(ready.status).toBe('READY_FOR_PAYMENT');

    return { checkoutId, guestToken: cart.guestToken, grandTotal: ready.grandTotal };
  };

  beforeAll(async () => {
    const registry = new FakePaymentProviderAdapterRegistry();
    fakeAdapter = registry.adapter;

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
    customerToken = await loginByPhone('+989120000002');
    paymentManagerToken = await loginByPhone('+989120000009');
    financeAuditorToken = await loginByPhone('+989120000010');

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

  // -------------------------------------------------------------------
  // Intent creation + start
  // -------------------------------------------------------------------
  describe('intent creation + start', () => {
    it('creates an intent for a READY_FOR_PAYMENT checkout, amount/currency from the frozen grandTotal', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken, grandTotal } = await createReadyForPaymentCheckout(sku);

      const res = await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      const intent = body<{ id: string; status: string; amount: string; currency: string }>(res);
      expect(intent.status).toBe('CREATED');
      expect(intent.amount).toBe(grandTotal);
      expect(intent.currency).toBe('IRR');
    });

    it('works the same way for an authenticated customer checkout, not just a guest one', async () => {
      const sku = await createFreshSellableSku(10);
      const cartRes = await request(server)
        .post('/cart')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);
      const cart = body<{ id: string }>(cartRes);
      await request(server)
        .post('/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ productSkuId: sku, quantity: 1 })
        .expect(201);
      const checkoutRes = await request(server)
        .post('/checkout')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ cartId: cart.id })
        .expect(201);
      const checkoutId = body<{ id: string }>(checkoutRes).id;
      await request(server)
        .post(`/checkout/${checkoutId}/address`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          recipientName: 'E2E Payment Customer',
          phone: '+989120000002',
          province: 'Tehran',
          city: 'Tehran',
          addressLine1: 'Test Ave, No. 2',
        })
        .expect(201);
      await request(server)
        .post(`/checkout/${checkoutId}/validate`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);
      await request(server)
        .post(`/checkout/${checkoutId}/price`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);
      await request(server)
        .post(`/checkout/${checkoutId}/reserve`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);
      await request(server)
        .post(`/checkout/${checkoutId}/ready-for-payment`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);

      const intentRes = await request(server)
        .post('/payments/intents')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      const intent = body<{ id: string; customerId: string | null }>(intentRes);
      expect(intent.customerId).not.toBeNull();

      // A guest (no Bearer token) cannot read this customer's intent.
      await request(server).get(`/payments/intents/${intent.id}`).expect(403);
      await request(server)
        .get(`/payments/intents/${intent.id}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
    });

    it('is idempotent on checkoutSessionId — a retried create resolves to the same intent', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyForPaymentCheckout(sku);

      const first = await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      const second = await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      expect(body<{ id: string }>(first).id).toBe(body<{ id: string }>(second).id);
    });

    it('rejects creating an intent for a checkout that is not READY_FOR_PAYMENT', async () => {
      const sku = await createFreshSellableSku(10);
      const cartRes = await request(server).post('/cart').expect(201);
      const cart = body<{ id: string; guestToken: string }>(cartRes);
      await request(server)
        .post('/cart/items')
        .set('X-Cart-Token', cart.guestToken)
        .send({ productSkuId: sku, quantity: 1 })
        .expect(201);
      const checkoutRes = await request(server)
        .post('/checkout')
        .set('X-Cart-Token', cart.guestToken)
        .send({ cartId: cart.id })
        .expect(201);
      const checkoutId = body<{ id: string }>(checkoutRes).id;

      await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', cart.guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(403);
    });

    it('another guest cannot read or start a different intent (IDOR protection)', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyForPaymentCheckout(sku);
      const created = await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      const intentId = body<{ id: string }>(created).id;

      await request(server).get(`/payments/intents/${intentId}`).expect(403);
      await request(server)
        .get(`/payments/intents/${intentId}`)
        .set('X-Cart-Token', 'some-other-guest-token-0000000000000000000000')
        .expect(403);
    });

    it('starts payment, opens a REDIRECTED attempt, and moves the intent to AWAITING_PAYMENT', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyForPaymentCheckout(sku);
      const created = await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      const intentId = body<{ id: string }>(created).id;

      const startRes = await request(server)
        .post(`/payments/intents/${intentId}/start`)
        .set('X-Cart-Token', guestToken)
        .expect(201);
      const started = body<{
        redirectUrl: string;
        intent: { status: string; attempts: { status: string; attemptNumber: number }[] };
      }>(startRes);
      expect(started.redirectUrl).toMatch(/^https:\/\/fake\.zarinpal\.test\/pg\/StartPay\//);
      expect(started.intent.status).toBe('AWAITING_PAYMENT');
      expect(started.intent.attempts).toHaveLength(1);
      expect(started.intent.attempts[0]?.status).toBe('REDIRECTED');
    });

    it('rejects starting an intent that is already AWAITING_PAYMENT (409, illegal transition)', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyForPaymentCheckout(sku);
      const created = await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      const intentId = body<{ id: string }>(created).id;

      await request(server)
        .post(`/payments/intents/${intentId}/start`)
        .set('X-Cart-Token', guestToken)
        .expect(201);
      await request(server)
        .post(`/payments/intents/${intentId}/start`)
        .set('X-Cart-Token', guestToken)
        .expect(409);
    });
  });

  // -------------------------------------------------------------------
  // Callback + verification — never trusting the redirect itself
  // -------------------------------------------------------------------
  describe('callback + verification', () => {
    it('a callback claiming NOK is still resolved via the real verifyPayment() call, not the claim', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyForPaymentCheckout(sku);
      const created = await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      const intentId = body<{ id: string }>(created).id;
      const startRes = await request(server)
        .post(`/payments/intents/${intentId}/start`)
        .set('X-Cart-Token', guestToken)
        .expect(201);
      const attempt = body<{ intent: { attempts: { redirectUrl: string }[] } }>(startRes).intent
        .attempts[0];
      const authority = attempt?.redirectUrl.split('/').pop();
      if (!authority) throw new Error('expected an authority in the redirect URL');

      // The fake adapter's default verifyPayment() reports verified — the
      // callback below claims NOK, but real verification wins.
      await request(server)
        .get('/payments/callback/zarinpal')
        .query({ Authority: authority, Status: 'NOK' })
        .expect(200);

      const updated = await request(server)
        .get(`/payments/intents/${intentId}`)
        .set('X-Cart-Token', guestToken)
        .expect(200);
      expect(body<{ status: string }>(updated).status).toBe('SUCCEEDED');

      const checkoutAfter = await request(server)
        .get(`/checkout/${checkoutId}`)
        .set('X-Cart-Token', guestToken)
        .expect(200);
      expect(body<{ status: string }>(checkoutAfter).status).toBe('CONVERTED');
    });

    it('a verified amount that does not match the intent is FAILED, never silently accepted', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken, grandTotal } = await createReadyForPaymentCheckout(sku);
      const created = await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      const intentId = body<{ id: string }>(created).id;
      const startRes = await request(server)
        .post(`/payments/intents/${intentId}/start`)
        .set('X-Cart-Token', guestToken)
        .expect(201);
      const attempt = body<{ intent: { attempts: { redirectUrl: string }[] } }>(startRes).intent
        .attempts[0];
      const authority = attempt?.redirectUrl.split('/').pop();
      if (!authority) throw new Error('expected an authority in the redirect URL');

      const wrongAmount = (BigInt(grandTotal) - 1n).toString();
      fakeAdapter.setVerifyResult(authority, {
        verified: true,
        providerReference: `FAKE-MISMATCH-REF-${authority}`,
        amount: wrongAmount,
        currency: 'IRR',
        raw: { fake: true, mismatched: true },
      });

      await request(server)
        .get('/payments/callback/zarinpal')
        .query({ Authority: authority, Status: 'OK' })
        .expect(200);

      const updated = await request(server)
        .get(`/payments/intents/${intentId}`)
        .set('X-Cart-Token', guestToken)
        .expect(200);
      const detail = body<{
        status: string;
        transactions: { status: string; providerReference: string }[];
      }>(updated);
      expect(detail.status).toBe('FAILED');
      expect(detail.transactions).toHaveLength(1);
      expect(detail.transactions[0]?.status).toBe('FAILED');
    });
  });

  // -------------------------------------------------------------------
  // Refunds — admin-only, permission-gated
  // -------------------------------------------------------------------
  describe('refunds', () => {
    let verifiedTransactionId: string;
    let verifiedTransactionAmount: bigint;

    beforeAll(async () => {
      // A real VERIFIED transaction of this suite's own, isolated from
      // the seed's own refund fixture (which already has 1,000,000
      // refunded against it) — so this block's balance math is exact.
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyForPaymentCheckout(sku);
      const created = await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      const intentId = body<{ id: string; amount: string }>(created).id;
      verifiedTransactionAmount = BigInt(body<{ amount: string }>(created).amount);
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
      const detail = await request(server)
        .get(`/payments/intents/${intentId}`)
        .set('X-Cart-Token', guestToken)
        .expect(200);
      const tx = body<{ transactions: { id: string; status: string }[] }>(detail).transactions[0];
      if (tx?.status !== 'VERIFIED') throw new Error('expected a VERIFIED transaction');
      verifiedTransactionId = tx.id;
    });

    it('rejects a refund request with no auth (401)', async () => {
      await request(server)
        .post('/admin/payments/refunds')
        .send({
          paymentTransactionId: verifiedTransactionId,
          amount: 100_000,
          idempotencyKey: randomUUID(),
        })
        .expect(401);
    });

    it('finance_auditor cannot create a refund (403, real permission-bypass fixture)', async () => {
      await request(server)
        .post('/admin/payments/refunds')
        .set('Authorization', `Bearer ${financeAuditorToken}`)
        .send({
          paymentTransactionId: verifiedTransactionId,
          amount: 100_000,
          idempotencyKey: randomUUID(),
        })
        .expect(403);
    });

    it('payment_manager can request and process a refund end-to-end', async () => {
      const idempotencyKey = randomUUID();
      const createRes = await request(server)
        .post('/admin/payments/refunds')
        .set('Authorization', `Bearer ${paymentManagerToken}`)
        .send({ paymentTransactionId: verifiedTransactionId, amount: 500_000, idempotencyKey })
        .expect(201);
      const refund = body<{ id: string; status: string; amount: string }>(createRes);
      expect(refund.status).toBe('PENDING');
      expect(refund.amount).toBe('500000');

      const processRes = await request(server)
        .post(`/admin/payments/refunds/${refund.id}/process`)
        .set('Authorization', `Bearer ${paymentManagerToken}`)
        .expect(201);
      expect(body<{ status: string }>(processRes).status).toBe('COMPLETED');
    });

    it('rejects a refund that would exceed the transaction amount (400)', async () => {
      const tooMuch = (verifiedTransactionAmount + 1n).toString();
      await request(server)
        .post('/admin/payments/refunds')
        .set('Authorization', `Bearer ${paymentManagerToken}`)
        .send({
          paymentTransactionId: verifiedTransactionId,
          amount: Number(tooMuch),
          idempotencyKey: randomUUID(),
        })
        .expect(400);
    });

    it('finance_auditor cannot process a refund (403)', async () => {
      const idempotencyKey = randomUUID();
      const createRes = await request(server)
        .post('/admin/payments/refunds')
        .set('Authorization', `Bearer ${paymentManagerToken}`)
        .send({ paymentTransactionId: verifiedTransactionId, amount: 100_000, idempotencyKey })
        .expect(201);
      const refundId = body<{ id: string }>(createRes).id;

      await request(server)
        .post(`/admin/payments/refunds/${refundId}/process`)
        .set('Authorization', `Bearer ${financeAuditorToken}`)
        .expect(403);
    });
  });

  // -------------------------------------------------------------------
  // Reconciliation — admin-only, never auto-corrected
  // -------------------------------------------------------------------
  describe('reconciliation', () => {
    /** A fresh, real AMOUNT_MISMATCH finding, generated per test rather
     * than depending on the seed's own one-time fixture — the seed's
     * unresolved reconciliation record only exists once; a second suite
     * run (or this test simply running twice) would find it already
     * resolved by a prior run, same "fresh fixture per test" precedent
     * every other e2e suite's own concurrency/permission cases use.
     * Verifies via `queryPayment()` reporting an amount that no longer
     * matches what was actually verified — a real provider-side
     * discrepancy discovered after the fact, not a fabricated row. */
    const createFreshMismatchFinding = async (): Promise<{
      id: string;
      status: string;
      localAmount: string;
      remoteAmount: string;
    }> => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyForPaymentCheckout(sku);
      const created = await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      const intentId = body<{ id: string }>(created).id;
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
      const detail = await request(server)
        .get(`/payments/intents/${intentId}`)
        .set('X-Cart-Token', guestToken)
        .expect(200);
      const tx = body<{ transactions: { id: string; amount: string; status: string }[] }>(detail)
        .transactions[0];
      if (tx?.status !== 'VERIFIED') throw new Error('expected a VERIFIED transaction');

      // The provider now reports a different amount than what was
      // verified at settlement time — a real drift, not a fabricated one.
      fakeAdapter.setVerifyResult(authority, {
        verified: true,
        providerReference: `FAKE-REF-${authority}`,
        amount: (BigInt(tx.amount) - 1n).toString(),
        currency: 'IRR',
        raw: { fake: true, drift: true },
      });

      const runRes = await request(server)
        .post(`/admin/payments/reconciliation/transactions/${tx.id}/run`)
        .set('Authorization', `Bearer ${paymentManagerToken}`)
        .expect(201);
      const record = body<{
        id: string;
        status: string;
        localAmount: string;
        remoteAmount: string;
      }>(runRes);
      expect(record.status).toBe('AMOUNT_MISMATCH');
      return record;
    };

    it('finance_auditor can read but not resolve a reconciliation finding', async () => {
      const mismatch = await createFreshMismatchFinding();

      const listRes = await request(server)
        .get('/admin/payments/reconciliation')
        .set('Authorization', `Bearer ${financeAuditorToken}`)
        .expect(200);
      const records = body<{ id: string }[]>(listRes);
      expect(records.some((r) => r.id === mismatch.id)).toBe(true);

      await request(server)
        .post(`/admin/payments/reconciliation/${mismatch.id}/resolve`)
        .set('Authorization', `Bearer ${financeAuditorToken}`)
        .send({ resolutionNote: 'should not be allowed' })
        .expect(403);
    });

    it('payment_manager can resolve a reconciliation finding — recorded, never rewriting the finding itself', async () => {
      const mismatch = await createFreshMismatchFinding();

      const resolveRes = await request(server)
        .post(`/admin/payments/reconciliation/${mismatch.id}/resolve`)
        .set('Authorization', `Bearer ${paymentManagerToken}`)
        .send({ resolutionNote: 'Confirmed with ZarinPal support: local figure is correct.' })
        .expect(201);
      const resolved = body<{
        status: string;
        localAmount: string;
        remoteAmount: string;
        resolvedAt: string | null;
      }>(resolveRes);
      // Recorded, not rewritten — status/amounts survive resolution unchanged.
      expect(resolved.status).toBe(mismatch.status);
      expect(resolved.localAmount).toBe(mismatch.localAmount);
      expect(resolved.remoteAmount).toBe(mismatch.remoteAmount);
      expect(resolved.resolvedAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // Mandatory concurrency tests
  // -------------------------------------------------------------------
  describe('concurrency', () => {
    it('concurrent intent creation for the same checkout resolves to exactly one PaymentIntent', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyForPaymentCheckout(sku);

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          request(server)
            .post('/payments/intents')
            .set('X-Cart-Token', guestToken)
            .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' }),
        ),
      );
      for (const res of results) expect(res.status).toBe(201);
      const ids = new Set(results.map((res) => body<{ id: string }>(res).id));
      expect(ids.size).toBe(1);

      const rows = await prisma.paymentIntent.findMany({
        where: { checkoutSessionId: checkoutId },
      });
      expect(rows).toHaveLength(1);
    });

    it('a redelivered callback (same Authority+Status) is deduped — exactly one PaymentCallback row, exactly one PaymentTransaction', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyForPaymentCheckout(sku);
      const created = await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      const intentId = body<{ id: string }>(created).id;
      const startRes = await request(server)
        .post(`/payments/intents/${intentId}/start`)
        .set('X-Cart-Token', guestToken)
        .expect(201);
      const attempt = body<{ intent: { attempts: { redirectUrl: string }[] } }>(startRes).intent
        .attempts[0];
      const authority = attempt?.redirectUrl.split('/').pop();
      if (!authority) throw new Error('expected an authority');

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          request(server)
            .get('/payments/callback/zarinpal')
            .query({ Authority: authority, Status: 'OK' }),
        ),
      );
      for (const res of results) expect(res.status).toBe(200);

      const callbacks = await prisma.paymentCallback.findMany({
        where: { paymentIntentId: intentId },
      });
      expect(callbacks).toHaveLength(1);
      const transactions = await prisma.paymentTransaction.findMany({
        where: { paymentIntentId: intentId },
      });
      expect(transactions).toHaveLength(1);
      expect(transactions[0]?.status).toBe('VERIFIED');

      const finalIntent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
      expect(finalIntent.status).toBe('SUCCEEDED');
    });

    it('concurrent direct verification calls for the same attempt collapse into one PaymentTransaction row', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyForPaymentCheckout(sku);
      const created = await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201);
      const intentId = body<{ id: string }>(created).id;
      await request(server)
        .post(`/payments/intents/${intentId}/start`)
        .set('X-Cart-Token', guestToken)
        .expect(201);

      // Distinct Authority/Status per call (real query-string uniqueness)
      // so `parseCallback`'s dedupeKey doesn't itself collapse these —
      // the race under test is the repository's own P2002-catch-and-
      // reread path on (providerId, providerReference), triggered because
      // the fake adapter's default verifyPayment() always returns the
      // same deterministic providerReference for a given authority.
      const attempt = await prisma.paymentAttempt.findFirstOrThrow({
        where: { paymentIntentId: intentId },
      });
      const authority = attempt.providerAuthority;
      if (!authority) throw new Error('expected a providerAuthority');

      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          request(server)
            .get('/payments/callback/zarinpal')
            .query({ Authority: authority, Status: 'OK', nonce: String(i) }),
        ),
      );
      for (const res of results) expect(res.status).toBe(200);

      const transactions = await prisma.paymentTransaction.findMany({
        where: { paymentIntentId: intentId },
      });
      expect(transactions).toHaveLength(1);
      expect(transactions[0]?.status).toBe('VERIFIED');
    });
  });
});
