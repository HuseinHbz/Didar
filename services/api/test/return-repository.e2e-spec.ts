import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { prisma } from '@iecp/database';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PAYMENT_PROVIDER_ADAPTER_REGISTRY } from '../src/modules/payment/domain/ports/payment-provider-adapter.port';
import { PrismaRefundRepository } from '../src/modules/payment/infrastructure/repositories/prisma-refund.repository';
import { PrismaCreditNoteRepository } from '../src/modules/return/infrastructure/repositories/prisma-credit-note.repository';
import { PrismaReturnRepository } from '../src/modules/return/infrastructure/repositories/prisma-return.repository';

import { FakePaymentProviderAdapterRegistry } from './support/fake-payment-provider-adapter';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * Repository/transaction-boundary integration tests for ADR-012
 * decisions 5/6/8/9 — the six concurrency proofs the brief requires,
 * proven against real PostgreSQL, never a mocked repository. Same shape
 * `order-repository.e2e-spec.ts` already established for Phase 011:
 * boots the full app purely for *setup* (driving one real order all the
 * way to a real `DELIVERED` fulfillment via HTTP, the only way to get a
 * return-eligible `OrderItem` to exist at all), then bypasses HTTP and
 * even `ReturnService` entirely for the actual racy calls, hitting
 * `PrismaReturnRepository`/`PrismaRefundRepository`/
 * `PrismaCreditNoteRepository` directly — the exact layer each
 * invariant's row-lock/idempotency-key fix lives in, proven independent
 * of the application-layer business rules already covered by this
 * module's own domain unit tests.
 */
