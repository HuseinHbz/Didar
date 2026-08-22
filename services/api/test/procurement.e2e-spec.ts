import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

interface OtpRequestResponseBody {
  expiresAt: string;
  devOnlyCode: string | null;
}
interface LoginResponseBody {
  status: 'AUTHENTICATED' | 'TWO_FACTOR_REQUIRED';
  tokens?: { accessToken: string; refreshToken: string };
}

// Same justified single-use-generic pattern as inventory/catalog e2e specs.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * End-to-end coverage for the procurement module (Phase 021 — suppliers +
 * purchase orders) against a real Postgres + real Redis, seeded via
 * packages/database/prisma/seed.ts. Reuses the same seed users/tokens
 * `inventory.e2e-spec.ts` uses: `+9891200000{01,05,06}` are the seed's
 * admin / inventory_manager / warehouse_operator users.
 *
 * `inventory_manager` (and `admin`, which auto-inherits every inventory.*
 * permission) is the only role with `purchase_order.create`/`.approve` —
 * `warehouse_operator` only ever gets `purchase_order.receive` (the same
 * floor-level "receive the physical goods" boundary it already has for
 * `transfer.receive`). Every fixture this file creates (suppliers,
 * purchase orders) uses a randomized suffix per run — this database
 * persists between runs, the same lesson every other e2e suite in this
 * repo documents.
 */
