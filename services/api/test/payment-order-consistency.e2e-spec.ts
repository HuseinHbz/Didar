import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { prisma } from '@iecp/database';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { CheckoutService } from '../src/modules/cart-checkout/application/checkout.service';
import { CheckoutExpirationProcessor } from '../src/modules/cart-checkout/infrastructure/queues/checkout-expiration.processor';
import { ReservationService } from '../src/modules/inventory/application/reservation.service';
import { OrderConversionService } from '../src/modules/order/application/order-conversion.service';
import { OrderConversionProcessor } from '../src/modules/order/infrastructure/queues/order-conversion.processor';
import { PAYMENT_PROVIDER_ADAPTER_REGISTRY } from '../src/modules/payment/domain/ports/payment-provider-adapter.port';

import { FakePaymentProviderAdapterRegistry } from './support/fake-payment-provider-adapter';

interface OtpRequestResponseBody {
  devOnlyCode: string | null;
}
interface LoginResponseBody {
  status: 'AUTHENTICATED' | 'TWO_FACTOR_REQUIRED';
  tokens?: { accessToken: string };
}
interface OrderBody {
  id: string;
  status: string;
  paymentStatus: string;
  paidTotal: string;
  refundedTotal: string;
  items: { id: string; quantity: number; productSkuId: string | null }[];
}
interface OrderExceptionBody {
  id: string;
  orderId: string;
  type: string;
  status: string;
  productSkuId: string | null;
  requestedQuantity: number | null;
  resolution: string | null;
}
interface RefundBody {
  id: string;
  status: string;
  amount: string;
  failureReason: string | null;
}

// Same justified single-use-generic pattern as every other e2e spec here.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/** A BullMQ `Job` is never read by either sweep's `process()` — the jobs
 * carry no data. */
const NO_JOB = {} as Job;

/**
 * CP-031 — payment <-> order <-> inventory consistency (gaps P0-3 .. P0-6,
 * P2-16; see docs/product/remediation-roadmap.md §4 and
 * docs/adr/ADR-031-payment-order-consistency.md). Every case here runs the
 * real Checkout -> Payment -> Order chain against real PostgreSQL + Redis;
 * only the outbound ZarinPal HTTP call is swapped (the same
 * `FakePaymentProviderAdapterRegistry` payment.e2e-spec.ts and
 * order.e2e-spec.ts use, for the same reason).
 *
 * "Time travel": stored deadlines are moved backwards in the database
 * (`rewind`) instead of mocking the clock, so the *real* sweep
 * processors run against real rows. A checkout and its payment intent are
 * always rewound together, which preserves their relative offsets exactly
 * as if that much wall-clock time had passed.
 *
 * The two staff users are created here under their own phone numbers
 * rather than reusing the seed's shared `+989120000001`: concurrent OTP
 * request+verify sequences for one phone invalidate each other (only the
 * latest code is valid — correct production behaviour), the pre-existing
 * cross-file flake documented in seed.ts for the return suites.
 */