describe('Return/Refund/CreditNote repository (integration)', () => {
  let app: INestApplication;
  let server: Server;
  let adminToken: string;
  let mainWarehouseId: string;
  let mainLocationId: string;
  const returns = new PrismaReturnRepository();
  const creditNotes = new PrismaCreditNoteRepository();
  const refunds = new PrismaRefundRepository();

  interface OtpRequestResponseBody {
    expiresAt: string;
    devOnlyCode: string | null;
  }
  interface LoginResponseBody {
    status: 'AUTHENTICATED' | 'TWO_FACTOR_REQUIRED';
    tokens?: { accessToken: string; refreshToken: string };
  }

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
          name: `E2E Return Repo Frame ${suffix}`,
          slug: `e2e-return-repo-frame-${suffix}`,
          shortDescription: 'Created by the return-repository e2e suite',
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
        .send({ productId, variantId, skuCode: `E2E-RETURN-REPO-SKU-${suffix}` })
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
        reason: 'e2e return-repository fixture: seed stock',
      })
      .expect(201);
    return skuId;
  };

  /** Guest checkout -> payment -> order -> approve x2 -> fulfill -> walk
   * the fulfillment through its own lifecycle -> ship -> deliver. The
   * only way to get a real, return-eligible `OrderItem` to exist
   * (`ReturnEligibilityValidator` requires a real `DELIVERED`
   * `Fulfillment`), same flow `order.e2e-spec.ts`'s own delivery test
   * establishes end to end. */
  const driveOrderToDelivered = async (
    skuId: string,
    quantity: number,
  ): Promise<{ orderId: string; orderItemId: string }> => {
    const cart = body<{ id: string; guestToken: string }>(
      await request(server).post('/cart').expect(201),
    );
    await request(server)
      .post('/cart/items')
      .set('X-Cart-Token', cart.guestToken)
      .send({ productSkuId: skuId, quantity })
      .expect(201);
    const checkoutId = body<{ id: string }>(
      await request(server)
        .post('/checkout')
        .set('X-Cart-Token', cart.guestToken)
        .send({ cartId: cart.id })
        .expect(201),
    ).id;
    await request(server)
      .post(`/checkout/${checkoutId}/address`)
      .set('X-Cart-Token', cart.guestToken)
      .send({
        recipientName: 'E2E Return Repo Tester',
        phone: '+989120000098',
        province: 'Tehran',
        city: 'Tehran',
        addressLine1: 'Test St, No. 3',
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
    await request(server)
      .post(`/checkout/${checkoutId}/ready-for-payment`)
      .set('X-Cart-Token', cart.guestToken)
      .expect(201);

    const intentId = body<{ id: string }>(
      await request(server)
        .post('/payments/intents')
        .set('X-Cart-Token', cart.guestToken)
        .send({ checkoutSessionId: checkoutId, providerCode: 'zarinpal' })
        .expect(201),
    ).id;
    const startRes = await request(server)
      .post(`/payments/intents/${intentId}/start`)
      .set('X-Cart-Token', cart.guestToken)
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
      .set('X-Cart-Token', cart.guestToken)
      .expect(200);
    const order = body<{ id: string; items: { id: string }[] }>(orderRes);
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

    const fulfillmentRes = await request(server)
      .post(`/admin/orders/${order.id}/fulfillments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ warehouseId: mainWarehouseId, items: [{ orderItemId, quantity }] })
      .expect(201);
    const fulfillment = body<{ id: string }>(fulfillmentRes);

    for (const status of ['ALLOCATED', 'PROCESSING', 'PACKED', 'READY', 'SHIPPED']) {
      await request(server)
        .patch(`/admin/orders/${order.id}/fulfillments/${fulfillment.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status })
        .expect(200);
    }

    const shipmentRes = await request(server)
      .post(`/admin/orders/${order.id}/fulfillments/${fulfillment.id}/shipments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ carrier: 'Tipax', trackingNumber: `E2E-RETURN-REPO-TRACK-${randomUUID()}` })
      .expect(201);
    const shipment = body<{ id: string }>(shipmentRes);
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

  /** Real, VERIFIED `PaymentTransaction` for `orderId` — needed to
   * create a `Refund` row directly, bypassing `RefundService`. */
  const verifiedTransactionIdFor = async (orderId: string): Promise<string> => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const transaction = await prisma.paymentTransaction.findFirstOrThrow({
      where: { paymentIntentId: order.paymentIntentId, status: 'VERIFIED' },
    });
    return transaction.id;
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

  describe('ADR-012 decision 5 — return-quantity invariant under real concurrency', () => {
    it('never allows the sum of concurrent returns against one line to exceed what remains', async () => {
      const { orderId, orderItemId } = await driveOrderToDelivered(
        await createFreshSellableSku(50),
        10,
      );

      // 4 concurrent requests of 3 units each against a 10-unit line:
      // capacity only ever admits 3 of them (3+3+3=9<=10); the 4th
      // always finds only 1 unit left and is rejected — deterministic
      // regardless of which specific call wins the race.
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          returns.create({
            orderId,
            reason: 'CHANGED_MIND',
            items: [{ orderItemId, quantity: 3 }],
          }),
        ),
      );
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');
      expect(succeeded).toHaveLength(3);
      expect(failed).toHaveLength(1);

      const totalReturned = await returns.sumReturnedQuantity(orderItemId);
      expect(totalReturned).toBe(9);
      expect(totalReturned).toBeLessThanOrEqual(10);
    });

    it('a single request for more than what is available is rejected outright', async () => {
      const { orderId, orderItemId } = await driveOrderToDelivered(
        await createFreshSellableSku(50),
        2,
      );
      await expect(
        returns.create({
          orderId,
          reason: 'DEFECTIVE',
          items: [{ orderItemId, quantity: 3 }],
        }),
      ).rejects.toThrow(/Cannot return/);
    });
  });

  describe('ADR-012 decision 9 — return-creation idempotency', () => {
    it('15 concurrent create() calls with the same idempotencyKey produce exactly one ReturnRequest row', async () => {
      const { orderId, orderItemId } = await driveOrderToDelivered(
        await createFreshSellableSku(50),
        10,
      );
      const idempotencyKey = `e2e-return-repo-${randomUUID()}`;

      const results = await Promise.all(
        Array.from({ length: 15 }, () =>
          returns.create({
            orderId,
            reason: 'CHANGED_MIND',
            items: [{ orderItemId, quantity: 1 }],
            idempotencyKey,
          }),
        ),
      );
      const distinctIds = new Set(results.map((r) => r.id));
      expect(distinctIds.size).toBe(1);

      const rowCount = await prisma.returnRequest.count({ where: { idempotencyKey } });
      expect(rowCount).toBe(1);
    });
  });

  describe('ADR-012 decision 1/5 — return status-transition races', () => {
    it('20 concurrent identical approve() calls collapse to exactly one real transition', async () => {
      const { orderId, orderItemId } = await driveOrderToDelivered(
        await createFreshSellableSku(50),
        5,
      );
      const created = await returns.create({
        orderId,
        reason: 'CHANGED_MIND',
        items: [{ orderItemId, quantity: 1 }],
      });

      const results = await Promise.all(
        Array.from({ length: 20 }, () => returns.updateStatus(created.id, 'APPROVED', null)),
      );
      const transitionedCount = results.filter((r) => r.transitioned).length;
      expect(transitionedCount).toBe(1);
      expect(results.every((r) => r.entity.status === 'APPROVED')).toBe(true);
    });

    it('20 concurrent approve-for-refund calls collapse to exactly one real transition (the restock gate)', async () => {
      const { orderId, orderItemId } = await driveOrderToDelivered(
        await createFreshSellableSku(50),
        5,
      );
      const created = await returns.create({
        orderId,
        reason: 'CHANGED_MIND',
        items: [{ orderItemId, quantity: 1 }],
      });
      await returns.updateStatus(created.id, 'APPROVED', null);
      await returns.updateStatus(created.id, 'CUSTOMER_SHIPPING', null);
      await returns.updateStatus(created.id, 'RECEIVED', null, null, {
        warehouseId: mainWarehouseId,
        locationId: mainLocationId,
      });
      await returns.updateStatus(created.id, 'INSPECTING', null);

      // This is exactly the gate `ReturnService.approveForRefund()`
      // relies on to call `AdjustmentService.receiveReturnedStock()` at
      // most once — proving it collapses to one real transition here,
      // at the repository layer, is the equivalent of proving restock
      // itself can never double-fire, the same "prove it at the layer
      // the fix actually lives in" scope `order-repository.e2e-spec.ts`
      // already established for fulfillment/shipment races.
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          returns.updateStatus(created.id, 'APPROVED_FOR_REFUND', null),
        ),
      );
      const transitionedCount = results.filter((r) => r.transitioned).length;
      expect(transitionedCount).toBe(1);
      expect(results.every((r) => r.entity.status === 'APPROVED_FOR_REFUND')).toBe(true);
    });

    it('a transition that is no longer legal once the lock is held throws a real conflict, not a silent no-op', async () => {
      const { orderId, orderItemId } = await driveOrderToDelivered(
        await createFreshSellableSku(50),
        3,
      );
      const created = await returns.create({
        orderId,
        reason: 'CHANGED_MIND',
        items: [{ orderItemId, quantity: 1 }],
      });
      await returns.updateStatus(created.id, 'REJECTED', null, 'Rejected before shipping');
      await expect(returns.updateStatus(created.id, 'APPROVED', null)).rejects.toThrow(
        'Cannot transition return from REJECTED to APPROVED',
      );
    });
  });

  describe('ADR-012 decision 8/9 — refund creation cannot double-refund a return', () => {
    it('10 concurrent Refund.create() calls with the same deterministic key produce exactly one Refund row', async () => {
      const { orderId, orderItemId } = await driveOrderToDelivered(
        await createFreshSellableSku(50),
        4,
      );
      const created = await returns.create({
        orderId,
        reason: 'CHANGED_MIND',
        items: [{ orderItemId, quantity: 1 }],
      });
      const transactionId = await verifiedTransactionIdFor(orderId);
      const idempotencyKey = `return-refund__${created.id}`;

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          refunds.create({
            paymentTransactionId: transactionId,
            amount: 5_625_000n,
            idempotencyKey,
            returnRequestId: created.id,
          }),
        ),
      );
      const distinctIds = new Set(results.map((r) => r.id));
      expect(distinctIds.size).toBe(1);

      const rowCount = await prisma.refund.count({ where: { idempotencyKey } });
      expect(rowCount).toBe(1);
    });
  });

  describe('ADR-012 decision 7/9 — credit-note issuance cannot duplicate', () => {
    it('20 concurrent DRAFT -> ISSUED calls on the same credit note collapse to exactly one real transition', async () => {
      const { orderId, orderItemId } = await driveOrderToDelivered(
        await createFreshSellableSku(50),
        4,
      );
      const created = await returns.create({
        orderId,
        reason: 'CHANGED_MIND',
        resolution: 'CREDIT_NOTE',
        items: [{ orderItemId, quantity: 1 }],
      });
      const draft = await creditNotes.create({
        orderId,
        returnRequestId: created.id,
        subtotal: 5_625_000n,
        grandTotal: 5_625_000n,
        lines: [
          {
            description: 'Return credit',
            quantity: 1,
            unitPrice: 5_625_000n,
            lineTotal: 5_625_000n,
          },
        ],
      });

      const results = await Promise.all(
        Array.from({ length: 20 }, () => creditNotes.updateStatus(draft.id, 'ISSUED')),
      );
      const transitionedCount = results.filter((r) => r.transitioned).length;
      expect(transitionedCount).toBe(1);
      expect(results.every((r) => r.entity.status === 'ISSUED')).toBe(true);

      const rowCount = await prisma.creditNote.count({ where: { id: draft.id, status: 'ISSUED' } });
      expect(rowCount).toBe(1);
    });
  });
});