describe('Procurement (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let adminToken: string;
  let managerToken: string;
  let operatorToken: string;
  let auditorToken: string;

  let aviatorSkuId: string;
  let mainWarehouseId: string;
  let mainLocationId: string;
  let secondLocationId: string;

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

  const createSupplier = async (): Promise<string> => {
    const res = await request(server)
      .post('/admin/inventory/suppliers')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ code: `E2E-SUP-${randomUUID().slice(0, 8)}`, name: 'E2E Test Supplier' })
      .expect(201);
    return body<{ id: string }>(res).id;
  };

  const createPo = async (
    supplierId: string,
    items: { productSkuId: string; orderedQuantity: number; unitCost: string }[],
  ): Promise<{ id: string; status: string; poNumber: string }> => {
    const res = await request(server)
      .post('/admin/inventory/purchase-orders')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ supplierId, warehouseId: mainWarehouseId, items })
      .expect(201);
    return body<{ id: string; status: string; poNumber: string }>(res);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    managerToken = await loginByPhone('+989120000005'); // inventory_manager — full inventory.*
    operatorToken = await loginByPhone('+989120000006'); // warehouse_operator — receive only
    auditorToken = await loginByPhone('+989120000008'); // inventory_auditor — read-only

    const skuRes = await request(server)
      .get('/admin/inventory/sku-code/RB-AVIATOR-001-GOLD-58')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    aviatorSkuId = body<{ id: string }>(skuRes).id;

    const warehousesRes = await request(server)
      .get('/admin/inventory/warehouses?limit=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const warehouses = body<{ items: { id: string; code: string }[] }>(warehousesRes).items;
    const central = warehouses.find((w) => w.code === 'WH-TEHRAN-01');
    if (!central) {
      throw new Error('expected seed warehouse WH-TEHRAN-01 to exist');
    }
    mainWarehouseId = central.id;

    const locRes = await request(server)
      .get(`/admin/inventory/warehouses/${mainWarehouseId}/locations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const locations = body<{ id: string; code: string }[]>(locRes);
    const main = locations.find((l) => l.code === 'MAIN');
    const recv = locations.find((l) => l.code === 'RECV');
    if (!main || !recv) {
      throw new Error('expected seed locations MAIN and RECV on WH-TEHRAN-01');
    }
    mainLocationId = main.id;
    secondLocationId = recv.id;
  });

  afterAll(async () => {
    await app.close();
  }, 15000);

  describe('Unauthorized access', () => {
    it('rejects a purchase-order request with no bearer token', async () => {
      await request(server).get('/admin/inventory/purchase-orders').expect(401);
    });

    it('rejects a supplier request with no bearer token', async () => {
      await request(server).get('/admin/inventory/suppliers').expect(401);
    });
  });

  describe('Supplier RBAC', () => {
    it('inventory_manager can create a supplier', async () => {
      const code = `E2E-SUP-${randomUUID().slice(0, 8)}`;
      const res = await request(server)
        .post('/admin/inventory/suppliers')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ code, name: 'RBAC Test Supplier' })
        .expect(201);
      expect(body<{ code: string; status: string }>(res).code).toBe(code);
      expect(body<{ status: string }>(res).status).toBe('ACTIVE');
    });

    it('warehouse_operator cannot create a supplier (never granted supplier.manage)', async () => {
      await request(server)
        .post('/admin/inventory/suppliers')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ code: `E2E-DENIED-${randomUUID().slice(0, 8)}`, name: 'Should Not Be Created' })
        .expect(403);
    });

    it('inventory_auditor cannot create a supplier (read-only role)', async () => {
      await request(server)
        .post('/admin/inventory/suppliers')
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({ code: `E2E-DENIED-${randomUUID().slice(0, 8)}`, name: 'Should Not Be Created' })
        .expect(403);
    });
  });

  describe('Purchase order RBAC', () => {
    let supplierId: string;

    beforeAll(async () => {
      supplierId = await createSupplier();
    });

    it('warehouse_operator cannot create a purchase order (never granted purchase_order.create)', async () => {
      await request(server)
        .post('/admin/inventory/purchase-orders')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          supplierId,
          warehouseId: mainWarehouseId,
          items: [{ productSkuId: aviatorSkuId, orderedQuantity: 1, unitCost: '1000000' }],
        })
        .expect(403);
    });

    it('warehouse_operator cannot approve a purchase order (never granted purchase_order.approve)', async () => {
      const po = await createPo(supplierId, [
        { productSkuId: aviatorSkuId, orderedQuantity: 1, unitCost: '1000000' },
      ]);
      await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/approve`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('inventory_auditor can list/read purchase orders (ledger.read) but not create one', async () => {
      await request(server)
        .get('/admin/inventory/purchase-orders')
        .set('Authorization', `Bearer ${auditorToken}`)
        .expect(200);
      await request(server)
        .post('/admin/inventory/purchase-orders')
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({
          supplierId,
          warehouseId: mainWarehouseId,
          items: [{ productSkuId: aviatorSkuId, orderedQuantity: 1, unitCost: '1000000' }],
        })
        .expect(403);
    });
  });

  describe('Purchase order line validation', () => {
    let supplierId: string;

    beforeAll(async () => {
      supplierId = await createSupplier();
    });

    it('rejects a duplicate SKU within one create request', async () => {
      await request(server)
        .post('/admin/inventory/purchase-orders')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          supplierId,
          warehouseId: mainWarehouseId,
          items: [
            { productSkuId: aviatorSkuId, orderedQuantity: 5, unitCost: '1000000' },
            { productSkuId: aviatorSkuId, orderedQuantity: 3, unitCost: '1000000' },
          ],
        })
        .expect(400);
    });

    it('rejects a non-positive ordered quantity', async () => {
      await request(server)
        .post('/admin/inventory/purchase-orders')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          supplierId,
          warehouseId: mainWarehouseId,
          items: [{ productSkuId: aviatorSkuId, orderedQuantity: 0, unitCost: '1000000' }],
        })
        .expect(400);
    });
  });

  describe('Full lifecycle: create -> approve -> receive -> RECEIVED', () => {
    it('walks a single-line order through every state exactly once', async () => {
      const supplierId = await createSupplier();
      const po = await createPo(supplierId, [
        { productSkuId: aviatorSkuId, orderedQuantity: 8, unitCost: '2500000' },
      ]);
      expect(po.status).toBe('SUBMITTED');
      expect(po.poNumber).toMatch(/^PO-/);

      const approveRes = await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/approve`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(201);
      expect(body<{ status: string }>(approveRes).status).toBe('APPROVED');

      const receiveRes = await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          items: [{ productSkuId: aviatorSkuId, receivedQuantity: 8, locationId: mainLocationId }],
        })
        .expect(201);
      const received = body<{
        status: string;
        items: { productSkuId: string; receivedQuantity: number; orderedQuantity: number }[];
      }>(receiveRes);
      expect(received.status).toBe('RECEIVED');
      expect(received.items[0]?.receivedQuantity).toBe(8);
      expect(received.items[0]?.orderedQuantity).toBe(8);
    });
  });

  describe('Partial receiving', () => {
    it('stays PARTIALLY_RECEIVED after a short delivery, then RECEIVED after the rest arrives', async () => {
      const supplierId = await createSupplier();
      const po = await createPo(supplierId, [
        { productSkuId: aviatorSkuId, orderedQuantity: 10, unitCost: '2500000' },
      ]);
      await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/approve`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(201);

      const partialRes = await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          items: [{ productSkuId: aviatorSkuId, receivedQuantity: 4, locationId: mainLocationId }],
        })
        .expect(201);
      expect(body<{ status: string }>(partialRes).status).toBe('PARTIALLY_RECEIVED');

      const finalRes = await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          items: [{ productSkuId: aviatorSkuId, receivedQuantity: 6, locationId: mainLocationId }],
        })
        .expect(201);
      const final = body<{
        status: string;
        items: { receivedQuantity: number; orderedQuantity: number }[];
      }>(finalRes);
      expect(final.status).toBe('RECEIVED');
      expect(final.items[0]?.receivedQuantity).toBe(10);
    });

    it('rejects receiving more than what is still outstanding', async () => {
      const supplierId = await createSupplier();
      const po = await createPo(supplierId, [
        { productSkuId: aviatorSkuId, orderedQuantity: 5, unitCost: '2500000' },
      ]);
      await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/approve`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(201);

      await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          items: [{ productSkuId: aviatorSkuId, receivedQuantity: 6, locationId: mainLocationId }],
        })
        .expect(400);
    });
  });

  describe('Cancellation', () => {
    it('cancels a SUBMITTED order (never approved)', async () => {
      const supplierId = await createSupplier();
      const po = await createPo(supplierId, [
        { productSkuId: aviatorSkuId, orderedQuantity: 2, unitCost: '2500000' },
      ]);
      const cancelRes = await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/cancel`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(201);
      expect(body<{ status: string }>(cancelRes).status).toBe('CANCELLED');
    });

    it('rejects receiving against a CANCELLED order', async () => {
      const supplierId = await createSupplier();
      const po = await createPo(supplierId, [
        { productSkuId: aviatorSkuId, orderedQuantity: 2, unitCost: '2500000' },
      ]);
      await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/cancel`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(201);

      await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          items: [{ productSkuId: aviatorSkuId, receivedQuantity: 1, locationId: mainLocationId }],
        })
        .expect(409);
    });

    it('rejects cancelling an already-RECEIVED order', async () => {
      const supplierId = await createSupplier();
      const po = await createPo(supplierId, [
        { productSkuId: aviatorSkuId, orderedQuantity: 1, unitCost: '2500000' },
      ]);
      await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/approve`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(201);
      await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          items: [{ productSkuId: aviatorSkuId, receivedQuantity: 1, locationId: mainLocationId }],
        })
        .expect(201);

      await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/cancel`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(409);
    });
  });

  describe('Idempotent receiving (mandatory)', () => {
    it('a retried receive() call with the same idempotency key does not double-credit stock', async () => {
      const supplierId = await createSupplier();
      const po = await createPo(supplierId, [
        { productSkuId: aviatorSkuId, orderedQuantity: 5, unitCost: '2500000' },
      ]);
      await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/approve`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(201);

      const idempotencyKey = `e2e-retry-${randomUUID()}`;
      const payload = {
        items: [{ productSkuId: aviatorSkuId, receivedQuantity: 5, locationId: secondLocationId }],
        idempotencyKey,
      };

      const first = await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(payload)
        .expect(201);
      expect(body<{ status: string }>(first).status).toBe('RECEIVED');

      // The retry reuses the exact same key — it must resolve to the
      // already-applied state, not throw and not double the quantity.
      const retry = await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(payload)
        .expect(201);
      const retried = body<{
        status: string;
        items: { receivedQuantity: number }[];
      }>(retry);
      expect(retried.status).toBe('RECEIVED');
      expect(retried.items[0]?.receivedQuantity).toBe(5);
    });
  });

  describe('Concurrency safety (mandatory)', () => {
    it('20 simultaneous retries of the same receive() call apply the receipt exactly once', async () => {
      const supplierId = await createSupplier();
      const po = await createPo(supplierId, [
        { productSkuId: aviatorSkuId, orderedQuantity: 7, unitCost: '2500000' },
      ]);
      await request(server)
        .post(`/admin/inventory/purchase-orders/${po.id}/approve`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(201);

      const idempotencyKey = `e2e-concurrent-${randomUUID()}`;
      const payload = {
        items: [{ productSkuId: aviatorSkuId, receivedQuantity: 7, locationId: secondLocationId }],
        idempotencyKey,
      };

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          request(server)
            .post(`/admin/inventory/purchase-orders/${po.id}/receive`)
            .set('Authorization', `Bearer ${operatorToken}`)
            .send(payload),
        ),
      );

      // Every settled response must be 201 (either the applying call or a
      // re-read of the state it produced) — never a 409/500 from a raw,
      // unhandled unique-constraint collision.
      expect(results.every((r) => r.status === 'fulfilled' && r.value.status === 201)).toBe(true);

      const finalRes = await request(server)
        .get(`/admin/inventory/purchase-orders/${po.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      const final = body<{
        status: string;
        items: { receivedQuantity: number; orderedQuantity: number }[];
      }>(finalRes);
      // The invariant that matters: exactly one receipt was applied, not
      // 20 — receivedQuantity equals the ordered quantity, not 20x it.
      expect(final.status).toBe('RECEIVED');
      expect(final.items[0]?.receivedQuantity).toBe(7);
    }, 30000);
  });
});
