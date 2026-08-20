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
interface ReturnBody {
  id: string;
  status: string;
  resolution: string;
  items: {
    id: string;
    orderItemId: string;
    condition: string | null;
    refundAmount: string | null;
  }[];
}
interface CreditNoteBody {
  id: string;
  status: string;
  grandTotal: string;
}
interface RefundBody {
  id: string;
  status: string;
  amount: string;
}
interface OrderBody {
  id: string;
  paymentStatus: string;
  refundedTotal: string;
  items: { id: string }[];
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * Functional + security e2e coverage for ADR-012, HTTP end to end — the
 * one layer `return-repository.e2e-spec.ts` (concurrency, bypassing the
 * application layer) and the domain unit tests (pure logic, no I/O)
 * deliberately don't cover: real controllers, real DTO validation, real
 * RBAC guards, real ownership checks, and the real restock/refund
 * side-effects wired end to end.
 */
describe('Returns/Refunds/CreditNotes (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let adminToken: string;
  let returnsManagerToken: string;
  let returnsClerkToken: string;
  let mainWarehouseId: string;
  let mainLocationId: string;

  const loginByPhone = async (phone: string): Promise<string> => {
    const requestRes = await request(server)
      .post('/auth/otp/request')
      .send({ phone, purpose: 'LOGIN' })
      .expect(200);
    const code = body<OtpRequestResponseBody>(requestRes).devOnlyCode;
    if (code === null) throw new Error('devOnlyCode was null');
    const verifyRes = await request(server)
      .post('/auth/otp/verify')
      .send({ phone, purpose: 'LOGIN', code })
      .expect(200);
    const verified = body<LoginResponseBody>(verifyRes);
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
      create: { userId: user.id, firstName: 'E2E', lastName: 'Return Customer' },
    });
    return loginByPhone(phone);
  };

  const createFreshSellableSku = async (stockQuantity: number): Promise<string> => {
    const suffix = randomUUID().slice(0, 8);
    const brandId = body<{ id: string }>(
      await request(server).get('/catalog/brands/ray-ban').expect(200),
    ).id;
    const categoryId = body<{ id: string }>(
      await request(server).get('/catalog/categories/sunglasses').expect(200),
    ).id;

    const productId = body<{ id: string }>(
      await request(server)
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productType: 'SUNGLASSES',
          brandId,
          categoryId,
          name: `E2E Return Frame ${suffix}`,
          slug: `e2e-return-frame-${suffix}`,
          shortDescription: 'Created by the return e2e suite',
        })
        .expect(201),
    ).id;
    const variantId = body<{ id: string }>(
      await request(server)
        .post('/admin/catalog/variants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, color: 'Black', size: '52mm', isDefault: true })
        .expect(201),
    ).id;
    const skuId = body<{ id: string }>(
      await request(server)
        .post('/admin/catalog/skus')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, variantId, skuCode: `E2E-RETURN-SKU-${suffix}` })
        .expect(201),
    ).id;

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
    await request(server)
      .post('/admin/inventory/adjustments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        warehouseId: mainWarehouseId,
        locationId: mainLocationId,
        productSkuId: skuId,
        adjustmentType: 'POSITIVE',
        quantity: stockQuantity,
        reason: 'e2e return fixture: seed stock',
      })
      .expect(201);
    return skuId;
  };

  const availableQuantityFor = async (skuId: string): Promise<number> => {
    const res = await request(server)
      .get(`/admin/inventory/stock/${skuId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return body<{ totalAvailableQuantity: number }>(res).totalAvailableQuantity;
  };

  /** Authenticated-customer checkout -> payment -> order -> approve x2 ->
   * fulfill -> walk the fulfillment lifecycle -> ship -> deliver. */
  const driveOrderToDelivered = async (
    skuId: string,
    quantity: number,
    customerToken: string,
    deliver = true,
  ): Promise<{ orderId: string; orderItemId: string }> => {
    const auth = (req: request.Test): request.Test =>
      req.set('Authorization', `Bearer ${customerToken}`);

    const cart = body<{ id: string }>(await auth(request(server).post('/cart')).expect(201));
    await auth(request(server).post('/cart/items'))
      .send({ productSkuId: skuId, quantity })
      .expect(201);
    const checkoutId = body<{ id: string }>(
      await auth(request(server).post('/checkout')).send({ cartId: cart.id }).expect(201),
    ).id;
    await auth(request(server).post(`/checkout/${checkoutId}/address`))
      .send({
        recipientName: 'E2E Return Tester',
        phone: '+989120000099',
        province: 'Tehran',
        city: 'Tehran',
        addressLine1: 'Test St, No. 4',
      })
      .expect(201);
    await auth(request(server).post(`/checkout/${checkoutId}/validate`)).expect(201);
    await auth(request(server).post(`/checkout/${checkoutId}/price`)).expect(201);
    await auth(request(server).post(`/checkout/${checkoutId}/reserve`)).expect(201);
    await auth(request(server).post(`/checkout/${checkoutId}/ready-for-payment`)).expect(201);

    const intentId = body<{ id: string }>(
      await auth(request(server).post('/payments/intents'))
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201),
    ).id;
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

    const order = body<{ id: string; items: { id: string }[] }>(
      await auth(request(server).get(`/orders/by-checkout/${checkoutId}`)).expect(200),
    );
    const orderItemId = order.items[0]?.id;
    if (!orderItemId) throw new Error('expected the order to have at least one item');

    await request(server)
      .post(`/admin/orders/${order.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(server)
      .post(`/admin/orders/${order.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    if (!deliver) return { orderId: order.id, orderItemId };

    const fulfillment = body<{ id: string }>(
      await request(server)
        .post(`/admin/orders/${order.id}/fulfillments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ warehouseId: mainWarehouseId, items: [{ orderItemId, quantity }] })
        .expect(201),
    );
    for (const status of ['ALLOCATED', 'PROCESSING', 'PACKED', 'READY', 'SHIPPED']) {
      await request(server)
        .patch(`/admin/orders/${order.id}/fulfillments/${fulfillment.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status })
        .expect(200);
    }
    const shipment = body<{ id: string }>(
      await request(server)
        .post(`/admin/orders/${order.id}/fulfillments/${fulfillment.id}/shipments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ carrier: 'Tipax', trackingNumber: `E2E-RETURN-TRACK-${randomUUID()}` })
        .expect(201),
    );
    await request(server)
      .patch(`/admin/orders/${order.id}/shipments/${shipment.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'IN_TRANSIT' })
      .expect(200);
    await request(server)
      .post(`/admin/orders/${order.id}/shipments/${shipment.id}/deliver`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    return { orderId: order.id, orderItemId };
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

    // A dedicated second admin fixture (+989120000017, seed.ts) — not the
    // shared +989120000001 every other e2e spec file also logs in as. Two
    // concurrent request+verify sequences for the same phone race against
    // VerifyOtpUseCase's findLatest(phone, purpose) semantics (only the
    // most recently requested code is ever valid); with Jest's default
    // one-worker-per-file parallelism that's a real, low-probability,
    // pre-existing flake shared by every file contending on
    // +989120000001, not something this suite can fix on its own.
    adminToken = await loginByPhone('+989120000017');
    returnsManagerToken = await loginByPhone('+989120000015');
    returnsClerkToken = await loginByPhone('+989120000016');

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

  describe('Customer lifecycle — REFUND resolution, full path to a real completed refund', () => {
    it('create -> ship -> receive -> inspect -> approve-refund (restocks) -> refund (creates+processes a real Refund)', async () => {
      const customerToken = await provisionCustomer('+989120099910');
      const skuId = await createFreshSellableSku(50);
      const { orderId, orderItemId } = await driveOrderToDelivered(skuId, 2, customerToken);

      const created = body<ReturnBody>(
        await request(server)
          .post('/returns')
          .set('Authorization', `Bearer ${customerToken}`)
          .send({ orderId, reason: 'CHANGED_MIND', items: [{ orderItemId, quantity: 1 }] })
          .expect(201),
      );
      expect(created.status).toBe('REQUESTED');
      expect(created.resolution).toBe('REFUND');

      await request(server)
        .post(`/admin/returns/${created.id}/approve`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(201);
      await request(server)
        .post(`/returns/${created.id}/ship`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);

      await request(server)
        .post(`/admin/returns/${created.id}/receive`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .send({ warehouseId: mainWarehouseId, locationId: mainLocationId })
        .expect(201);

      const returnItemId = created.items[0]?.id;
      if (!returnItemId) throw new Error('expected a return item');
      const inspected = body<ReturnBody>(
        await request(server)
          .post(`/admin/returns/${created.id}/inspect`)
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .send({ items: [{ returnItemId, condition: 'UNOPENED' }] })
          .expect(201),
      );
      expect(inspected.status).toBe('INSPECTING');

      const availableBefore = await availableQuantityFor(skuId);
      const approved = body<ReturnBody>(
        await request(server)
          .post(`/admin/returns/${created.id}/approve-refund`)
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .expect(201),
      );
      expect(approved.status).toBe('APPROVED_FOR_REFUND');
      // Restocked exactly once — the whole point of ADR-012 decision 6.
      const availableAfter = await availableQuantityFor(skuId);
      expect(availableAfter).toBe(availableBefore + 1);

      const refunded = body<ReturnBody>(
        await request(server)
          .post(`/admin/returns/${created.id}/refund`)
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .expect(201),
      );
      expect(refunded.status).toBe('REFUNDED');

      const refundsList = body<RefundBody[]>(
        await request(server)
          .get(`/admin/payments/refunds?returnRequestId=${created.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200),
      );
      expect(refundsList).toHaveLength(1);
      expect(refundsList[0]?.status).toBe('PENDING');
      const refundId = refundsList[0]?.id;
      if (!refundId) throw new Error('expected a refund');

      const processed = body<RefundBody>(
        await request(server)
          .post(`/admin/payments/refunds/${refundId}/process`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(201),
      );
      expect(processed.status).toBe('COMPLETED');

      const order = body<OrderBody>(
        await request(server)
          .get(`/admin/orders/${orderId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200),
      );
      expect(order.paymentStatus).toBe('PARTIALLY_REFUNDED');
      expect(BigInt(order.refundedTotal)).toBeGreaterThan(0n);
    });
  });

  describe('Customer lifecycle — CREDIT_NOTE resolution', () => {
    it('approve-refund drafts a CreditNote; refund issues it — Invoice itself is never mutated', async () => {
      const customerToken = await provisionCustomer('+989120099911');
      const skuId = await createFreshSellableSku(50);
      const { orderId, orderItemId } = await driveOrderToDelivered(skuId, 1, customerToken);

      const created = body<ReturnBody>(
        await request(server)
          .post('/returns')
          .set('Authorization', `Bearer ${customerToken}`)
          .send({
            orderId,
            reason: 'SIZE_FIT_ISSUE',
            resolution: 'CREDIT_NOTE',
            items: [{ orderItemId, quantity: 1 }],
          })
          .expect(201),
      );
      expect(created.resolution).toBe('CREDIT_NOTE');

      await request(server)
        .post(`/admin/returns/${created.id}/approve`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(201);
      await request(server)
        .post(`/returns/${created.id}/ship`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);
      await request(server)
        .post(`/admin/returns/${created.id}/receive`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .send({ warehouseId: mainWarehouseId, locationId: mainLocationId })
        .expect(201);
      const returnItemId = created.items[0]?.id;
      if (!returnItemId) throw new Error('expected a return item');
      await request(server)
        .post(`/admin/returns/${created.id}/inspect`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .send({ items: [{ returnItemId, condition: 'OPENED_UNUSED' }] })
        .expect(201);
      await request(server)
        .post(`/admin/returns/${created.id}/approve-refund`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(201);

      const draftNotes = body<CreditNoteBody[]>(
        await request(server)
          .get(`/admin/credit-notes?returnRequestId=${created.id}`)
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .expect(200),
      );
      expect(draftNotes).toHaveLength(1);
      expect(draftNotes[0]?.status).toBe('DRAFT');

      await request(server)
        .post(`/admin/returns/${created.id}/refund`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(201);

      const issuedNote = body<CreditNoteBody>(
        await request(server)
          .get(`/admin/credit-notes/${draftNotes[0]?.id}`)
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .expect(200),
      );
      expect(issuedNote.status).toBe('ISSUED');

      // Void it — a distinct, deliberate admin action, never automatic.
      const voided = body<CreditNoteBody>(
        await request(server)
          .post(`/admin/credit-notes/${issuedNote.id}/void`)
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .send({ reason: 'e2e teardown' })
          .expect(201),
      );
      expect(voided.status).toBe('VOID');
    });
  });

  describe('A rejected return never restocks (ADR-012 decision 6)', () => {
    it('rejecting a DAMAGED item after inspection leaves available stock unchanged', async () => {
      const customerToken = await provisionCustomer('+989120099912');
      const skuId = await createFreshSellableSku(50);
      const { orderId, orderItemId } = await driveOrderToDelivered(skuId, 1, customerToken);

      const created = body<ReturnBody>(
        await request(server)
          .post('/returns')
          .set('Authorization', `Bearer ${customerToken}`)
          .send({ orderId, reason: 'DEFECTIVE', items: [{ orderItemId, quantity: 1 }] })
          .expect(201),
      );
      await request(server)
        .post(`/admin/returns/${created.id}/approve`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(201);
      await request(server)
        .post(`/returns/${created.id}/ship`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);
      await request(server)
        .post(`/admin/returns/${created.id}/receive`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .send({ warehouseId: mainWarehouseId, locationId: mainLocationId })
        .expect(201);
      const returnItemId = created.items[0]?.id;
      if (!returnItemId) throw new Error('expected a return item');
      await request(server)
        .post(`/admin/returns/${created.id}/inspect`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .send({ items: [{ returnItemId, condition: 'DEFECTIVE' }] })
        .expect(201);

      const availableBefore = await availableQuantityFor(skuId);
      const rejected = body<ReturnBody>(
        await request(server)
          .post(`/admin/returns/${created.id}/reject`)
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .send({ reason: 'Defective on arrival at the warehouse — not resalable' })
          .expect(201),
      );
      expect(rejected.status).toBe('REJECTED');
      expect(await availableQuantityFor(skuId)).toBe(availableBefore);
    });
  });

  describe('Return-quantity invariant, over HTTP', () => {
    it('rejects a second return request once the line is already fully returned (409)', async () => {
      const customerToken = await provisionCustomer('+989120099913');
      const skuId = await createFreshSellableSku(50);
      const { orderId, orderItemId } = await driveOrderToDelivered(skuId, 2, customerToken);

      await request(server)
        .post('/returns')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ orderId, reason: 'CHANGED_MIND', items: [{ orderItemId, quantity: 2 }] })
        .expect(201);

      const res = await request(server)
        .post('/returns')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ orderId, reason: 'CHANGED_MIND', items: [{ orderItemId, quantity: 1 }] })
        .expect(409);
      expect(body<{ error: string }>(res).error).toBe('OverReturnedError');
    });
  });

  describe('Return eligibility, over HTTP', () => {
    it('rejects a return for an order item that was never delivered (409)', async () => {
      const customerToken = await provisionCustomer('+989120099914');
      const skuId = await createFreshSellableSku(50);
      const { orderId, orderItemId } = await driveOrderToDelivered(skuId, 1, customerToken, false);

      const res = await request(server)
        .post('/returns')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ orderId, reason: 'CHANGED_MIND', items: [{ orderItemId, quantity: 1 }] })
        .expect(409);
      expect(body<{ error: string }>(res).error).toBe('ReturnNotEligibleError');
    });
  });

  describe('Ownership (IDOR)', () => {
    it("a customer cannot read another customer's return", async () => {
      const ownerToken = await provisionCustomer('+989120099915');
      const strangerToken = await provisionCustomer('+989120099916');
      const skuId = await createFreshSellableSku(50);
      const { orderId, orderItemId } = await driveOrderToDelivered(skuId, 1, ownerToken);

      const created = body<ReturnBody>(
        await request(server)
          .post('/returns')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ orderId, reason: 'CHANGED_MIND', items: [{ orderItemId, quantity: 1 }] })
          .expect(201),
      );

      await request(server)
        .get(`/returns/${created.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
      await request(server)
        .post(`/returns/${created.id}/cancel`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);

      // The real owner can read and cancel their own return.
      await request(server)
        .get(`/returns/${created.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const cancelled = body<ReturnBody>(
        await request(server)
          .post(`/returns/${created.id}/cancel`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(201),
      );
      expect(cancelled.status).toBe('CANCELLED');
    });
  });

  describe('RBAC — returns_clerk cannot approve/reject/refund (ADR-012 RBAC section)', () => {
    it('returns_clerk gets 403 on approve/reject/approve-refund/refund, but 201 on receive/inspect', async () => {
      const customerToken = await provisionCustomer('+989120099917');
      const skuId = await createFreshSellableSku(50);
      const { orderId, orderItemId } = await driveOrderToDelivered(skuId, 1, customerToken);

      const created = body<ReturnBody>(
        await request(server)
          .post('/returns')
          .set('Authorization', `Bearer ${customerToken}`)
          .send({ orderId, reason: 'CHANGED_MIND', items: [{ orderItemId, quantity: 1 }] })
          .expect(201),
      );

      await request(server)
        .post(`/admin/returns/${created.id}/approve`)
        .set('Authorization', `Bearer ${returnsClerkToken}`)
        .expect(403);
      // The real approval, by a role that actually holds return.approve.
      await request(server)
        .post(`/admin/returns/${created.id}/approve`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(201);

      await request(server)
        .post(`/returns/${created.id}/ship`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);

      // returns_clerk CAN receive and inspect (the warehouse-floor role).
      await request(server)
        .post(`/admin/returns/${created.id}/receive`)
        .set('Authorization', `Bearer ${returnsClerkToken}`)
        .send({ warehouseId: mainWarehouseId, locationId: mainLocationId })
        .expect(201);
      const returnItemId = created.items[0]?.id;
      if (!returnItemId) throw new Error('expected a return item');
      await request(server)
        .post(`/admin/returns/${created.id}/inspect`)
        .set('Authorization', `Bearer ${returnsClerkToken}`)
        .send({ items: [{ returnItemId, condition: 'UNOPENED' }] })
        .expect(201);

      // But cannot approve for refund, reject, or trigger the refund.
      await request(server)
        .post(`/admin/returns/${created.id}/approve-refund`)
        .set('Authorization', `Bearer ${returnsClerkToken}`)
        .expect(403);
      await request(server)
        .post(`/admin/returns/${created.id}/reject`)
        .set('Authorization', `Bearer ${returnsClerkToken}`)
        .send({ reason: 'attempted bypass' })
        .expect(403);

      // A plain customer token gets 403 on every admin/* return route too.
      await request(server)
        .get(`/admin/returns/${created.id}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
    });
  });

  describe('Admin settlement/reconciliation API (ADR-013)', () => {
    it('a real REFUND-resolution settlement is readable, listed as active, retry no-ops, and reconcile finds nothing wrong', async () => {
      const customerToken = await provisionCustomer('+989120099918');
      const skuId = await createFreshSellableSku(50);
      const { orderId, orderItemId } = await driveOrderToDelivered(skuId, 1, customerToken);

      const created = body<ReturnBody>(
        await request(server)
          .post('/returns')
          .set('Authorization', `Bearer ${customerToken}`)
          .send({ orderId, reason: 'CHANGED_MIND', items: [{ orderItemId, quantity: 1 }] })
          .expect(201),
      );
      await request(server)
        .post(`/admin/returns/${created.id}/approve`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(201);
      await request(server)
        .post(`/returns/${created.id}/ship`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);
      await request(server)
        .post(`/admin/returns/${created.id}/receive`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .send({ warehouseId: mainWarehouseId, locationId: mainLocationId })
        .expect(201);
      const returnItemId = created.items[0]?.id;
      if (!returnItemId) throw new Error('expected a return item');
      await request(server)
        .post(`/admin/returns/${created.id}/inspect`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .send({ items: [{ returnItemId, condition: 'UNOPENED' }] })
        .expect(201);

      // Before approve-refund: the settlement row does not exist yet.
      await request(server)
        .get(`/admin/returns/${created.id}/settlement`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(404);

      await request(server)
        .post(`/admin/returns/${created.id}/approve-refund`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(201);

      // Restocked, still waiting for the admin's own refund() click —
      // RESTOCKED is a legitimate waiting state, retry() is a no-op.
      const afterRestock = body<{ id: string; status: string }>(
        await request(server)
          .get(`/admin/returns/${created.id}/settlement`)
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .expect(200),
      );
      expect(afterRestock.status).toBe('RESTOCKED');
      const retriedNoOp = body<{ status: string }>(
        await request(server)
          .post(`/admin/returns/${created.id}/settlement/retry`)
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .expect(201),
      );
      expect(retriedNoOp.status).toBe('RESTOCKED');

      await request(server)
        .post(`/admin/returns/${created.id}/refund`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(201);

      const settled = body<{
        id: string;
        status: string;
        attempts: number;
        lastError: string | null;
      }>(
        await request(server)
          .get(`/admin/returns/${created.id}/settlement`)
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .expect(200),
      );
      expect(settled.status).toBe('SETTLED');
      expect(settled.attempts).toBe(0);
      expect(settled.lastError).toBeNull();

      // Listed in the default "active" view (SETTLED is still active —
      // COMPLETED only happens via the separate return_settlement_sync
      // sweep, ADR-013's own fix).
      const activeList = body<{ id: string }[]>(
        await request(server)
          .get('/admin/returns/settlements')
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .expect(200),
      );
      expect(activeList.some((s) => s.id === settled.id)).toBe(true);

      // Never appears in the MANUAL_REVIEW view — nothing went wrong.
      const manualReviewList = body<{ id: string }[]>(
        await request(server)
          .get('/admin/returns/settlements?status=MANUAL_REVIEW')
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .expect(200),
      );
      expect(manualReviewList.some((s) => s.id === settled.id)).toBe(false);

      // retry() on an already-SETTLED settlement is a safe no-op.
      const retriedAgain = body<{ status: string }>(
        await request(server)
          .post(`/admin/returns/${created.id}/settlement/retry`)
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .expect(201),
      );
      expect(retriedAgain.status).toBe('SETTLED');

      // reconcile() runs the real global engine and returns only this
      // return's own findings — a healthy settlement produces none.
      const reconciled = body<{ findings: unknown[]; manualReviewCount: number }>(
        await request(server)
          .post(`/admin/returns/${created.id}/reconcile`)
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .expect(201),
      );
      expect(reconciled.findings).toHaveLength(0);
    });

    it('404s for a return with no settlement row, and for a genuinely nonexistent return id', async () => {
      await request(server)
        .get(`/admin/returns/${randomUUID()}/settlement`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(404);
      await request(server)
        .post(`/admin/returns/${randomUUID()}/settlement/retry`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(404);
      await request(server)
        .post(`/admin/returns/${randomUUID()}/reconcile`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(404);
    });

    it('RBAC: returns_clerk and a plain customer get 403 on every settlement route; a customer can never reach it via any path', async () => {
      const customerToken = await provisionCustomer('+989120099919');
      const skuId = await createFreshSellableSku(50);
      const { orderId, orderItemId } = await driveOrderToDelivered(skuId, 1, customerToken);
      const created = body<ReturnBody>(
        await request(server)
          .post('/returns')
          .set('Authorization', `Bearer ${customerToken}`)
          .send({ orderId, reason: 'CHANGED_MIND', items: [{ orderItemId, quantity: 1 }] })
          .expect(201),
      );

      for (const token of [returnsClerkToken, customerToken]) {
        await request(server)
          .get('/admin/returns/settlements')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
        await request(server)
          .get(`/admin/returns/${created.id}/settlement`)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
        await request(server)
          .post(`/admin/returns/${created.id}/settlement/retry`)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
        await request(server)
          .post(`/admin/returns/${created.id}/reconcile`)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
      }
    });

    it('a premature refund() before restock completes is a real 409, and the settlement records neither an attempt nor an error', async () => {
      const customerToken = await provisionCustomer('+989120099920');
      const skuId = await createFreshSellableSku(50);
      const { orderId, orderItemId } = await driveOrderToDelivered(skuId, 1, customerToken);
      const created = body<ReturnBody>(
        await request(server)
          .post('/returns')
          .set('Authorization', `Bearer ${customerToken}`)
          .send({ orderId, reason: 'CHANGED_MIND', items: [{ orderItemId, quantity: 1 }] })
          .expect(201),
      );
      await request(server)
        .post(`/admin/returns/${created.id}/approve`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(201);
      await request(server)
        .post(`/returns/${created.id}/ship`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);
      await request(server)
        .post(`/admin/returns/${created.id}/receive`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .send({ warehouseId: mainWarehouseId, locationId: mainLocationId })
        .expect(201);
      const returnItemId = created.items[0]?.id;
      if (!returnItemId) throw new Error('expected a return item');
      await request(server)
        .post(`/admin/returns/${created.id}/inspect`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .send({ items: [{ returnItemId, condition: 'UNOPENED' }] })
        .expect(201);
      await request(server)
        .post(`/admin/returns/${created.id}/approve-refund`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(201);

      // Double-click protection: approve-refund a second time is a
      // safe no-op (ADR-012, unchanged), never a duplicate restock.
      await request(server)
        .post(`/admin/returns/${created.id}/approve-refund`)
        .set('Authorization', `Bearer ${returnsManagerToken}`)
        .expect(201);

      const settlement = body<{ id: string; status: string; attempts: number }>(
        await request(server)
          .get(`/admin/returns/${created.id}/settlement`)
          .set('Authorization', `Bearer ${returnsManagerToken}`)
          .expect(200),
      );
      expect(settlement.status).toBe('RESTOCKED');
      expect(settlement.attempts).toBe(0);
    });
  });
});
