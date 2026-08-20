import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { prisma } from '@iecp/database';
import { asProductSkuId, asWarehouseId, asWarehouseLocationId } from '@iecp/types';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AdjustmentService } from '../src/modules/inventory/application/adjustment.service';
import { PAYMENT_PROVIDER_ADAPTER_REGISTRY } from '../src/modules/payment/domain/ports/payment-provider-adapter.port';
import { ReturnReconciliationService } from '../src/modules/return/application/return-reconciliation.service';
import { ReturnSettlementService } from '../src/modules/return/application/return-settlement.service';
import { InvalidReturnSettlementTransitionError } from '../src/modules/return/domain/services/return-settlement-state-machine';
import { PrismaReturnSettlementRepository } from '../src/modules/return/infrastructure/repositories/prisma-return-settlement.repository';
import { PrismaReturnRepository } from '../src/modules/return/infrastructure/repositories/prisma-return.repository';

import { FakePaymentProviderAdapterRegistry } from './support/fake-payment-provider-adapter';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * ADR-013 — the 10 concurrency/crash-recovery proofs the brief
 * requires, proven against real PostgreSQL, never a mocked repository
 * or a mocked transaction lock. Same shape `return-repository.e2e-spec
 * .ts` already established: boots the full app purely for *setup*
 * (driving a real order to `DELIVERED` via HTTP is the only way to get
 * a return-eligible `OrderItem`), then bypasses HTTP and calls
 * `ReturnSettlementService`/`ReturnReconciliationService`/
 * `PrismaReturnSettlementRepository`/`AdjustmentService` directly — the
 * exact layer each invariant's row-lock/idempotency-key fix lives in.
 */
