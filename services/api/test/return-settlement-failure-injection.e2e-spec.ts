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
import { PrismaRefundRepository } from '../src/modules/payment/infrastructure/repositories/prisma-refund.repository';
import { CreditNoteService } from '../src/modules/return/application/credit-note.service';
import { ReturnReconciliationService } from '../src/modules/return/application/return-reconciliation.service';
import { ReturnSettlementService } from '../src/modules/return/application/return-settlement.service';
import { ReturnSettlementRecoveryProcessor } from '../src/modules/return/infrastructure/queues/return-settlement-recovery.processor';
import { PrismaReturnSettlementRepository } from '../src/modules/return/infrastructure/repositories/prisma-return-settlement.repository';
import { PrismaReturnRepository } from '../src/modules/return/infrastructure/repositories/prisma-return.repository';

import { FakePaymentProviderAdapterRegistry } from './support/fake-payment-provider-adapter';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * ADR-013 § Failure scenarios — the 5 named crash windows the brief
 * requires targeted tests for, each simulated by performing exactly the
 * side effect a real crash would have already committed and *stopping
 * there* (never calling the method that would normally continue),
 * then proving the real recovery path (a manual retry, the real
 * `ReturnSettlementRecoveryProcessor`, or `ReturnReconciliationService
 * .reconcileAll()`) converges to one correct final state with zero
 * duplicate financial or inventory side effects. Same setup shape
 * `return-settlement-repository.e2e-spec.ts` already established.
 */
