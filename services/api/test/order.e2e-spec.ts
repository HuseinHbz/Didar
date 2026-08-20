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
interface OrderBody {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  paidTotal: string;
  refundedTotal: string;
  items: { id: string; quantity: number }[];
  statusHistory: { toStatus: string; changedBy: string | null }[];
}
interface ConvertedResponseBody {
  converted: boolean;
  message: string;
}
interface InvoiceBody {
  id: string;
  orderId: string;
  status: string;
}
interface FulfillmentBody {
  id: string;
  orderId: string;
  status: string;
  shipment: { id: string; status: string } | null;
}
interface ShipmentBody {
  id: string;
  status: string;
}

// Same justified single-use-generic pattern as identity/catalog/inventory/
// cart-checkout/payment e2e specs.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * End-to-end coverage for the order module (Phase 009) against a real
 * Postgres + real Redis, seeded via packages/database/prisma/seed.ts.
 * `+989120000001`/`+989120000002` are the seed's admin/customer users;
 * `+989120000011`/`+989120000012` are this phase's own `order_manager`/
 * `fulfillment_clerk` fixtures — all logged in via the real OTP flow.
 *
 * The real `PaymentProviderAdapterRegistry` is overridden with the same
 * `FakePaymentProviderAdapterRegistry` `payment.e2e-spec.ts` uses (see
 * that class's own doc comment for why) — this suite exercises the real
 * Checkout->Payment->Order chain end to end, only the outbound ZarinPal
 * HTTP call itself is swapped out.
 *
 * The mandatory concurrency tests (ADR-009 / Phase 009 spec §17) run
 * against real PostgreSQL, no fakes, no in-memory doubles — a fresh
 * fixture per case, same precedent every prior phase's own e2e suite set.
 */
describe('Order (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let adminToken: string;
  let customerToken: string;
  let orderManagerToken: string;
  let fulfillmentClerkToken: string;

  let mainWarehouseId: string;
  let mainLocationId: string;

  /** Provisions a fresh `identity.users` + `customer.customers` row and
   * logs in via the real OTP flow — used instead of the seed's own
   * `+989120000002` customer for tests that need "an authenticated
   * customer with a guaranteed-empty cart." `ActorResolverGuard`
   * requires a real Customer profile for any Bearer-token request (see
   * the IDOR test below); `getOrCreateForCustomer()` reuses whatever
   * cart a customer already has, so the seed's own shared customer would
   * carry stale items across this whole file's — and every other e2e
   * file's — repeated runs. */
  const provisionCustomer = async (phone: string): Promise<string> => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, isActive: true, phoneVerifiedAt: new Date() },
    });
    await prisma.customer.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, firstName: 'E2E', lastName: 'Order Customer' },
    });
    return loginByPhone(phone);
  };

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
   * from seed data and every other test — same precedent every prior
   * phase's own e2e suite uses. */
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
        name: `E2E Order Frame ${suffix}`,
        slug: `e2e-order-frame-${suffix}`,
        shortDescription: 'Created by the order e2e suite',
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
      .send({ productId, variantId, skuCode: `E2E-ORDER-SKU-${suffix}` })
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
          reason: 'e2e order fixture: seed stock',
        })
        .expect(201);
    }
    return skuId;
  };

  /** Drives a fresh cart all the way to `READY_FOR_PAYMENT`, as a guest
   * (no `authToken`) or as an authenticated customer (`authToken` set).
   * `couponCode`, when given, is applied to the cart before checkout is
   * created — used only by the promotion-snapshot-visibility test below;
   * every other caller leaves it undefined and this is a no-op for them. */
  const createReadyForPaymentCheckout = async (
    skuId: string,
    quantity: number,
    authToken?: string,
    couponCode?: string,
  ): Promise<{ checkoutId: string; guestToken: string; grandTotal: string }> => {
    const auth = (req: request.Test): request.Test =>
      authToken ? req.set('Authorization', `Bearer ${authToken}`) : req;

    const cartRes = await auth(request(server).post('/cart')).expect(201);
    const cart = body<{ id: string; guestToken: string }>(cartRes);
    const cartAuth = (req: request.Test): request.Test =>
      authToken
        ? req.set('Authorization', `Bearer ${authToken}`)
        : req.set('X-Cart-Token', cart.guestToken);

    await cartAuth(request(server).post('/cart/items'))
      .send({ productSkuId: skuId, quantity })
      .expect(201);

    if (couponCode) {
      await cartAuth(request(server).post('/cart/coupon')).send({ code: couponCode }).expect(201);
    }

    const checkoutRes = await cartAuth(request(server).post('/checkout'))
      .send({ cartId: cart.id })
      .expect(201);
    const checkoutId = body<{ id: string }>(checkoutRes).id;

    await cartAuth(request(server).post(`/checkout/${checkoutId}/address`))
      .send({
        recipientName: 'E2E Order Tester',
        phone: '+989120000098',
        province: 'Tehran',
        city: 'Tehran',
        addressLine1: 'Test St, No. 1',
      })
      .expect(201);

    await cartAuth(request(server).post(`/checkout/${checkoutId}/validate`)).expect(201);
    await cartAuth(request(server).post(`/checkout/${checkoutId}/price`)).expect(201);
    await cartAuth(request(server).post(`/checkout/${checkoutId}/reserve`)).expect(201);

    const readyRes = await cartAuth(
      request(server).post(`/checkout/${checkoutId}/ready-for-payment`),
    ).expect(201);
    const ready = body<{ status: string; grandTotal: string }>(readyRes);
    expect(ready.status).toBe('READY_FOR_PAYMENT');

    return { checkoutId, guestToken: cart.guestToken, grandTotal: ready.grandTotal };
  };

  /** Creates a payment intent, starts it, and drives the real callback
   * (Status=OK) through to a SUCCEEDED intent + VERIFIED transaction —
   * every step the payment module actually exposes, none skipped. */
  const payCheckout = async (
    checkoutId: string,
    guestTokenOrAuth: { guestToken?: string; authToken?: string },
  ): Promise<void> => {
    const auth = (req: request.Test): request.Test =>
      guestTokenOrAuth.authToken
        ? req.set('Authorization', `Bearer ${guestTokenOrAuth.authToken}`)
        : req.set('X-Cart-Token', guestTokenOrAuth.guestToken ?? '');

    const created = await auth(request(server).post('/payments/intents'))
      .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
      .expect(201);
    const intentId = body<{ id: string }>(created).id;

    const startRes = await auth(request(server).post(`/payments/intents/${intentId}/start`)).expect(
      201,
    );
    const attempt = body<{ intent: { attempts: { redirectUrl: string }[] } }>(startRes).intent
      .attempts[0];
    const authority = attempt?.redirectUrl.split('/').pop();
    if (!authority) throw new Error('expected an authority');

    await request(server)
      .get('/payments/callback/zarinpal')
      .query({ Authority: authority, Status: 'OK' })
      .expect(200);
  };

  /** Full checkout->payment->convert chain in one call — the shape every
   * test that just needs "a real PAID order" reaches for. */
  const driveToOrder = async (
    skuId: string,
    quantity: number,
    authToken?: string,
    couponCode?: string,
  ): Promise<{ order: OrderBody; checkoutId: string; guestToken: string }> => {
    const { checkoutId, guestToken } = await createReadyForPaymentCheckout(
      skuId,
      quantity,
      authToken,
      couponCode,
    );
    await payCheckout(checkoutId, authToken ? { authToken } : { guestToken });
    const convertReq = authToken
      ? request(server)
          .get(`/orders/by-checkout/${checkoutId}`)
          .set('Authorization', `Bearer ${authToken}`)
      : request(server).get(`/orders/by-checkout/${checkoutId}`).set('X-Cart-Token', guestToken);
    const res = await convertReq.expect(200);
    const order = body<OrderBody>(res);
    expect(order.id).toBeDefined();
    return { order, checkoutId, guestToken };
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
    customerToken = await provisionCustomer('+989120099902');
    orderManagerToken = await loginByPhone('+989120000011');
    fulfillmentClerkToken = await loginByPhone('+989120000012');

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
  // Happy path: the full lifecycle, one order, every layer for real
  // -------------------------------------------------------------------
  describe('happy path', () => {
    it('checkout -> payment -> order -> invoice -> fulfillment -> shipment -> delivered -> completed', async () => {
      const sku = await createFreshSellableSku(10);
      const { order, checkoutId } = await driveToOrder(sku, 1, customerToken);
      expect(order.status).toBe('PAID');
      expect(order.paymentStatus).toBe('PAID');
      expect(order.fulfillmentStatus).toBe('UNFULFILLED');
      expect(order.paidTotal).not.toBe('0');
      expect(order.items).toHaveLength(1);

      // Invoice was already issued synchronously by OrderConversionService.
      const invoiceRes = await request(server)
        .get(`/orders/${order.id}/invoice`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      const invoice = body<InvoiceBody>(invoiceRes);
      expect(invoice.orderId).toBe(order.id);
      expect(invoice.status).toBe('ISSUED');

      // Admin advances PAID -> PROCESSING -> READY_TO_FULFILL.
      await request(server)
        .post(`/admin/orders/${order.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const afterProcessing = body<OrderBody>(
        await request(server)
          .get(`/admin/orders/${order.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200),
      );
      expect(afterProcessing.status).toBe('PROCESSING');
      await request(server)
        .post(`/admin/orders/${order.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const afterReady = body<OrderBody>(
        await request(server)
          .get(`/admin/orders/${order.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200),
      );
      expect(afterReady.status).toBe('READY_TO_FULFILL');

      // Fulfill the whole line.
      const orderItemId = order.items[0]?.id;
      if (!orderItemId) throw new Error('expected an order item');
      const fulfillmentRes = await request(server)
        .post(`/admin/orders/${order.id}/fulfillments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ warehouseId: mainWarehouseId, items: [{ orderItemId, quantity: 1 }] })
        .expect(201);
      const fulfillment = body<FulfillmentBody>(fulfillmentRes);

      const afterFulfill = body<OrderBody>(
        await request(server)
          .get(`/admin/orders/${order.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200),
      );
      expect(afterFulfill.fulfillmentStatus).toBe('FULFILLED');
      expect(afterFulfill.status).toBe('FULFILLED');

      // Walk the fulfillment through its own 8-state lifecycle
      // (PENDING -> ... -> SHIPPED) — the shipment can only be marked
      // DELIVERED once its fulfillment is SHIPPED (FulfillmentStateMachine).
      for (const status of ['ALLOCATED', 'PROCESSING', 'PACKED', 'READY', 'SHIPPED']) {
        await request(server)
          .patch(`/admin/orders/${order.id}/fulfillments/${fulfillment.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status })
          .expect(200);
      }

      // Ship it, then deliver it — delivering the shipment also drives
      // the fulfillment to DELIVERED (FulfillmentService.updateShipmentStatus).
      const shipmentRes = await request(server)
        .post(`/admin/orders/${order.id}/fulfillments/${fulfillment.id}/shipments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ carrier: 'Tipax', trackingNumber: `E2E-TRACK-${randomUUID()}` })
        .expect(201);
      const shipment = body<ShipmentBody>(shipmentRes);
      expect(shipment.status).toBe('PENDING');

      await request(server)
        .patch(`/admin/orders/${order.id}/shipments/${shipment.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'IN_TRANSIT' })
        .expect(200);
      // Delivery is its own dedicated route/permission (ADR-011 decision
      // 4) — a generic PATCH to DELIVERED is now structurally rejected
      // (proven in the security section below).
      await request(server)
        .post(`/admin/orders/${order.id}/shipments/${shipment.id}/deliver`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      const fulfillmentsRes = await request(server)
        .get(`/admin/orders/${order.id}/fulfillments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const deliveredFulfillment = body<FulfillmentBody[]>(fulfillmentsRes)[0];
      expect(deliveredFulfillment?.status).toBe('DELIVERED');

      // Admin marks the order COMPLETED.
      await request(server)
        .post(`/admin/orders/${order.id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const finalOrder = body<OrderBody>(
        await request(server)
          .get(`/admin/orders/${order.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200),
      );
      expect(finalOrder.status).toBe('COMPLETED');
      expect(finalOrder.statusHistory.map((h) => h.toStatus)).toEqual(
        expect.arrayContaining([
          'PENDING_PAYMENT',
          'PAID',
          'PROCESSING',
          'READY_TO_FULFILL',
          'FULFILLED',
          'COMPLETED',
        ]),
      );

      // checkoutId is not otherwise asserted on above — confirms the
      // fixture actually threaded through to this order.
      const finalOrderByCheckout = await prisma.order.findUniqueOrThrow({
        where: { checkoutSessionId: checkoutId },
      });
      expect(finalOrderByCheckout.id).toBe(order.id);
    });

    it('works the same way for a guest checkout, not just an authenticated customer', async () => {
      const sku = await createFreshSellableSku(5);
      const { order, guestToken } = await driveToOrder(sku, 1);
      expect(order.status).toBe('PAID');

      const res = await request(server)
        .get(`/orders/${order.id}`)
        .set('X-Cart-Token', guestToken)
        .expect(200);
      expect(body<OrderBody>(res).id).toBe(order.id);
    });
  });

  // -------------------------------------------------------------------
  // Not-yet-converted / ownership / IDOR
  // -------------------------------------------------------------------
  describe('conversion + ownership', () => {
    it('GET /orders/by-checkout before payment verifies reports converted:false, creates no Order', async () => {
      const sku = await createFreshSellableSku(5);
      const { checkoutId, guestToken } = await createReadyForPaymentCheckout(sku, 1);

      const res = await request(server)
        .get(`/orders/by-checkout/${checkoutId}`)
        .set('X-Cart-Token', guestToken)
        .expect(200);
      expect(body<ConvertedResponseBody>(res).converted).toBe(false);

      const rows = await prisma.order.findMany({ where: { checkoutSessionId: checkoutId } });
      expect(rows).toHaveLength(0);
    });

    it('a guest cannot read another guest checkout/order via GET /orders/by-checkout or GET /orders/:id (IDOR)', async () => {
      const sku = await createFreshSellableSku(5);
      const { order, checkoutId } = await driveToOrder(sku, 1);

      const otherCartRes = await request(server).post('/cart').expect(201);
      const otherGuestToken = body<{ guestToken: string }>(otherCartRes).guestToken;

      await request(server)
        .get(`/orders/by-checkout/${checkoutId}`)
        .set('X-Cart-Token', otherGuestToken)
        .expect(403);
      await request(server)
        .get(`/orders/${order.id}`)
        .set('X-Cart-Token', otherGuestToken)
        .expect(403);
    });

    it('an authenticated customer cannot read another customer’s order (IDOR)', async () => {
      const sku = await createFreshSellableSku(5);
      const { order } = await driveToOrder(sku, 1, customerToken);

      // ActorResolverGuard requires a real customer.customers row for any
      // Bearer-token request (a valid JWT with no Customer profile is a
      // genuine 401, not a 403 — the seed's own support/admin users have
      // no such profile).
      const otherCustomerToken = await provisionCustomer('+989120099901');

      await request(server)
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .expect(403);
    });
  });

  // -------------------------------------------------------------------
  // Admin permission bypass
  // -------------------------------------------------------------------
  describe('admin permission bypass', () => {
    it('a plain customer gets 403 on every /admin/orders route', async () => {
      const sku = await createFreshSellableSku(5);
      const { order } = await driveToOrder(sku, 1, customerToken);
      await request(server)
        .get(`/admin/orders/${order.id}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
      await request(server)
        .post(`/admin/orders/${order.id}/approve`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
    });

    it('fulfillment_clerk can fulfill but gets 403 on cancel/refund (real least-privilege boundary)', async () => {
      const sku = await createFreshSellableSku(5);
      const { order } = await driveToOrder(sku, 1, customerToken);
      await request(server)
        .post(`/admin/orders/${order.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      await request(server)
        .post(`/admin/orders/${order.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      const orderItemId = order.items[0]?.id;
      if (!orderItemId) throw new Error('expected an order item');
      await request(server)
        .post(`/admin/orders/${order.id}/fulfillments`)
        .set('Authorization', `Bearer ${fulfillmentClerkToken}`)
        .send({ items: [{ orderItemId, quantity: 1 }] })
        .expect(201);

      await request(server)
        .post(`/admin/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${fulfillmentClerkToken}`)
        .send({})
        .expect(403);
      await request(server)
        .post(`/admin/orders/${order.id}/refund`)
        .set('Authorization', `Bearer ${fulfillmentClerkToken}`)
        .send({ amount: 1000 })
        .expect(403);
    });
  });

  // -------------------------------------------------------------------
  // Cancel + refund
  // -------------------------------------------------------------------
  describe('cancel + refund', () => {
    it('cancelling a PAID order requests a refund and is idempotent on a second call', async () => {
      const sku = await createFreshSellableSku(5);
      const { order } = await driveToOrder(sku, 1, customerToken);

      const cancelRes = await request(server)
        .post(`/admin/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${orderManagerToken}`)
        .send({ reason: 'e2e cancel test' })
        .expect(201);
      expect(body<OrderBody>(cancelRes).status).toBe('CANCELLED');

      const refunds = await prisma.refund.findMany({
        where: { idempotencyKey: `order-cancel__${order.id}` },
      });
      expect(refunds).toHaveLength(1);
      expect(refunds[0]?.amount.toString()).toBe(order.paidTotal);

      // Idempotent no-op — same 200-shape result, no new history entry.
      const secondCancel = await request(server)
        .post(`/admin/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${orderManagerToken}`)
        .send({})
        .expect(201);
      expect(body<OrderBody>(secondCancel).status).toBe('CANCELLED');

      const history = await prisma.orderStatusHistory.findMany({
        where: { orderId: order.id, toStatus: 'CANCELLED' },
      });
      expect(history).toHaveLength(1);
    });

    it('a partial refund on a still-PAID order updates paymentStatus/refundedTotal', async () => {
      const sku = await createFreshSellableSku(5);
      const { order } = await driveToOrder(sku, 1, customerToken);

      const refundRes = await request(server)
        .post(`/admin/orders/${order.id}/refund`)
        .set('Authorization', `Bearer ${orderManagerToken}`)
        .send({ amount: 1_000_000, reason: 'e2e partial refund' })
        .expect(201);
      const refunded = body<OrderBody>(refundRes);
      expect(refunded.paymentStatus).toBe('PARTIALLY_REFUNDED');
      expect(refunded.refundedTotal).toBe('1000000');
    });
  });

  // -------------------------------------------------------------------
  // Fulfillment / over-fulfillment / duplicate invoice / duplicate shipment
  // -------------------------------------------------------------------
  describe('fulfillment invariants', () => {
    const readyToFulfill = async (
      quantity: number,
    ): Promise<{ order: OrderBody; orderItemId: string }> => {
      const sku = await createFreshSellableSku(10);
      const { order } = await driveToOrder(sku, quantity, customerToken);
      await request(server)
        .post(`/admin/orders/${order.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      await request(server)
        .post(`/admin/orders/${order.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const orderItemId = order.items[0]?.id;
      if (!orderItemId) throw new Error('expected an order item');
      return { order, orderItemId };
    };

    it('partial fulfillment then completion moves fulfillmentStatus PARTIALLY_FULFILLED -> FULFILLED', async () => {
      const { order, orderItemId } = await readyToFulfill(3);

      await request(server)
        .post(`/admin/orders/${order.id}/fulfillments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ orderItemId, quantity: 2 }] })
        .expect(201);
      const afterFirst = body<OrderBody>(
        await request(server)
          .get(`/admin/orders/${order.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200),
      );
      expect(afterFirst.fulfillmentStatus).toBe('PARTIALLY_FULFILLED');
      expect(afterFirst.status).toBe('PARTIALLY_FULFILLED');

      await request(server)
        .post(`/admin/orders/${order.id}/fulfillments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ orderItemId, quantity: 1 }] })
        .expect(201);
      const afterSecond = body<OrderBody>(
        await request(server)
          .get(`/admin/orders/${order.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200),
      );
      expect(afterSecond.fulfillmentStatus).toBe('FULFILLED');
    });

    it('rejects a fulfillment that would over-fulfill an order item (409)', async () => {
      // Quantity 3, first fulfillment takes only 1 — the order stays
      // PARTIALLY_FULFILLED (still inside the fulfillable window) so the
      // second request actually reaches the quantity validator instead
      // of being rejected earlier for "order already fully fulfilled".
      const { order, orderItemId } = await readyToFulfill(3);

      await request(server)
        .post(`/admin/orders/${order.id}/fulfillments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ orderItemId, quantity: 1 }] })
        .expect(201);

      // Only 2 remain — requesting 3 more must be rejected as over-fulfillment.
      await request(server)
        .post(`/admin/orders/${order.id}/fulfillments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ orderItemId, quantity: 3 }] })
        .expect(409);
    });

    it('duplicate invoice-issue requests converge to exactly one Invoice row', async () => {
      const sku = await createFreshSellableSku(5);
      const { order } = await driveToOrder(sku, 1, customerToken);

      const first = await request(server)
        .post(`/admin/orders/${order.id}/invoice`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const second = await request(server)
        .post(`/admin/orders/${order.id}/invoice`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect(body<InvoiceBody>(first).id).toBe(body<InvoiceBody>(second).id);

      const invoices = await prisma.invoice.findMany({ where: { orderId: order.id } });
      expect(invoices).toHaveLength(1);
    });

    it('duplicate shipment-create requests for the same fulfillment converge to exactly one Shipment row', async () => {
      const { order, orderItemId } = await readyToFulfill(1);
      const fulfillmentRes = await request(server)
        .post(`/admin/orders/${order.id}/fulfillments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ orderItemId, quantity: 1 }] })
        .expect(201);
      const fulfillmentId = body<FulfillmentBody>(fulfillmentRes).id;

      const first = await request(server)
        .post(`/admin/orders/${order.id}/fulfillments/${fulfillmentId}/shipments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ carrier: 'Tipax' })
        .expect(201);
      const second = await request(server)
        .post(`/admin/orders/${order.id}/fulfillments/${fulfillmentId}/shipments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ carrier: 'Different Carrier' })
        .expect(201);
      expect(body<ShipmentBody>(first).id).toBe(body<ShipmentBody>(second).id);

      const shipments = await prisma.shipment.findMany({ where: { fulfillmentId } });
      expect(shipments).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------
  // ADR-011 hardening — completion readiness, dedicated delivery route,
  // tracking-number lookup, admin search/filter, fulfillment-creation
  // idempotency over real HTTP, promotion-snapshot visibility, invoice
  // immutability.
  // -------------------------------------------------------------------
  describe('ADR-011 hardening', () => {
    /** Random Iranian-mobile-shaped phone (`iranMobileSchema`) — a fresh
     * customer per call, so promotion tests below don't collide with a
     * fixture customer's own `perCustomerLimit` across repeated runs of
     * this file. */
    const randomPhone = (): string =>
      `+989${String(Math.floor(100_000_000 + Math.random() * 900_000_000))}`;

    /** Drives a fresh order to READY_TO_FULFILL, fulfills the one line,
     * walks the fulfillment PENDING -> ... -> SHIPPED, creates its
     * shipment, and marks it IN_TRANSIT — one step short of DELIVERED.
     * The shared "almost there" fixture for every test below that needs
     * a real shipment in a deliverable state without itself asserting
     * anything about delivery. */
    const driveShipmentToInTransit = async (): Promise<{
      orderId: string;
      fulfillmentId: string;
      shipmentId: string;
      trackingNumber: string;
    }> => {
      const sku = await createFreshSellableSku(5);
      const { order } = await driveToOrder(sku, 1, customerToken);
      await request(server)
        .post(`/admin/orders/${order.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      await request(server)
        .post(`/admin/orders/${order.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const orderItemId = order.items[0]?.id;
      if (!orderItemId) throw new Error('expected an order item');

      const fulfillmentRes = await request(server)
        .post(`/admin/orders/${order.id}/fulfillments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ warehouseId: mainWarehouseId, items: [{ orderItemId, quantity: 1 }] })
        .expect(201);
      const fulfillmentId = body<FulfillmentBody>(fulfillmentRes).id;

      for (const status of ['ALLOCATED', 'PROCESSING', 'PACKED', 'READY', 'SHIPPED']) {
        await request(server)
          .patch(`/admin/orders/${order.id}/fulfillments/${fulfillmentId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status })
          .expect(200);
      }

      const trackingNumber = `E2E-ADR011-${randomUUID()}`;
      const shipmentRes = await request(server)
        .post(`/admin/orders/${order.id}/fulfillments/${fulfillmentId}/shipments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ carrier: 'Tipax', trackingNumber })
        .expect(201);
      const shipmentId = body<ShipmentBody>(shipmentRes).id;

      await request(server)
        .patch(`/admin/orders/${order.id}/shipments/${shipmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'IN_TRANSIT' })
        .expect(200);

      return { orderId: order.id, fulfillmentId, shipmentId, trackingNumber };
    };

    describe('completion readiness (ADR-011 decision 3)', () => {
      it('rejects /complete with 409 while the sole fulfillment is SHIPPED but not yet DELIVERED', async () => {
        const { orderId } = await driveShipmentToInTransit();
        await request(server)
          .post(`/admin/orders/${orderId}/complete`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(409);
      });

      it('rejects /complete with 409 for an order that has no fulfillment at all', async () => {
        const sku = await createFreshSellableSku(5);
        const { order } = await driveToOrder(sku, 1, customerToken);
        await request(server)
          .post(`/admin/orders/${order.id}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(201);
        await request(server)
          .post(`/admin/orders/${order.id}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(201);
        // Still READY_TO_FULFILL — never fulfilled, let alone delivered.
        await request(server)
          .post(`/admin/orders/${order.id}/complete`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(409);
      });

      it('allows /complete once the sole fulfillment reaches DELIVERED', async () => {
        const { orderId, shipmentId } = await driveShipmentToInTransit();
        await request(server)
          .post(`/admin/orders/${orderId}/shipments/${shipmentId}/deliver`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(201);
        const completed = body<OrderBody>(
          await request(server)
            .post(`/admin/orders/${orderId}/complete`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(201),
        );
        expect(completed.status).toBe('COMPLETED');
      });
    });

    describe('dedicated delivery route RBAC (ADR-011 decision 4)', () => {
      it('fulfillment_clerk gets 403 on POST .../deliver though it can update shipment status generally', async () => {
        const { orderId, shipmentId } = await driveShipmentToInTransit();
        await request(server)
          .post(`/admin/orders/${orderId}/shipments/${shipmentId}/deliver`)
          .set('Authorization', `Bearer ${fulfillmentClerkToken}`)
          .expect(403);

        // The floor role really can update this same shipment generally —
        // this is a boundary on DELIVERED specifically, not a blanket
        // shipment-update lockout.
        await request(server)
          .patch(`/admin/orders/${orderId}/shipments/${shipmentId}`)
          .set('Authorization', `Bearer ${fulfillmentClerkToken}`)
          .send({ status: 'IN_TRANSIT', location: 'e2e re-check' })
          .expect(200);

        await request(server)
          .post(`/admin/orders/${orderId}/shipments/${shipmentId}/deliver`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(201);
      });
    });

    describe('generic status routes structurally reject DELIVERED', () => {
      it('PATCH fulfillment status with DELIVERED is a 400, never a real transition', async () => {
        const { orderId, fulfillmentId } = await driveShipmentToInTransit();
        await request(server)
          .patch(`/admin/orders/${orderId}/fulfillments/${fulfillmentId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'DELIVERED' })
          .expect(400);
        const fulfillment = await prisma.fulfillment.findUniqueOrThrow({
          where: { id: fulfillmentId },
        });
        expect(fulfillment.status).toBe('SHIPPED');
      });

      it('PATCH shipment status with DELIVERED is a 400, never a real transition', async () => {
        const { orderId, shipmentId } = await driveShipmentToInTransit();
        await request(server)
          .patch(`/admin/orders/${orderId}/shipments/${shipmentId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'DELIVERED' })
          .expect(400);
        const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
        expect(shipment.status).toBe('IN_TRANSIT');
      });
    });

    describe('tracking-number lookup (ADR-011 decision 5)', () => {
      it('finds a shipment by its exact tracking number', async () => {
        const { shipmentId, trackingNumber } = await driveShipmentToInTransit();
        const res = await request(server)
          .get(`/admin/shipments/by-tracking/${trackingNumber}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
        expect(body<ShipmentBody>(res).id).toBe(shipmentId);
      });

      it('404s for an unknown tracking number', async () => {
        await request(server)
          .get(`/admin/shipments/by-tracking/NO-SUCH-TRACKING-${randomUUID()}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(404);
      });

      it('403s for a plain customer (admin-only route)', async () => {
        const { trackingNumber } = await driveShipmentToInTransit();
        await request(server)
          .get(`/admin/shipments/by-tracking/${trackingNumber}`)
          .set('Authorization', `Bearer ${customerToken}`)
          .expect(403);
      });
    });

    describe('admin search/filtering (ADR-011 decision 6)', () => {
      it('filters by customerId, paymentStatus, fulfillmentStatus, and a placed-date range — all real WHERE clauses', async () => {
        // Deliberately two fresh, single-use customers, each with exactly
        // one order — the shared `customerToken` fixture accumulates
        // orders across this whole file's other tests (and across
        // repeated runs of this same file), and every assertion below
        // that isn't itself testing `customerId` still scopes its query
        // by `customerId` for that reason: `id: 'asc'` pagination over a
        // random UUID key means an *unscoped* paymentStatus/
        // fulfillmentStatus/placedFrom query's `limit` is not guaranteed
        // to reach a just-created order once the table has grown past it
        // — a real pagination fact, not a bug in the filter itself, but
        // one this test must not be sensitive to.
        const customerAToken = await provisionCustomer(randomPhone());
        const otherCustomerToken = await provisionCustomer(randomPhone());
        const skuA = await createFreshSellableSku(5);
        const skuB = await createFreshSellableSku(5);
        const { order: orderA } = await driveToOrder(skuA, 1, customerAToken);
        const { order: orderB } = await driveToOrder(skuB, 1, otherCustomerToken);

        const orderADetail = body<{ customerId: string }>(
          await request(server)
            .get(`/admin/orders/${orderA.id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200),
        );
        const orderBDetail = body<{ customerId: string }>(
          await request(server)
            .get(`/admin/orders/${orderB.id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200),
        );

        const byCustomer = body<{ items: OrderBody[] }>(
          await request(server)
            .get(`/admin/orders?customerId=${orderADetail.customerId}&limit=100`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200),
        );
        expect(byCustomer.items.map((item) => item.id)).toEqual([orderA.id]);

        const byPaymentAndFulfillment = body<{ items: OrderBody[] }>(
          await request(server)
            .get(
              `/admin/orders?customerId=${orderADetail.customerId}&paymentStatus=PAID&fulfillmentStatus=UNFULFILLED&limit=100`,
            )
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200),
        );
        expect(byPaymentAndFulfillment.items.map((item) => item.id)).toEqual([orderA.id]);

        const wrongPaymentStatus = body<{ items: OrderBody[] }>(
          await request(server)
            .get(
              `/admin/orders?customerId=${orderADetail.customerId}&paymentStatus=UNPAID&limit=100`,
            )
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200),
        );
        expect(wrongPaymentStatus.items).toHaveLength(0);

        const futureOnly = body<{ items: OrderBody[] }>(
          await request(server)
            .get(
              `/admin/orders?customerId=${orderBDetail.customerId}&placedFrom=${new Date(Date.now() + 86_400_000).toISOString()}&limit=100`,
            )
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200),
        );
        expect(futureOnly.items).toHaveLength(0);

        const sinceAnHourAgo = body<{ items: OrderBody[] }>(
          await request(server)
            .get(
              `/admin/orders?customerId=${orderBDetail.customerId}&placedFrom=${new Date(Date.now() - 3_600_000).toISOString()}&limit=100`,
            )
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200),
        );
        expect(sinceAnHourAgo.items.map((item) => item.id)).toEqual([orderB.id]);
      });
    });

    describe('fulfillment-creation idempotency over real HTTP (ADR-011 decision 2)', () => {
      it('two sequential POSTs sharing an idempotencyKey converge to exactly one Fulfillment row', async () => {
        const sku = await createFreshSellableSku(10);
        const { order } = await driveToOrder(sku, 2, customerToken);
        await request(server)
          .post(`/admin/orders/${order.id}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(201);
        await request(server)
          .post(`/admin/orders/${order.id}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(201);
        const orderItemId = order.items[0]?.id;
        if (!orderItemId) throw new Error('expected an order item');
        const idempotencyKey = `e2e-http-${randomUUID()}`;

        const first = await request(server)
          .post(`/admin/orders/${order.id}/fulfillments`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ items: [{ orderItemId, quantity: 1 }], idempotencyKey })
          .expect(201);
        const second = await request(server)
          .post(`/admin/orders/${order.id}/fulfillments`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ items: [{ orderItemId, quantity: 1 }], idempotencyKey })
          .expect(201);
        expect(body<FulfillmentBody>(first).id).toBe(body<FulfillmentBody>(second).id);

        const rows = await prisma.fulfillment.findMany({ where: { idempotencyKey } });
        expect(rows).toHaveLength(1);
      });

      it('10 concurrent POSTs sharing an idempotencyKey converge to exactly one Fulfillment row', async () => {
        const sku = await createFreshSellableSku(10);
        const { order } = await driveToOrder(sku, 2, customerToken);
        await request(server)
          .post(`/admin/orders/${order.id}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(201);
        await request(server)
          .post(`/admin/orders/${order.id}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(201);
        const orderItemId = order.items[0]?.id;
        if (!orderItemId) throw new Error('expected an order item');
        const idempotencyKey = `e2e-http-concurrent-${randomUUID()}`;

        const results = await Promise.all(
          Array.from({ length: 10 }, () =>
            request(server)
              .post(`/admin/orders/${order.id}/fulfillments`)
              .set('Authorization', `Bearer ${adminToken}`)
              .send({ items: [{ orderItemId, quantity: 1 }], idempotencyKey }),
          ),
        );
        for (const res of results) expect(res.status).toBe(201);
        const ids = new Set(results.map((res) => body<FulfillmentBody>(res).id));
        expect(ids.size).toBe(1);

        const rows = await prisma.fulfillment.findMany({ where: { idempotencyKey } });
        expect(rows).toHaveLength(1);
      });
    });

    describe('promotion snapshot visibility (ADR-011 decision 7)', () => {
      it('surfaces the immutable OrderPromotion snapshot on both the customer and admin order read paths', async () => {
        const promoCustomerToken = await provisionCustomer(randomPhone());
        const sku = await createFreshSellableSku(5); // 5,000,000 rial, sunglasses category
        const { order } = await driveToOrder(sku, 1, promoCustomerToken, 'DIDAR20');

        // The cart also clears the seed's automatic free-shipping minimum
        // (3,000,000), so two OrderPromotion rows are expected here: the
        // coupon-gated DIDAR20 discount plus the automatic, no-coupon
        // free-shipping promotion — this asserts the coupon one is
        // present and correctly snapshotted, not that it's the only one.
        const customerRes = await request(server)
          .get(`/orders/${order.id}`)
          .set('Authorization', `Bearer ${promoCustomerToken}`)
          .expect(200);
        const customerDetail = body<{
          promotions: { promotionId: string; couponCode: string | null; discountAmount: string }[];
        }>(customerRes);
        expect(customerDetail.promotions.length).toBeGreaterThanOrEqual(1);
        const didar20 = customerDetail.promotions.find((p) => p.couponCode === 'DIDAR20');
        expect(didar20).toBeDefined();
        expect(BigInt(didar20?.discountAmount ?? '0')).toBeGreaterThan(0n);

        const adminRes = await request(server)
          .get(`/admin/orders/${order.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
        const adminDetail = body<{ promotions: { promotionId: string }[] }>(adminRes);
        expect(adminDetail.promotions.map((p) => p.promotionId).sort()).toEqual(
          customerDetail.promotions.map((p) => p.promotionId).sort(),
        );
      });
    });

    describe('invoice immutability re-proof', () => {
      it('the issued invoice grandTotal is unaffected by a later partial refund on the order', async () => {
        const sku = await createFreshSellableSku(5);
        const { order } = await driveToOrder(sku, 1, customerToken);
        const issued = body<InvoiceBody & { grandTotal: string }>(
          await request(server)
            .post(`/admin/orders/${order.id}/invoice`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(201),
        );

        await request(server)
          .post(`/admin/orders/${order.id}/refund`)
          .set('Authorization', `Bearer ${orderManagerToken}`)
          .send({ amount: 500_000, reason: 'e2e invoice-immutability check' })
          .expect(201);

        const afterRefund = body<InvoiceBody & { grandTotal: string }>(
          await request(server)
            .get(`/admin/orders/${order.id}/invoice`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200),
        );
        expect(afterRefund.grandTotal).toBe(issued.grandTotal);
        expect(afterRefund.id).toBe(issued.id);
      });

      it('void is idempotent, and fulfillment_clerk (no order.invoice.* grant) gets 403 on it', async () => {
        const sku = await createFreshSellableSku(5);
        const { order } = await driveToOrder(sku, 1, customerToken);
        await request(server)
          .post(`/admin/orders/${order.id}/invoice`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(201);

        await request(server)
          .post(`/admin/orders/${order.id}/invoice/void`)
          .set('Authorization', `Bearer ${fulfillmentClerkToken}`)
          .expect(403);

        const firstVoid = body<InvoiceBody & { voidedAt: string }>(
          await request(server)
            .post(`/admin/orders/${order.id}/invoice/void`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(201),
        );
        expect(firstVoid.status).toBe('VOID');

        const secondVoid = body<InvoiceBody & { voidedAt: string }>(
          await request(server)
            .post(`/admin/orders/${order.id}/invoice/void`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(201),
        );
        expect(secondVoid.voidedAt).toBe(firstVoid.voidedAt);
      });
    });
  });

  // -------------------------------------------------------------------
  // Concurrency (Phase 009 spec §17) — real PostgreSQL, no fakes
  // -------------------------------------------------------------------
  describe('concurrency', () => {
    it('concurrent GET /orders/by-checkout calls (racing payment callbacks/conversions) collapse to exactly one Order', async () => {
      const sku = await createFreshSellableSku(5);
      const { checkoutId, guestToken } = await createReadyForPaymentCheckout(sku, 1);
      await payCheckout(checkoutId, { guestToken });

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          request(server).get(`/orders/by-checkout/${checkoutId}`).set('X-Cart-Token', guestToken),
        ),
      );
      for (const res of results) expect(res.status).toBe(200);
      const ids = new Set(results.map((res) => body<OrderBody>(res).id));
      expect(ids.size).toBe(1);

      const rows = await prisma.order.findMany({ where: { checkoutSessionId: checkoutId } });
      expect(rows).toHaveLength(1);
    });

    it('concurrent order-number generation across distinct checkouts produces unique order numbers', async () => {
      // Fixture setup (catalog/inventory/checkout/payment) runs
      // sequentially, one checkout at a time — real request volume, just
      // not deliberately piled on top of itself. The actual concurrency
      // under test is the final step: 5 distinct, already-payment-
      // verified checkouts all converting at once, racing the same
      // `commerce.order_number_seq`.
      const readySessions: { checkoutId: string; guestToken: string }[] = [];
      for (let i = 0; i < 5; i += 1) {
        const sku = await createFreshSellableSku(5);
        const { checkoutId, guestToken } = await createReadyForPaymentCheckout(sku, 1);
        await payCheckout(checkoutId, { guestToken });
        readySessions.push({ checkoutId, guestToken });
      }
      const results = await Promise.all(
        readySessions.map(({ checkoutId, guestToken }) =>
          request(server)
            .get(`/orders/by-checkout/${checkoutId}`)
            .set('X-Cart-Token', guestToken)
            .expect(200),
        ),
      );
      const orderNumbers = results.map((res) => body<OrderBody>(res).orderNumber);
      expect(new Set(orderNumbers).size).toBe(orderNumbers.length);
    });

    it('concurrent fulfillment requests for the same order item never over-fulfill it', async () => {
      const sku = await createFreshSellableSku(10);
      const { order } = await driveToOrder(sku, 2, customerToken);
      await request(server)
        .post(`/admin/orders/${order.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      await request(server)
        .post(`/admin/orders/${order.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const orderItemId = order.items[0]?.id;
      if (!orderItemId) throw new Error('expected an order item');

      // Four concurrent requests for 1 unit each against an order item
      // that only has 2 — at most 2 may legally succeed.
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          request(server)
            .post(`/admin/orders/${order.id}/fulfillments`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ items: [{ orderItemId, quantity: 1 }] }),
        ),
      );
      const succeeded = results.filter((res) => res.status === 201);
      const rejected = results.filter((res) => res.status === 409);
      expect(succeeded).toHaveLength(2);
      expect(rejected).toHaveLength(2);

      const fulfillmentItems = await prisma.fulfillmentItem.findMany({ where: { orderItemId } });
      const totalFulfilled = fulfillmentItems.reduce((sum, item) => sum + item.quantity, 0);
      expect(totalFulfilled).toBe(2);
    });

    it('concurrent invoice-issue requests for the same order converge to exactly one Invoice row', async () => {
      const sku = await createFreshSellableSku(5);
      const { order } = await driveToOrder(sku, 1, customerToken);

      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(server)
            .post(`/admin/orders/${order.id}/invoice`)
            .set('Authorization', `Bearer ${adminToken}`),
        ),
      );
      for (const res of results) expect(res.status).toBe(201);
      const ids = new Set(results.map((res) => body<InvoiceBody>(res).id));
      expect(ids.size).toBe(1);

      const invoices = await prisma.invoice.findMany({ where: { orderId: order.id } });
      expect(invoices).toHaveLength(1);
    });

    it('concurrent shipment-create requests for the same fulfillment converge to exactly one Shipment row', async () => {
      const sku = await createFreshSellableSku(5);
      const { order } = await driveToOrder(sku, 1, customerToken);
      await request(server)
        .post(`/admin/orders/${order.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      await request(server)
        .post(`/admin/orders/${order.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const orderItemId = order.items[0]?.id;
      if (!orderItemId) throw new Error('expected an order item');
      const fulfillmentRes = await request(server)
        .post(`/admin/orders/${order.id}/fulfillments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ orderItemId, quantity: 1 }] })
        .expect(201);
      const fulfillmentId = body<FulfillmentBody>(fulfillmentRes).id;

      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(server)
            .post(`/admin/orders/${order.id}/fulfillments/${fulfillmentId}/shipments`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ carrier: 'Tipax' }),
        ),
      );
      for (const res of results) expect(res.status).toBe(201);
      const ids = new Set(results.map((res) => body<ShipmentBody>(res).id));
      expect(ids.size).toBe(1);

      const shipments = await prisma.shipment.findMany({ where: { fulfillmentId } });
      expect(shipments).toHaveLength(1);
    });

    it('concurrent cancellation requests on the same order converge to exactly one CANCELLED transition', async () => {
      const sku = await createFreshSellableSku(5);
      const { order } = await driveToOrder(sku, 1, customerToken);

      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(server)
            .post(`/admin/orders/${order.id}/cancel`)
            .set('Authorization', `Bearer ${orderManagerToken}`)
            .send({}),
        ),
      );
      for (const res of results) {
        expect(res.status).toBe(201);
        expect(body<OrderBody>(res).status).toBe('CANCELLED');
      }

      const history = await prisma.orderStatusHistory.findMany({
        where: { orderId: order.id, toStatus: 'CANCELLED' },
      });
      expect(history).toHaveLength(1);
      const refunds = await prisma.refund.findMany({
        where: { idempotencyKey: `order-cancel__${order.id}` },
      });
      expect(refunds).toHaveLength(1);
    });

    it('concurrent identical partial-refund requests do not double-refund', async () => {
      const sku = await createFreshSellableSku(5);
      const { order } = await driveToOrder(sku, 1, customerToken);

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(server)
            .post(`/admin/orders/${order.id}/refund`)
            .set('Authorization', `Bearer ${orderManagerToken}`)
            .send({ amount: 500_000, reason: 'e2e concurrent refund' }),
        ),
      );
      for (const res of results) expect(res.status).toBe(201);

      const refunds = await prisma.refund.findMany({
        where: { idempotencyKey: `order-partial-refund__${order.id}__500000` },
      });
      expect(refunds).toHaveLength(1);
    });
  });
});