describe('Return settlement repository/orchestration (integration, ADR-013)', () => {
  let app: INestApplication;
  let server: Server;
  let adminToken: string;
  let adminUserId: string;
  let mainWarehouseId: string;
  let mainLocationId: string;
  const returns = new PrismaReturnRepository();
  const settlements = new PrismaReturnSettlementRepository();
  let settlementService: ReturnSettlementService;
  let reconciliationService: ReturnReconciliationService;
  let adjustments: AdjustmentService;

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
          name: `E2E Settlement Repo Frame ${suffix}`,
          slug: `e2e-settlement-repo-frame-${suffix}`,
          shortDescription: 'Created by the return-settlement-repository e2e suite',
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
        .send({ productId, variantId, skuCode: `E2E-SETTLEMENT-REPO-SKU-${suffix}` })
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
        reason: 'e2e return-settlement-repository fixture: seed stock',
      })
      .expect(201);
    return skuId;
  };

  /** Guest checkout -> payment -> order -> approve x2 -> fulfill -> walk
   * the fulfillment through its own lifecycle -> ship -> deliver, then
   * drive the return itself through RECEIVED/INSPECTING so a caller can
   * approveForRefund() next. Returns everything a test needs to build
   * an `APPROVED_FOR_REFUND`-ready return from scratch. */
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
        recipientName: 'E2E Settlement Repo Tester',
        phone: '+989120000099',
        province: 'Tehran',
        city: 'Tehran',
        addressLine1: 'Test St, No. 4',
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
      .send({ carrier: 'Tipax', trackingNumber: `E2E-SETTLEMENT-REPO-TRACK-${randomUUID()}` })
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

  /** Drives a fresh return from creation through `APPROVED_FOR_REFUND`
   * (the point `ensureSettlement()` + the `PENDING_RESTOCK` settlement
   * row both exist, restock not yet attempted) — the common starting
   * point every proof below needs. Bypasses `ReturnService` entirely,
   * same "hit the repository layer directly" scope this file's sibling
   * establishes; `settlementService`/`reconciliationService` under test
   * are the real DI-resolved singletons. */
  const buildApprovedForRefundReturn = async (
    quantity = 1,
    resolution: 'REFUND' | 'CREDIT_NOTE' = 'REFUND',
  ): Promise<{ returnRequestId: string; orderId: string; productSkuId: string }> => {
    const skuId = await createFreshSellableSku(50);
    const { orderId, orderItemId } = await driveOrderToDelivered(skuId, quantity);
    const created = await returns.create({
      orderId,
      reason: 'CHANGED_MIND',
      resolution,
      items: [{ orderItemId, quantity: 1 }],
    });
    await returns.updateStatus(created.id, 'APPROVED', null);
    await returns.updateStatus(created.id, 'CUSTOMER_SHIPPING', null);
    await returns.updateStatus(created.id, 'RECEIVED', null, null, {
      warehouseId: mainWarehouseId,
      locationId: mainLocationId,
    });
    await returns.updateStatus(created.id, 'INSPECTING', null);
    const detail = await returns.findById(created.id);
    const returnItemId = detail?.items[0]?.id;
    if (!returnItemId) throw new Error('expected a return item after create()');
    await returns.recordInspection(created.id, [
      { returnItemId, condition: 'UNOPENED', refundAmount: 5_450_000n },
    ]);
    await returns.updateStatus(created.id, 'APPROVED_FOR_REFUND', null);
    await settlements.create(created.id);
    return { returnRequestId: created.id, orderId, productSkuId: skuId };
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
    settlementService = app.get(ReturnSettlementService);
    reconciliationService = app.get(ReturnReconciliationService);
    adjustments = app.get(AdjustmentService);

    adminToken = await loginByPhone('+989120000017');
    adminUserId = (
      await prisma.user.findUniqueOrThrow({ where: { phone: '+989120000017' } })
    ).id;

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

  describe('1. Restock idempotency under real concurrency', () => {
    it('20 concurrent beginRestock() calls restock the eligible item exactly once', async () => {
      const { returnRequestId, productSkuId } = await buildApprovedForRefundReturn();
      const before = await prisma.inventoryItem.findFirstOrThrow({
        where: { productSkuId, warehouseId: mainWarehouseId, locationId: mainLocationId },
      });

      const results = await Promise.all(
        Array.from({ length: 20 }, () => settlementService.beginRestock(returnRequestId, null)),
      );
      expect(results.every((r) => r.status === 'RESTOCKED')).toBe(true);

      const ledgerRows = await prisma.inventoryLedger.count({
        where: { idempotencyKey: { startsWith: 'return-restock__' }, productSkuId },
      });
      expect(ledgerRows).toBe(1);

      const after = await prisma.inventoryItem.findFirstOrThrow({ where: { id: before.id } });
      expect(after.onHandQuantity).toBe(before.onHandQuantity + 1);
    });
  });

  describe('2. Duplicate physical restock delivery cannot double-increment', () => {
    it('20 concurrent AdjustmentService.receiveReturnedStock() calls with the same key produce exactly one ledger row', async () => {
      const { returnRequestId, productSkuId } = await buildApprovedForRefundReturn();
      const detail = await returns.findById(returnRequestId);
      const returnItemId = detail?.items[0]?.id;
      if (!returnItemId) throw new Error('expected a return item');
      const before = await prisma.inventoryItem.findFirstOrThrow({
        where: { productSkuId, warehouseId: mainWarehouseId, locationId: mainLocationId },
      });

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          adjustments.receiveReturnedStock({
            productSkuId: asProductSkuId(productSkuId),
            warehouseId: asWarehouseId(mainWarehouseId),
            locationId: asWarehouseLocationId(mainLocationId),
            quantity: 1,
            returnRequestId,
            returnItemId,
          }),
        ),
      );
      const distinctLedgerIds = new Set(results.map((r) => r.ledgerEntry.id));
      expect(distinctLedgerIds.size).toBe(1);

      const after = await prisma.inventoryItem.findFirstOrThrow({ where: { id: before.id } });
      expect(after.onHandQuantity).toBe(before.onHandQuantity + 1);
    });
  });

  describe('3. Refund settlement cannot double-refund under real concurrency', () => {
    it('20 concurrent requestSettlement() calls produce exactly one Refund row and record Order.refundedTotal exactly once', async () => {
      const { returnRequestId, orderId } = await buildApprovedForRefundReturn(1, 'REFUND');
      await settlementService.beginRestock(returnRequestId, null);
      const orderBefore = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          settlementService.requestSettlement(returnRequestId, null),
        ),
      );
      expect(results.every((r) => r.status === 'SETTLED')).toBe(true);

      const refundRows = await prisma.refund.count({
        where: { idempotencyKey: `return-refund__${returnRequestId}` },
      });
      expect(refundRows).toBe(1);

      const refund = await prisma.refund.findFirstOrThrow({
        where: { idempotencyKey: `return-refund__${returnRequestId}` },
      });
      const orderAfter = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(orderAfter.refundedTotal - orderBefore.refundedTotal).toBe(refund.amount);
    });
  });

  describe('4. Credit-note settlement cannot double-issue under real concurrency', () => {
    it('20 concurrent requestSettlement() calls produce exactly one ISSUED CreditNote', async () => {
      const { returnRequestId } = await buildApprovedForRefundReturn(1, 'CREDIT_NOTE');
      await settlementService.beginRestock(returnRequestId, null);

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          settlementService.requestSettlement(returnRequestId, null),
        ),
      );
      expect(results.every((r) => r.status === 'SETTLED')).toBe(true);

      const issuedCount = await prisma.creditNote.count({
        where: { returnRequestId, status: 'ISSUED' },
      });
      expect(issuedCount).toBe(1);
    });
  });

  describe('5. Crash recovery — commit-then-crash-before-side-effect', () => {
    it('a settlement left PENDING_RESTOCK (as if the process died right after the DB commit) converges safely on the next call', async () => {
      const { returnRequestId, productSkuId } = await buildApprovedForRefundReturn();
      const settlementRow = await settlements.findByReturnRequestId(returnRequestId);
      expect(settlementRow?.status).toBe('PENDING_RESTOCK');

      const result = await settlementService.beginRestock(returnRequestId, null);
      expect(result.status).toBe('RESTOCKED');

      const ledgerRows = await prisma.inventoryLedger.count({
        where: { idempotencyKey: { startsWith: 'return-restock__' }, productSkuId },
      });
      expect(ledgerRows).toBe(1);
    });
  });

  describe('6. Crash recovery — side-effect-then-crash-before-state-update', () => {
    it('a physical restock that already happened is detected, not repeated, when beginRestock() is called again', async () => {
      const { returnRequestId, productSkuId } = await buildApprovedForRefundReturn();
      const detail = await returns.findById(returnRequestId);
      const returnItemId = detail?.items[0]?.id;
      if (!returnItemId) throw new Error('expected a return item');

      // Simulate the side effect having already happened (the real
      // caller crashed between the ledger write and marking the
      // ReturnItem/settlement) by calling the real restock primitive
      // directly, bypassing beginRestock() entirely.
      await adjustments.receiveReturnedStock({
        productSkuId: asProductSkuId(productSkuId),
        warehouseId: asWarehouseId(mainWarehouseId),
        locationId: asWarehouseLocationId(mainLocationId),
        quantity: 1,
        returnRequestId,
        returnItemId,
      });
      const settlementRow = await settlements.findByReturnRequestId(returnRequestId);
      expect(settlementRow?.status).toBe('PENDING_RESTOCK'); // still not marked

      const before = await prisma.inventoryItem.findFirstOrThrow({
        where: { productSkuId, warehouseId: mainWarehouseId, locationId: mainLocationId },
      });
      const result = await settlementService.beginRestock(returnRequestId, null);
      expect(result.status).toBe('RESTOCKED');

      // The retry must not have moved inventory a second time.
      const after = await prisma.inventoryItem.findFirstOrThrow({ where: { id: before.id } });
      expect(after.onHandQuantity).toBe(before.onHandQuantity);
      const ledgerRows = await prisma.inventoryLedger.count({
        where: { idempotencyKey: `return-restock__${returnItemId}` },
      });
      expect(ledgerRows).toBe(1);
      const item = await returns.findById(returnRequestId);
      expect(item?.items[0]?.restockedAt).not.toBeNull();
    });
  });

  describe('7. Reconciliation is idempotent under repeated runs', () => {
    it('running reconcileAll() 20 times in a row never creates duplicate side effects', async () => {
      const { returnRequestId } = await buildApprovedForRefundReturn(1, 'REFUND');
      // Left at PENDING_RESTOCK deliberately — reconciliation itself
      // must drive it forward exactly once, no matter how many times
      // the sweep runs.
      const refundCountBefore = await prisma.refund.count({
        where: { idempotencyKey: `return-refund__${returnRequestId}` },
      });
      expect(refundCountBefore).toBe(0);

      for (let i = 0; i < 20; i += 1) {
        await reconciliationService.reconcileAll(null);
      }

      const settlementRow = await settlements.findByReturnRequestId(returnRequestId);
      // Reconciliation only ever re-drives PENDING_RESTOCK -> RESTOCKED
      // (never RESTOCKED -> REFUND_REQUESTED — that is a real admin
      // action, ADR-013's own two-click design) — so 20 runs converge
      // to RESTOCKED exactly, not further, and never regress.
      expect(settlementRow?.status).toBe('RESTOCKED');

      const ledgerRowsForReturn = await prisma.inventoryLedger.count({
        where: { referenceType: 'ReturnRequest', referenceId: returnRequestId },
      });
      expect(ledgerRowsForReturn).toBe(1);
    });
  });

  describe('8. Illegal settlement transition surfaces a real conflict, never a silent failure', () => {
    it('requesting settlement before restock has completed throws InvalidReturnSettlementTransitionError, not a recorded failure', async () => {
      const { returnRequestId } = await buildApprovedForRefundReturn();
      const before = await settlements.findByReturnRequestId(returnRequestId);
      expect(before?.status).toBe('PENDING_RESTOCK');

      await expect(settlementService.requestSettlement(returnRequestId, null)).rejects.toThrow(
        InvalidReturnSettlementTransitionError,
      );

      // A premature call is a real domain conflict, never a recorded
      // settlement "failure" — attempts/lastError must stay untouched
      // (ADR-013's own "pre-flight check outside the try/catch" design).
      const after = await settlements.findByReturnRequestId(returnRequestId);
      expect(after?.status).toBe('PENDING_RESTOCK');
      expect(after?.attempts).toBe(0);
      expect(after?.lastError).toBeNull();
    });
  });

  describe('9. Terminal failure never retries forever', () => {
    it('a settlement escalated to MANUAL_REVIEW/FAILED_TERMINAL rejects a further retry() with a real conflict', async () => {
      const { returnRequestId } = await buildApprovedForRefundReturn();
      await settlementService.beginRestock(returnRequestId, null);
      const settlementRow = await settlements.findByReturnRequestId(returnRequestId);
      if (!settlementRow) throw new Error('expected a settlement row');

      // Force FAILED_TERMINAL directly at the repository layer — the
      // exact end state `recordFailure()` reaches for a genuine
      // domain-invariant violation (ADR-013 decision 10), without
      // needing to fabricate one end to end here.
      await settlements.updateStatus(settlementRow.id, 'FAILED_TERMINAL', {
        lastError: 'e2e: simulated terminal domain-invariant violation',
      });

      await expect(settlementService.retry(returnRequestId, adminUserId)).rejects.toThrow(
        InvalidReturnSettlementTransitionError,
      );

      // Retried any number of times, the outcome never changes — no
      // silent retry-forever loop.
      await expect(settlementService.retry(returnRequestId, adminUserId)).rejects.toThrow(
        InvalidReturnSettlementTransitionError,
      );
      const after = await settlements.findByReturnRequestId(returnRequestId);
      expect(after?.status).toBe('FAILED_TERMINAL');
    });
  });

  describe('10. A retryable failure eventually succeeds without duplicating anything', () => {
    it('a settlement with prior recorded (retryable) attempts still converges to exactly one restock on the next real call', async () => {
      const { returnRequestId, productSkuId } = await buildApprovedForRefundReturn();
      const settlementRow = await settlements.findByReturnRequestId(returnRequestId);
      if (!settlementRow) throw new Error('expected a settlement row');

      // Simulate three prior transient failures (a DB blip, a momentary
      // Redis outage — the recovery sweep's own per-row catch already
      // records these in place, never touching status) before the real
      // retry that finally succeeds.
      await settlements.recordAttemptFailure(settlementRow.id, 'e2e: simulated transient error 1');
      await settlements.recordAttemptFailure(settlementRow.id, 'e2e: simulated transient error 2');
      await settlements.recordAttemptFailure(settlementRow.id, 'e2e: simulated transient error 3');
      const stillPending = await settlements.findByReturnRequestId(returnRequestId);
      expect(stillPending?.status).toBe('PENDING_RESTOCK');
      expect(stillPending?.attempts).toBe(3);

      const result = await settlementService.retry(returnRequestId, adminUserId);
      expect(result.status).toBe('RESTOCKED');

      const ledgerRows = await prisma.inventoryLedger.count({
        where: { idempotencyKey: { startsWith: 'return-restock__' }, productSkuId },
      });
      expect(ledgerRows).toBe(1);
    });
  });
});