describe('Payment / order / inventory consistency (CP-031, e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let registry: FakePaymentProviderAdapterRegistry;
  let adminToken: string;
  let clerkToken: string;
  let mainWarehouseId: string;
  let mainLocationId: string;

  const loginByPhone = async (phone: string): Promise<string> => {
    const requestRes = await request(server)
      .post('/auth/otp/request')
      .send({ phone, purpose: 'LOGIN' })
      .expect(200);
    const code = body<OtpRequestResponseBody>(requestRes).devOnlyCode;
    if (code === null) throw new Error('devOnlyCode was null — is NODE_ENV=production?');
    const verifyRes = await request(server)
      .post('/auth/otp/verify')
      .send({ phone, purpose: 'LOGIN', code })
      .expect(200);
    const verified = body<LoginResponseBody>(verifyRes);
    if (!verified.tokens) throw new Error('expected tokens on an AUTHENTICATED response');
    return verified.tokens.accessToken;
  };

  const provisionStaff = async (phone: string, roleName: string): Promise<string> => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, isActive: true, phoneVerifiedAt: new Date() },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
    return loginByPhone(phone);
  };

  const adminPost = (path: string) =>
    request(server).post(path).set('Authorization', `Bearer ${adminToken}`);
  const adminGet = (path: string) =>
    request(server).get(path).set('Authorization', `Bearer ${adminToken}`);

  /** A fresh PUBLISHED product + SKU + price + `stockQuantity` units in
   * the main warehouse — isolated from seed data and every other test. */
  const createFreshSellableSku = async (stockQuantity: number): Promise<string> => {
    const suffix = randomUUID().slice(0, 8);
    const brandId = body<{ id: string }>(
      await request(server).get('/catalog/brands/ray-ban').expect(200),
    ).id;
    const categoryId = body<{ id: string }>(
      await request(server).get('/catalog/categories/sunglasses').expect(200),
    ).id;
    const productId = body<{ id: string }>(
      await adminPost('/admin/catalog/products')
        .send({
          productType: 'SUNGLASSES',
          brandId,
          categoryId,
          name: `CP031 Frame ${suffix}`,
          slug: `cp031-frame-${suffix}`,
          shortDescription: 'Created by the CP-031 consistency e2e suite',
        })
        .expect(201),
    ).id;
    const variantId = body<{ id: string }>(
      await adminPost('/admin/catalog/variants')
        .send({ productId, color: 'Black', size: '52mm', isDefault: true })
        .expect(201),
    ).id;
    const skuId = body<{ id: string }>(
      await adminPost('/admin/catalog/skus')
        .send({ productId, variantId, skuCode: `CP031-SKU-${suffix}` })
        .expect(201),
    ).id;
    await request(server)
      .put(`/admin/catalog/skus/${skuId}/price`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ basePrice: '5000000' })
      .expect(200);
    await adminPost(`/admin/catalog/products/${productId}/submit-for-review`).expect(201);
    await adminPost(`/admin/catalog/products/${productId}/approve`).expect(201);
    await adminPost(`/admin/catalog/products/${productId}/publish`).expect(201);
    if (stockQuantity > 0) await adjustStock(skuId, 'POSITIVE', stockQuantity);
    return skuId;
  };

  const adjustStock = async (
    skuId: string,
    adjustmentType: 'POSITIVE' | 'NEGATIVE',
    quantity: number,
  ): Promise<void> => {
    await adminPost('/admin/inventory/adjustments')
      .send({
        warehouseId: mainWarehouseId,
        locationId: mainLocationId,
        productSkuId: skuId,
        adjustmentType,
        quantity,
        reason: 'CP-031 e2e fixture',
      })
      .expect(201);
  };

  /** Guest checkout driven to `READY_FOR_PAYMENT` with its stock reserved. */
  const createReadyCheckout = async (
    skuId: string,
    quantity: number,
  ): Promise<{ checkoutId: string; guestToken: string }> => {
    const cart = body<{ id: string; guestToken: string }>(
      await request(server).post('/cart').expect(201),
    );
    const guest = (req: request.Test): request.Test => req.set('X-Cart-Token', cart.guestToken);
    await guest(request(server).post('/cart/items'))
      .send({ productSkuId: skuId, quantity })
      .expect(201);
    const checkoutId = body<{ id: string }>(
      await guest(request(server).post('/checkout')).send({ cartId: cart.id }).expect(201),
    ).id;
    await guest(request(server).post(`/checkout/${checkoutId}/address`))
      .send({
        recipientName: 'CP031 Tester',
        phone: '+989120000098',
        province: 'Tehran',
        city: 'Tehran',
        addressLine1: 'Test St, No. 1',
      })
      .expect(201);
    await guest(request(server).post(`/checkout/${checkoutId}/validate`)).expect(201);
    await guest(request(server).post(`/checkout/${checkoutId}/price`)).expect(201);
    await guest(request(server).post(`/checkout/${checkoutId}/reserve`)).expect(201);
    const ready = body<{ status: string }>(
      await guest(request(server).post(`/checkout/${checkoutId}/ready-for-payment`)).expect(201),
    );
    expect(ready.status).toBe('READY_FOR_PAYMENT');
    return { checkoutId, guestToken: cart.guestToken };
  };

  /** Creates + starts a payment intent (customer is now "on the gateway
   * page") and returns the provider authority the callback will carry. */
  const startPayment = async (
    checkoutId: string,
    guestToken: string,
  ): Promise<{ intentId: string; authority: string }> => {
    const guest = (req: request.Test): request.Test => req.set('X-Cart-Token', guestToken);
    const intentId = body<{ id: string }>(
      await guest(request(server).post('/payments/intents'))
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201),
    ).id;
    const started = body<{ intent: { attempts: { redirectUrl: string }[] } }>(
      await guest(request(server).post(`/payments/intents/${intentId}/start`)).expect(201),
    );
    const authority = started.intent.attempts[0]?.redirectUrl.split('/').pop();
    if (!authority) throw new Error('expected a provider authority');
    return { intentId, authority };
  };

  /** The gateway redirects the customer back: callback -> server-side verify. */
  const completePayment = async (authority: string): Promise<void> => {
    await request(server)
      .get('/payments/callback/zarinpal')
      .query({ Authority: authority, Status: 'OK' })
      .expect(200);
  };

  /** Moves the stored deadlines of one checkout + its intent back in time
   * by `minutes` — "that much wall-clock time has passed". */
  const rewind = async (checkoutId: string, minutes: number): Promise<void> => {
    const interval = `${minutes} minutes`;
    await prisma.$executeRawUnsafe(
      `UPDATE commerce.checkout_sessions SET expires_at = expires_at - $1::interval WHERE id = $2::uuid`,
      interval,
      checkoutId,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE commerce.payment_intents SET expires_at = expires_at - $1::interval WHERE checkout_session_id = $2::uuid`,
      interval,
      checkoutId,
    );
  };

  const checkoutRow = (checkoutId: string) =>
    prisma.checkoutSession.findUniqueOrThrow({
      where: { id: checkoutId },
      include: { reservations: true },
    });

  const reservationsOf = async (checkoutId: string) => {
    const links = await prisma.checkoutReservation.findMany({
      where: { checkoutSessionId: checkoutId },
    });
    return prisma.inventoryReservation.findMany({
      where: { id: { in: links.map((l) => l.inventoryReservationId) } },
    });
  };

  const stockOf = async (skuId: string) => {
    const items = await prisma.inventoryItem.findMany({ where: { productSkuId: skuId } });
    return {
      onHand: items.reduce((sum, i) => sum + i.onHandQuantity, 0),
      reserved: items.reduce((sum, i) => sum + i.reservedQuantity, 0),
      available: items.reduce((sum, i) => sum + i.availableQuantity, 0),
    };
  };

  const salesOf = (skuId: string, orderId: string) =>
    prisma.inventoryLedger.findMany({
      where: {
        productSkuId: skuId,
        movementType: 'SALE',
        referenceType: 'ORDER',
        referenceId: orderId,
      },
    });

  const orderOf = (checkoutId: string) =>
    prisma.order.findUnique({ where: { checkoutSessionId: checkoutId } });

  beforeAll(async () => {
    registry = new FakePaymentProviderAdapterRegistry();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
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
    // Listen once, up front. Left un-listened, supertest binds the server itself
    // for the first request and *closes it when that request finishes* — which
    // resets the other connections of a burst of concurrent requests
    // (`read ECONNRESET`), exactly what this suite's 20-way tests send.
    await app.listen(0);
    server = app.getHttpServer() as Server;

    adminToken = await provisionStaff('+989120031001', 'admin');
    clerkToken = await provisionStaff('+989120031002', 'fulfillment_clerk');

    const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { code: 'WH-TEHRAN-01' } });
    mainWarehouseId = warehouse.id;
    const location = await prisma.warehouseLocation.findFirstOrThrow({
      where: { warehouseId: warehouse.id, code: 'MAIN' },
    });
    mainLocationId = location.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------
  // P0-3 / A1 — the stock hold must outlive the payment window
  // -------------------------------------------------------------------
  describe('P0-3 — a checkout with a live payment intent is not expired from under the customer', () => {
    it('keeps the checkout and its reservations alive 21 minutes in, when the gateway page is still open', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyCheckout(sku, 2);
      const { authority } = await startPayment(checkoutId, guestToken);

      // 21 minutes later — past the checkout's own 20-minute TTL, inside
      // the payment intent's 30-minute window.
      await rewind(checkoutId, 21);
      await app.get(CheckoutExpirationProcessor, { strict: false }).process(NO_JOB);

      const checkout = await checkoutRow(checkoutId);
      expect(checkout.status).toBe('READY_FOR_PAYMENT');
      const reservations = await reservationsOf(checkoutId);
      expect(reservations).toHaveLength(1);
      expect(reservations.map((r) => r.status)).toEqual(['ACTIVE']);

      // ...and the customer who then pays still gets a PAID order with
      // their stock sold exactly once.
      await completePayment(authority);
      const order = body<OrderBody>(
        await request(server)
          .get(`/orders/by-checkout/${checkoutId}`)
          .set('X-Cart-Token', guestToken)
          .expect(200),
      );
      expect(order.status).toBe('PAID');
      expect(await salesOf(sku, order.id)).toHaveLength(1);
      expect(await stockOf(sku)).toMatchObject({ onHand: 8, reserved: 0, available: 8 });
    });

    it('still expires an abandoned checkout (no payment intent) and releases its stock', async () => {
      const sku = await createFreshSellableSku(5);
      const { checkoutId } = await createReadyCheckout(sku, 2);
      expect(await stockOf(sku)).toMatchObject({ reserved: 2, available: 3 });

      await rewind(checkoutId, 21);
      await app.get(CheckoutExpirationProcessor, { strict: false }).process(NO_JOB);

      expect((await checkoutRow(checkoutId)).status).toBe('EXPIRED');
      expect((await reservationsOf(checkoutId)).map((r) => r.status)).toEqual(['RELEASED']);
      expect(await stockOf(sku)).toMatchObject({ reserved: 0, available: 5 });
    });

    it('bounds the hold: once the payment window plus grace has passed, the checkout does expire', async () => {
      const sku = await createFreshSellableSku(5);
      const { checkoutId, guestToken } = await createReadyCheckout(sku, 1);
      await startPayment(checkoutId, guestToken);

      await rewind(checkoutId, 120);
      await app.get(CheckoutExpirationProcessor, { strict: false }).process(NO_JOB);

      expect((await checkoutRow(checkoutId)).status).toBe('EXPIRED');
      expect(await stockOf(sku)).toMatchObject({ reserved: 0, available: 5 });
    });

    it('never shortens a hold: POST /checkout/:id/refresh keeps the later of the two deadlines', async () => {
      const sku = await createFreshSellableSku(5);
      const { checkoutId, guestToken } = await createReadyCheckout(sku, 1);
      await startPayment(checkoutId, guestToken);
      const before = (await checkoutRow(checkoutId)).expiresAt;
      if (!before) throw new Error('expected an expiresAt');

      await request(server)
        .post(`/checkout/${checkoutId}/refresh`)
        .set('X-Cart-Token', guestToken)
        .expect(201);

      const after = (await checkoutRow(checkoutId)).expiresAt;
      if (!after) throw new Error('expected an expiresAt');
      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  // -------------------------------------------------------------------
  // P0-4 / A2 — money captured => exactly one order, even with no customer return
  // -------------------------------------------------------------------
  describe('P0-4 — a payment verified after the checkout lapsed still yields exactly one order', () => {
    it('creates the order from the sweep alone (the customer never returns)', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyCheckout(sku, 1);
      const { authority } = await startPayment(checkoutId, guestToken);

      // The hold lapsed (long worker outage / legacy row): the checkout is
      // expired and its stock released while the customer is still paying.
      await app.get(CheckoutService).expire(checkoutId);
      expect((await checkoutRow(checkoutId)).status).toBe('EXPIRED');

      await completePayment(authority);
      expect((await checkoutRow(checkoutId)).status).toBe('EXPIRED'); // cannot flip back

      // No customer return, no admin action — only the reliability sweep.
      await app.get(OrderConversionProcessor, { strict: false }).process(NO_JOB);

      const order = await orderOf(checkoutId);
      expect(order).not.toBeNull();
      expect(order?.status).toBe('PAID');
      expect(order?.paidTotal).toBeGreaterThan(0n);
      expect(await prisma.invoice.count({ where: { orderId: order?.id } })).toBe(1);
    });

    it('stays at exactly one order and one invoice under concurrent sweeps and a customer return', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyCheckout(sku, 1);
      const { authority } = await startPayment(checkoutId, guestToken);
      await app.get(CheckoutService).expire(checkoutId);
      await completePayment(authority);

      const processor = app.get(OrderConversionProcessor, { strict: false });
      const conversion = app.get(OrderConversionService);
      await Promise.all([
        ...Array.from({ length: 6 }, () => processor.process(NO_JOB)),
        ...Array.from({ length: 6 }, () => conversion.convertFromCheckout(checkoutId)),
        request(server).get(`/orders/by-checkout/${checkoutId}`).set('X-Cart-Token', guestToken),
      ]);

      expect(await prisma.order.count({ where: { checkoutSessionId: checkoutId } })).toBe(1);
      const order = await orderOf(checkoutId);
      expect(order?.status).toBe('PAID');
      expect(await prisma.invoice.count({ where: { orderId: order?.id } })).toBe(1);
      // The stock was sold once, not once per racing caller.
      expect(await salesOf(sku, order?.id ?? '')).toHaveLength(1);
      expect(await stockOf(sku)).toMatchObject({ onHand: 9, reserved: 0, available: 9 });
    });
  });

  // -------------------------------------------------------------------
  // P0-5 / A3 + A4 — a PAID order never exists without allocated stock
  // -------------------------------------------------------------------
  describe('P0-5 — stock allocation on conversion', () => {
    it('re-acquires released stock when it still exists: PAID, stock sold exactly once', async () => {
      const sku = await createFreshSellableSku(10);
      const { checkoutId, guestToken } = await createReadyCheckout(sku, 2);
      const { authority } = await startPayment(checkoutId, guestToken);
      await app.get(CheckoutService).expire(checkoutId); // reservations RELEASED
      expect(await stockOf(sku)).toMatchObject({ onHand: 10, reserved: 0 });
      await completePayment(authority);

      const order = body<OrderBody>(
        await request(server)
          .get(`/orders/by-checkout/${checkoutId}`)
          .set('X-Cart-Token', guestToken)
          .expect(200),
      );

      expect(order.status).toBe('PAID');
      const sales = await salesOf(sku, order.id);
      expect(sales).toHaveLength(1);
      expect(sales[0]?.quantity).toBe(2);
      expect(await stockOf(sku)).toMatchObject({ onHand: 8, reserved: 0, available: 8 });
      const open = await prisma.orderException.count({
        where: { orderId: order.id, status: 'OPEN' },
      });
      expect(open).toBe(0);
    });

    it('never swallows a shortfall: order is PAID, one OPEN STOCK_SHORTFALL exception blocks approve (409) until resolved', async () => {
      const sku = await createFreshSellableSku(2);
      const { checkoutId, guestToken } = await createReadyCheckout(sku, 2);
      const { authority } = await startPayment(checkoutId, guestToken);
      await app.get(CheckoutService).expire(checkoutId); // stock released...
      await adjustStock(sku, 'NEGATIVE', 2); // ...and sold elsewhere / written off
      await completePayment(authority);

      const order = body<OrderBody>(
        await request(server)
          .get(`/orders/by-checkout/${checkoutId}`)
          .set('X-Cart-Token', guestToken)
          .expect(200),
      );
      expect(order.status).toBe('PAID'); // the customer paid; the order exists

      // The defect on develop: this returns 201 — a PAID order with no
      // stock at all is approved straight into fulfillment.
      const blocked = await adminPost(`/admin/orders/${order.id}/approve`).expect(409);
      expect(JSON.stringify(blocked.body)).toContain('exception');

      const listed = body<{ items: OrderExceptionBody[] }>(
        await adminGet(`/admin/order-exceptions?orderId=${order.id}&status=OPEN`).expect(200),
      ).items;
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        orderId: order.id,
        type: 'STOCK_SHORTFALL',
        status: 'OPEN',
        productSkuId: sku,
        requestedQuantity: 2,
      });
      const audit = await prisma.auditLog.count({
        where: { action: 'ORDER_EXCEPTION_OPENED', entityId: listed[0]?.id },
      });
      expect(audit).toBe(1);

      // Retrying while stock is still missing is refused and changes nothing.
      await adminPost(`/admin/order-exceptions/${listed[0]?.id}/retry-allocation`).expect(409);
      expect(await salesOf(sku, order.id)).toHaveLength(0);

      // Restock, then retry: allocated, exception resolved, approve unblocked.
      await adjustStock(sku, 'POSITIVE', 5);
      const resolved = body<OrderExceptionBody>(
        await adminPost(`/admin/order-exceptions/${listed[0]?.id}/retry-allocation`).expect(201),
      );
      expect(resolved).toMatchObject({ status: 'RESOLVED', resolution: 'ALLOCATED' });
      expect(await salesOf(sku, order.id)).toHaveLength(1);
      expect(await stockOf(sku)).toMatchObject({ onHand: 3, reserved: 0 });
      await adminPost(`/admin/orders/${order.id}/approve`).expect(201);

      // Retrying a resolved exception is a harmless no-op: no second sale.
      await adminPost(`/admin/order-exceptions/${listed[0]?.id}/retry-allocation`).expect(201);
      expect(await salesOf(sku, order.id)).toHaveLength(1);
    });

    it('resolves the exception when the order is cancelled instead (and requests the refund)', async () => {
      const sku = await createFreshSellableSku(1);
      const { checkoutId, guestToken } = await createReadyCheckout(sku, 1);
      const { authority } = await startPayment(checkoutId, guestToken);
      await app.get(CheckoutService).expire(checkoutId);
      await adjustStock(sku, 'NEGATIVE', 1);
      await completePayment(authority);
      const order = body<OrderBody>(
        await request(server)
          .get(`/orders/by-checkout/${checkoutId}`)
          .set('X-Cart-Token', guestToken)
          .expect(200),
      );

      await adminPost(`/admin/orders/${order.id}/cancel`).send({ reason: 'No stock' }).expect(201);

      const exceptions = await prisma.orderException.findMany({ where: { orderId: order.id } });
      expect(exceptions).toHaveLength(1);
      expect(exceptions[0]).toMatchObject({ status: 'RESOLVED', resolution: 'ORDER_CANCELLED' });
      const refunds = await prisma.refund.findMany({
        where: { paymentTransaction: { paymentIntent: { order: { id: order.id } } } },
      });
      expect(refunds).toHaveLength(1);
      expect(refunds[0]?.amount).toBe(BigInt(order.paidTotal));
    });

    it('records one exception, not one per racing caller, when many conversions hit the same shortfall', async () => {
      const sku = await createFreshSellableSku(1);
      const { checkoutId, guestToken } = await createReadyCheckout(sku, 1);
      const { authority } = await startPayment(checkoutId, guestToken);
      await app.get(CheckoutService).expire(checkoutId);
      await adjustStock(sku, 'NEGATIVE', 1);
      await completePayment(authority);

      const conversion = app.get(OrderConversionService);
      await Promise.all(
        Array.from({ length: 12 }, () => conversion.convertFromCheckout(checkoutId)),
      );

      const order = await orderOf(checkoutId);
      expect(order?.status).toBe('PAID');
      expect(await prisma.orderException.count({ where: { orderId: order?.id } })).toBe(1);
    });

    it('denies the fulfillment clerk (a floor role) any access to exceptions', async () => {
      await request(server)
        .get('/admin/order-exceptions')
        .set('Authorization', `Bearer ${clerkToken}`)
        .expect(403);
      await request(server)
        .post(`/admin/order-exceptions/${randomUUID()}/retry-allocation`)
        .set('Authorization', `Bearer ${clerkToken}`)
        .expect(403);
    });

    it('rejects malformed list filters with a 400 instead of reaching the database', async () => {
      await adminGet('/admin/order-exceptions?orderId=not-a-uuid').expect(400);
      await adminGet('/admin/order-exceptions?cursor=not-a-uuid').expect(400);
      await adminGet('/admin/order-exceptions?status=BOGUS').expect(400);
      await adminGet('/admin/order-exceptions?limit=0').expect(400);
      await adminGet('/admin/order-exceptions?limit=101').expect(400);
      await adminGet('/admin/order-exceptions?limit=abc').expect(400);
      // ...and a well-formed request still works.
      await adminGet(`/admin/order-exceptions?orderId=${randomUUID()}&limit=5`).expect(200);
    });
  });

  // -------------------------------------------------------------------
  // P0-5 (root cause under A3/A4) — reservation transitions must be atomic
  //
  // `release`/`convert`/`expire` used to read the reservation's status with
  // no row lock and then adjust the inventory item under its own lock, so
  // two racing transitions both saw ACTIVE and both applied their delta:
  // stock "sold" twice, or released *and* sold. The order conversion path
  // runs these concurrently by design (sweep + customer return + admin
  // retry), so the guarantee has to live in the reservation repository.
  // -------------------------------------------------------------------
  describe('reservation lifecycle is race-safe', () => {
    const reserveOne = async (skuId: string, quantity: number) => {
      const reservations = app.get(ReservationService);
      return reservations.reserve({
        productSkuId: skuId as never,
        warehouseId: mainWarehouseId as never,
        quantity,
        sourceType: 'CP031_TEST',
        sourceId: randomUUID(),
        idempotencyKey: `cp031-${randomUUID()}`,
      });
    };

    it('converts a reservation exactly once under 20 concurrent convert calls', async () => {
      const sku = await createFreshSellableSku(10);
      const reservation = await reserveOne(sku, 3);
      const reservations = app.get(ReservationService);
      const referenceId = randomUUID();

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          reservations.convert(reservation.id, null, { referenceType: 'ORDER', referenceId }),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await salesOf(sku, referenceId)).toHaveLength(1);
      // 10 on hand - 3 sold; nothing left reserved; not 10 - 3 * N.
      expect(await stockOf(sku)).toMatchObject({ onHand: 7, reserved: 0, available: 7 });
    });

    it('lets exactly one of release and convert win when they race', async () => {
      const sku = await createFreshSellableSku(10);
      const reservation = await reserveOne(sku, 4);
      const reservations = app.get(ReservationService);
      const referenceId = randomUUID();

      const results = await Promise.allSettled([
        ...Array.from({ length: 10 }, () => reservations.release(reservation.id)),
        ...Array.from({ length: 10 }, () =>
          reservations.convert(reservation.id, null, { referenceType: 'ORDER', referenceId }),
        ),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const finalRow = await prisma.inventoryReservation.findUniqueOrThrow({
        where: { id: reservation.id },
      });
      const stock = await stockOf(sku);
      if (finalRow.status === 'CONVERTED') {
        expect(stock).toMatchObject({ onHand: 6, reserved: 0 });
        expect(await salesOf(sku, referenceId)).toHaveLength(1);
      } else {
        expect(finalRow.status).toBe('RELEASED');
        expect(stock).toMatchObject({ onHand: 10, reserved: 0 });
        expect(await salesOf(sku, referenceId)).toHaveLength(0);
      }
    });
  });

  // -------------------------------------------------------------------
  // P0-6 / A5 — a refund the gateway cannot honour exactly is never sent
  // -------------------------------------------------------------------
  describe('P0-6 — refund capability guard', () => {
    const paidOrder = async (): Promise<{ order: OrderBody; skuId: string; authority: string }> => {
      const skuId = await createFreshSellableSku(5);
      const { checkoutId, guestToken } = await createReadyCheckout(skuId, 1);
      const { authority } = await startPayment(checkoutId, guestToken);
      await completePayment(authority);
      const order = body<OrderBody>(
        await request(server)
          .get(`/orders/by-checkout/${checkoutId}`)
          .set('X-Cart-Token', guestToken)
          .expect(200),
      );
      expect(order.status).toBe('PAID');
      return { order, skuId, authority };
    };

    /** The order's one refund row — asserts there is exactly one, so a test
     * never silently picks the wrong refund. */
    const soleRefundOf = async (orderId: string) => {
      const [refund, ...others] = await refundsOf(orderId);
      if (!refund || others.length > 0) {
        throw new Error(`expected exactly one refund for order ${orderId}`);
      }
      return refund;
    };

    const refundsOf = (orderId: string) =>
      prisma.refund.findMany({
        where: { paymentTransaction: { paymentIntent: { order: { id: orderId } } } },
        orderBy: { createdAt: 'asc' },
      });

    afterEach(() => {
      registry.adapter.setCapabilities({ partialRefund: true });
    });

    it('rejects a partial refund, with a reason, without ever calling the gateway', async () => {
      const { order, authority } = await paidOrder();
      registry.adapter.setCapabilities({ partialRefund: false });

      await adminPost(`/admin/orders/${order.id}/refund`)
        .send({ amount: 1_000_000, reason: 'Goodwill' })
        .expect(201);
      const [pending] = await refundsOf(order.id);
      expect(pending?.status).toBe('PENDING');

      const processed = body<RefundBody>(
        await adminPost(`/admin/payments/refunds/${pending?.id}/process`).expect(201),
      );

      expect(processed.status).toBe('REJECTED');
      expect(processed.failureReason).toMatch(/partial/i);
      expect(registry.adapter.refundSendsFor(authority)).toBe(0); // never sent
      // The rejection is visible to operators through the refund list.
      const rejected = body<RefundBody[]>(
        await adminGet('/admin/payments/refunds?status=REJECTED').expect(200),
      );
      expect(rejected.map((r) => r.id)).toContain(pending?.id);
    });

    it('still sends a full refund to a gateway that cannot refund partially', async () => {
      const { order, authority } = await paidOrder();
      registry.adapter.setCapabilities({ partialRefund: false });

      await adminPost(`/admin/orders/${order.id}/cancel`)
        .send({ reason: 'Customer request' })
        .expect(201);
      const [refund] = await refundsOf(order.id);
      expect(refund?.amount).toBe(BigInt(order.paidTotal));

      const processed = body<RefundBody>(
        await adminPost(`/admin/payments/refunds/${refund?.id}/process`).expect(201),
      );

      expect(processed.status).toBe('COMPLETED');
      expect(registry.adapter.refundSendsFor(authority)).toBe(1);
    });

    it('sends a partial refund to a gateway that declares the capability', async () => {
      const { order, authority } = await paidOrder();
      registry.adapter.setCapabilities({ partialRefund: true });

      await adminPost(`/admin/orders/${order.id}/refund`)
        .send({ amount: 1_000_000, reason: 'Goodwill' })
        .expect(201);
      const [pending] = await refundsOf(order.id);
      const processed = body<RefundBody>(
        await adminPost(`/admin/payments/refunds/${pending?.id}/process`).expect(201),
      );

      expect(processed.status).toBe('COMPLETED');
      expect(registry.adapter.refundSendsFor(authority)).toBe(1);
    });

    it("records a gateway decline as REJECTED with the gateway's reason", async () => {
      const { order, authority } = await paidOrder();
      registry.adapter.setRefundResult(authority, {
        accepted: false,
        providerRefundReference: null,
        raw: { code: -50, message: 'transaction already reversed' },
      });
      await adminPost(`/admin/orders/${order.id}/refund`)
        .send({ amount: 1_000_000, reason: 'Goodwill' })
        .expect(201);
      const refund = await soleRefundOf(order.id);

      const processed = body<RefundBody>(
        await adminPost(`/admin/payments/refunds/${refund.id}/process`).expect(201),
      );

      expect(processed.status).toBe('REJECTED');
      expect(processed.failureReason).toContain('transaction already reversed');
      expect(registry.adapter.refundSendsFor(authority)).toBe(1);
    });

    // -----------------------------------------------------------------
    // P0-6b — found while fixing P0-6: the send step itself was a
    // check-then-act, so two callers could both reach the gateway
    // -----------------------------------------------------------------
    it('sends the refund to the gateway exactly once when 20 requests process it at the same time', async () => {
      const { order, authority } = await paidOrder();
      await adminPost(`/admin/orders/${order.id}/refund`)
        .send({ amount: 1_000_000, reason: 'Goodwill' })
        .expect(201);
      const refund = await soleRefundOf(order.id);

      const responses = await Promise.all(
        Array.from({ length: 20 }, () => adminPost(`/admin/payments/refunds/${refund.id}/process`)),
      );

      // One caller sent it; every other one was told it is already in flight — never a 5xx.
      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(19);
      expect(registry.adapter.refundSendsFor(authority)).toBe(1);
      expect((await soleRefundOf(order.id)).status).toBe('COMPLETED');
    });

    it('never re-sends a refund that is already PROCESSING — a send that may have been lost is for finance to check', async () => {
      const { order, authority } = await paidOrder();
      await adminPost(`/admin/orders/${order.id}/refund`)
        .send({ amount: 1_000_000, reason: 'Goodwill' })
        .expect(201);
      const refund = await soleRefundOf(order.id);
      // A crash after the claim but before the outcome was written.
      await prisma.refund.update({ where: { id: refund.id }, data: { status: 'PROCESSING' } });

      const response = await adminPost(`/admin/payments/refunds/${refund.id}/process`).expect(409);

      expect((response.body as { error: string }).error).toBe('RefundAlreadyProcessingError');
      expect(registry.adapter.refundSendsFor(authority)).toBe(0);
      // Its balance stays consumed, and it is findable.
      expect((await soleRefundOf(order.id)).status).toBe('PROCESSING');
      const processing = body<RefundBody[]>(
        await adminGet('/admin/payments/refunds?status=PROCESSING').expect(200),
      );
      expect(processing.map((r) => r.id)).toContain(refund.id);
    });

    it('validates the refund list filters: unknown status is a 400, no filter at all returns nothing', async () => {
      await adminGet('/admin/payments/refunds?status=BOGUS').expect(400);
      await adminGet('/admin/payments/refunds?paymentTransactionId=not-a-uuid').expect(400);
      const unfiltered = body<RefundBody[]>(await adminGet('/admin/payments/refunds').expect(200));
      expect(unfiltered).toEqual([]);
    });
  });
});