describe('Return settlement failure injection — 5 named crash windows (ADR-013)', () => {
  let app: INestApplication;
  let server: Server;
  let adminToken: string;
  let mainWarehouseId: string;
  let mainLocationId: string;
  const returns = new PrismaReturnRepository();
  const settlements = new PrismaReturnSettlementRepository();
  const refunds = new PrismaRefundRepository();
  let settlementService: ReturnSettlementService;
  let reconciliationService: ReturnReconciliationService;
  let creditNoteService: CreditNoteService;
  let recoveryProcessor: ReturnSettlementRecoveryProcessor;
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
          name: `E2E Failure Injection Frame ${suffix}`,
          slug: `e2e-failure-injection-frame-${suffix}`,
          shortDescription: 'Created by the return-settlement-failure-injection e2e suite',
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
        .send({ productId, variantId, skuCode: `E2E-FAILURE-INJECTION-SKU-${suffix}` })
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
        reason: 'e2e failure-injection fixture: seed stock',
      })
      .expect(201);
    return skuId;
  };

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
        recipientName: 'E2E Failure Injection Tester',
        phone: '+989120000097',
        province: 'Tehran',
        city: 'Tehran',
        addressLine1: 'Test St, No. 5',
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
      .send({ carrier: 'Tipax', trackingNumber: `E2E-FAILURE-INJECTION-TRACK-${randomUUID()}` })
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

  /** Drives a fresh return to `APPROVED_FOR_REFUND` with a
   * `PENDING_RESTOCK` settlement row — the common starting point every
   * crash-window scenario below injects its own failure on top of. */
  const buildApprovedForRefundReturn = async (
    resolution: 'REFUND' | 'CREDIT_NOTE' = 'REFUND',
  ): Promise<{
    returnRequestId: string;
    orderId: string;
    productSkuId: string;
    returnItemId: string;
  }> => {
    const skuId = await createFreshSellableSku(50);
    const { orderId, orderItemId } = await driveOrderToDelivered(skuId, 1);
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
    return { returnRequestId: created.id, orderId, productSkuId: skuId, returnItemId };
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
    creditNoteService = app.get(CreditNoteService);
    recoveryProcessor = app.get(ReturnSettlementRecoveryProcessor);
    adjustments = app.get(AdjustmentService);

    adminToken = await loginByPhone('+989120000017');

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

  describe('Window A — after settlement DB commit, before the recovery sweep ever notices', () => {
    it('a settlement whose row exists but nothing has acted on it yet is picked up correctly by the real reconciliation engine', async () => {
      const { returnRequestId, productSkuId } = await buildApprovedForRefundReturn();
      const settlementRow = await settlements.findByReturnRequestId(returnRequestId);
      expect(settlementRow?.status).toBe('PENDING_RESTOCK');
      expect(settlementRow?.attempts).toBe(0);

      // No manual action at all — only the real reconciliation engine,
      // the same one the scheduled sweep runs, drives it forward.
      await reconciliationService.reconcileAll(null);

      const after = await settlements.findByReturnRequestId(returnRequestId);
      expect(after?.status).toBe('RESTOCKED');
      const ledgerRows = await prisma.inventoryLedger.count({
        where: { idempotencyKey: { startsWith: 'return-restock__' }, productSkuId },
      });
      expect(ledgerRows).toBe(1);
    });
  });

  describe('Window B — after enqueue, before the worker starts', () => {
    it('an untouched settlement is correctly converged by the real BullMQ worker process() method itself', async () => {
      const { returnRequestId, productSkuId } = await buildApprovedForRefundReturn();
      const before = await settlements.findByReturnRequestId(returnRequestId);
      expect(before?.status).toBe('PENDING_RESTOCK'); // "the worker hasn't started" — genuinely true here

      // Invoke the real processor class's process() method directly —
      // the same code the BullMQ scheduler calls on every sweep tick,
      // not a re-implementation of its logic in the test.
      const result = await recoveryProcessor.process({} as never);
      expect(result.scanned).toBeGreaterThanOrEqual(1);

      const after = await settlements.findByReturnRequestId(returnRequestId);
      expect(after?.status).toBe('RESTOCKED');
      const ledgerRows = await prisma.inventoryLedger.count({
        where: { idempotencyKey: { startsWith: 'return-restock__' }, productSkuId },
      });
      expect(ledgerRows).toBe(1);
    });
  });

  describe('Window C — after refund creation, before settlement state update', () => {
    it('a Refund already created but never recorded on the settlement is detected, not duplicated, and the settlement still completes', async () => {
      const { returnRequestId, orderId } = await buildApprovedForRefundReturn('REFUND');
      await settlementService.beginRestock(returnRequestId, null);
      const settlementRow = await settlements.findByReturnRequestId(returnRequestId);
      if (!settlementRow) throw new Error('expected a settlement row');
      // Real REFUND_REQUESTED transition, same as requestSettlement()'s
      // own first step, without ever creating the Refund.
      await settlements.updateStatus(settlementRow.id, 'REFUND_REQUESTED', {
        refundRequestedAt: new Date(),
      });

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      const transaction = await prisma.paymentTransaction.findFirstOrThrow({
        where: { paymentIntentId: order.paymentIntentId, status: 'VERIFIED' },
      });
      // Simulate the crash: the Refund exists (the real side effect
      // already happened, with the exact deterministic key
      // requestSettlement() itself would use), but refundRecordedAt and
      // the SETTLED transition never happened.
      await refunds.create({
        paymentTransactionId: transaction.id,
        amount: 5_450_000n,
        idempotencyKey: `return-refund__${returnRequestId}`,
        returnRequestId,
      });
      const stillRequested = await settlements.findByReturnRequestId(returnRequestId);
      expect(stillRequested?.status).toBe('REFUND_REQUESTED');
      expect(stillRequested?.refundRecordedAt).toBeNull();

      const orderBefore = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      const result = await settlementService.requestSettlement(returnRequestId, null);
      expect(result.status).toBe('SETTLED');

      const refundRows = await prisma.refund.count({
        where: { idempotencyKey: `return-refund__${returnRequestId}` },
      });
      expect(refundRows).toBe(1); // never duplicated

      const orderAfter = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(orderAfter.refundedTotal - orderBefore.refundedTotal).toBe(5_450_000n); // recorded exactly once
    });
  });

  describe('Window D — after restock transaction commits, before settlement marked RESTOCKED', () => {
    it('a physical restock that already happened is detected, not repeated, and the settlement still advances', async () => {
      const { returnRequestId, productSkuId, returnItemId } = await buildApprovedForRefundReturn();

      // The exact real primitive beginRestock() itself would call —
      // simulating the crash landing right after this commits.
      await adjustments.receiveReturnedStock({
        productSkuId: asProductSkuId(productSkuId),
        warehouseId: asWarehouseId(mainWarehouseId),
        locationId: asWarehouseLocationId(mainLocationId),
        quantity: 1,
        returnRequestId,
        returnItemId,
      });
      const stillPending = await settlements.findByReturnRequestId(returnRequestId);
      expect(stillPending?.status).toBe('PENDING_RESTOCK'); // never marked

      const before = await prisma.inventoryItem.findFirstOrThrow({
        where: { productSkuId, warehouseId: mainWarehouseId, locationId: mainLocationId },
      });
      const result = await settlementService.beginRestock(returnRequestId, null);
      expect(result.status).toBe('RESTOCKED');

      const after = await prisma.inventoryItem.findFirstOrThrow({ where: { id: before.id } });
      expect(after.onHandQuantity).toBe(before.onHandQuantity); // not moved a second time
      const ledgerRows = await prisma.inventoryLedger.count({
        where: { idempotencyKey: `return-restock__${returnItemId}` },
      });
      expect(ledgerRows).toBe(1);
    });
  });

  describe('Window E — after credit-note creation, before settlement state update', () => {
    it('a DRAFT credit note that already exists is found, not duplicated, and issuance still completes', async () => {
      const { returnRequestId, orderId } = await buildApprovedForRefundReturn('CREDIT_NOTE');

      // The exact real primitive ensureDraftCreditNote() would call —
      // simulating the crash landing right after the DRAFT commits,
      // before beginRestock() ever ran (so the settlement never even
      // reached PENDING_RESTOCK -> RESTOCKED).
      const invoice = await prisma.invoice.findFirst({ where: { orderId } });
      await creditNoteService.createDraftForReturn({
        orderId,
        returnRequestId,
        invoiceId: invoice?.id ?? null,
        subtotal: 5_450_000n,
        grandTotal: 5_450_000n,
        refundableAmount: 5_450_000n,
        lines: [
          {
            description: 'Return credit',
            quantity: 1,
            unitPrice: 5_450_000n,
            lineTotal: 5_450_000n,
          },
        ],
      });
      const draftsBefore = await prisma.creditNote.count({
        where: { returnRequestId, status: 'DRAFT' },
      });
      expect(draftsBefore).toBe(1);

      // beginRestock() must find this existing draft, not create a
      // second one, on its way to RESTOCKED.
      const restockResult = await settlementService.beginRestock(returnRequestId, null);
      expect(restockResult.status).toBe('RESTOCKED');
      const draftsAfterRestock = await prisma.creditNote.count({
        where: { returnRequestId, status: 'DRAFT' },
      });
      expect(draftsAfterRestock).toBe(1); // still exactly one, never duplicated

      const settleResult = await settlementService.requestSettlement(returnRequestId, null);
      expect(settleResult.status).toBe('SETTLED');
      const issuedRows = await prisma.creditNote.count({
        where: { returnRequestId, status: 'ISSUED' },
      });
      expect(issuedRows).toBe(1);
    });
  });
});
