import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { prisma } from '@iecp/database';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaFulfillmentRepository } from '../src/modules/order/infrastructure/repositories/prisma-fulfillment.repository';
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

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * Repository/transaction-boundary integration tests for the Phase 011
 * hardening (ADR-011 decision 1/2). Unlike `promotion-repository.e2e-spec.ts`
 * (whose aggregates have no deep foreign-key chain), `Order`/`Fulfillment`/
 * `Shipment` genuinely require a real `CheckoutSession`/`PaymentIntent`
 * chain to exist first (both real, enforced FKs) — so this file boots the
 * full app the same way `order.e2e-spec.ts` does purely for *setup*
 * (driving one real order to `READY_TO_FULFILL` and creating one real
 * fulfillment/shipment via HTTP), then bypasses HTTP entirely for the
 * actual racy calls, hitting `PrismaFulfillmentRepository` directly — the
 * exact layer ADR-011 decision 1's row-lock fix lives in, proven
 * independent of the controller/guard/HTTP stack above it.
 */
describe('Order/Fulfillment repository (integration)', () => {
  let app: INestApplication;
  let server: Server;
  let adminToken: string;
  let mainWarehouseId: string;
  let mainLocationId: string;
  const fulfillments = new PrismaFulfillmentRepository();

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
          name: `E2E Order Repo Frame ${suffix}`,
          slug: `e2e-order-repo-frame-${suffix}`,
          shortDescription: 'Created by the order-repository e2e suite',
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
        .send({ productId, variantId, skuCode: `E2E-ORDER-REPO-SKU-${suffix}` })
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
        reason: 'e2e order-repository fixture: seed stock',
      })
      .expect(201);
    return skuId;
  };

  /** Guest checkout -> payment -> order -> approve x2 -> READY_TO_FULFILL,
   * returning the real order id and its one real order item id. */
  const driveOrderReadyToFulfill = async (
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
        recipientName: 'E2E Repo Tester',
        phone: '+989120000097',
        province: 'Tehran',
        city: 'Tehran',
        addressLine1: 'Test St, No. 2',
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

    await request(server)
      .post(`/admin/orders/${order.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(server)
      .post(`/admin/orders/${order.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const orderItemId = order.items[0]?.id;
    if (!orderItemId) throw new Error('expected the order to have at least one item');
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

  describe('ADR-011 decision 1 — fulfillment/shipment status-transition races', () => {
    it('20 concurrent identical fulfillment status updates collapse to exactly one real transition', async () => {
      const { orderId, orderItemId } = await driveOrderReadyToFulfill(
        await createFreshSellableSku(50),
        10,
      );
      const fulfillment = await fulfillments.create({
        orderId,
        items: [{ orderItemId, quantity: 10 }],
      });

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          fulfillments.updateStatus(fulfillment.id, 'ALLOCATED', {}),
        ),
      );
      const transitionedCount = results.filter((r) => r.transitioned).length;
      expect(transitionedCount).toBe(1);
      expect(results.every((r) => r.entity.status === 'ALLOCATED')).toBe(true);
    });

    it('20 concurrent identical shipment status updates collapse to exactly one real transition', async () => {
      const { orderId, orderItemId } = await driveOrderReadyToFulfill(
        await createFreshSellableSku(50),
        5,
      );
      const fulfillment = await fulfillments.create({
        orderId,
        items: [{ orderItemId, quantity: 5 }],
      });
      const shipment = await fulfillments.createShipment(fulfillment.id, {
        carrier: 'Tipax',
        trackingNumber: `E2E-REPO-TRACK-${randomUUID()}`,
      });

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          fulfillments.updateShipmentStatus(shipment.id, 'IN_TRANSIT', {}),
        ),
      );
      const transitionedCount = results.filter((r) => r.transitioned).length;
      expect(transitionedCount).toBe(1);
      expect(results.every((r) => r.entity.status === 'IN_TRANSIT')).toBe(true);
    });

    it('a transition that is no longer legal once the lock is held throws a real conflict, not a silent no-op', async () => {
      const { orderId, orderItemId } = await driveOrderReadyToFulfill(
        await createFreshSellableSku(50),
        3,
      );
      const fulfillment = await fulfillments.create({
        orderId,
        items: [{ orderItemId, quantity: 3 }],
      });
      // Move it to CANCELLED for real first.
      await fulfillments.updateStatus(fulfillment.id, 'CANCELLED', {});
      // A second, distinct target from the now-CANCELLED state is a real,
      // structural rejection — never silently resolved.
      await expect(fulfillments.updateStatus(fulfillment.id, 'ALLOCATED', {})).rejects.toThrow(
        'Cannot transition fulfillment from CANCELLED to ALLOCATED',
      );
    });
  });

  describe('ADR-011 decision 2 — fulfillment creation idempotency', () => {
    it('15 concurrent create() calls with the same idempotencyKey produce exactly one Fulfillment row', async () => {
      const { orderId, orderItemId } = await driveOrderReadyToFulfill(
        await createFreshSellableSku(50),
        10,
      );
      const idempotencyKey = `e2e-repo-${randomUUID()}`;

      const results = await Promise.all(
        Array.from({ length: 15 }, () =>
          fulfillments.create({
            orderId,
            items: [{ orderItemId, quantity: 1 }],
            idempotencyKey,
          }),
        ),
      );
      const distinctIds = new Set(results.map((f) => f.id));
      expect(distinctIds.size).toBe(1);

      const rowCount = await prisma.fulfillment.count({ where: { idempotencyKey } });
      expect(rowCount).toBe(1);
    });

    it('two different idempotencyKeys against the same order produce two distinct fulfillments', async () => {
      const { orderId, orderItemId } = await driveOrderReadyToFulfill(
        await createFreshSellableSku(50),
        4,
      );
      const first = await fulfillments.create({
        orderId,
        items: [{ orderItemId, quantity: 2 }],
        idempotencyKey: `e2e-repo-a-${randomUUID()}`,
      });
      const second = await fulfillments.create({
        orderId,
        items: [{ orderItemId, quantity: 2 }],
        idempotencyKey: `e2e-repo-b-${randomUUID()}`,
      });
      expect(first.id).not.toBe(second.id);
    });
  });
});
