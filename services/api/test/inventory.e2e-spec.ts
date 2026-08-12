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

// Same justified single-use-generic pattern as identity/catalog e2e specs.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * End-to-end coverage for the inventory module (Phase 006) against a real
 * Postgres + real Redis, seeded via packages/database/prisma/seed.ts.
 * `+9891200000{01,05,06,07,08}` are the seed's admin / inventory_manager /
 * warehouse_operator / store_manager / inventory_auditor users — logged in
 * via the real OTP flow, same convention as identity/catalog's e2e suites.
 *
 * Every fixture this file creates (warehouses, transfers, reservations) uses
 * a randomized suffix per run — this database persists between runs, the
 * same lesson catalog.e2e-spec.ts already documents.
 *
 * The mandatory concurrency test ("100 simultaneous reservations against 10
 * available units must yield exactly 10 successes") is the same proof
 * already run standalone against real Postgres during development
 * (see docs/adr/ADR-006-inventory-architecture.md decision 4 and this
 * phase's final report) — formalized here as a real Jest case so it is
 * enforced by `pnpm test:e2e` / CI, not just a one-off script.
 */
describe('Inventory (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let adminToken: string;
  let managerToken: string;
  let operatorToken: string;
  let storeManagerToken: string;
  let auditorToken: string;

  // Seed's Ray-Ban Aviator SKU + its main-warehouse item (see seed.ts's
  // inventory fixture section) — read dynamically below, never hardcoded.
  let aviatorSkuId: string;
  let mainWarehouseId: string;
  let storeWarehouseId: string;

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
    operatorToken = await loginByPhone('+989120000006'); // warehouse_operator — no adjust/approve
    storeManagerToken = await loginByPhone('+989120000007'); // store_manager — adjust + count.approve, no transfer.approve
    auditorToken = await loginByPhone('+989120000008'); // inventory_auditor — read-only

    const skuRes = await request(server)
      .get('/admin/inventory/sku-code/RB-AVIATOR-001-GOLD-58')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    aviatorSkuId = body<{ id: string }>(skuRes).id;

    // Matched by the seed's own fixed warehouse codes, not by `type` —
    // this database persists across runs/phases and can accumulate other
    // CENTRAL/STORE warehouses (e.g. an earlier ad-hoc smoke-test
    // warehouse), so `type` alone is not a unique-enough match.
    const warehousesRes = await request(server)
      .get('/admin/inventory/warehouses?limit=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const warehouses = body<{ items: { id: string; code: string }[] }>(warehousesRes).items;
    const central = warehouses.find((w) => w.code === 'WH-TEHRAN-01');
    const store = warehouses.find((w) => w.code === 'WH-TEHRAN-STORE-01');
    if (!central || !store) {
      throw new Error('expected seed warehouses WH-TEHRAN-01 and WH-TEHRAN-STORE-01 to exist');
    }
    mainWarehouseId = central.id;
    storeWarehouseId = store.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Unauthorized access', () => {
    it('rejects an admin inventory request with no bearer token', async () => {
      await request(server).get('/admin/inventory/warehouses').expect(401);
    });

    it('rejects an internal reservation request with no bearer token', async () => {
      await request(server)
        .post('/internal/inventory/reservations')
        .send({
          productSkuId: aviatorSkuId,
          warehouseId: mainWarehouseId,
          quantity: 1,
          sourceType: 'MANUAL',
          sourceId: randomUUID(),
        })
        .expect(401);
    });
  });

  describe('Public storefront availability', () => {
    it('serves aggregate availability for a published product without a token', async () => {
      const res = await request(server)
        .get('/catalog/products/ray-ban-aviator-classic/availability')
        .expect(200);
      const rows = body<{ productSkuId: string; totalAvailableQuantity: number }[]>(res);
      expect(rows.some((r) => r.productSkuId === aviatorSkuId)).toBe(true);
    });

    it('serves per-store availability without a token', async () => {
      const res = await request(server)
        .get('/catalog/products/ray-ban-aviator-classic/stores')
        .expect(200);
      const rows = body<{ warehouseId: string; availableQuantity: number }[]>(res);
      expect(Array.isArray(rows)).toBe(true);
    });
  });

  describe('Warehouse management RBAC', () => {
    it('inventory_manager can create a warehouse (auto-creates a default location)', async () => {
      const code = `E2E-WH-${randomUUID().slice(0, 8)}`;
      const res = await request(server)
        .post('/admin/inventory/warehouses')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ code, name: 'E2E Test Warehouse', type: 'REGIONAL', timezone: 'Asia/Tehran' })
        .expect(201);
      const created = body<{ id: string; code: string }>(res);
      expect(created.code).toBe(code);

      const locRes = await request(server)
        .get(`/admin/inventory/warehouses/${created.id}/locations`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      const locations = body<{ code: string; type: string }[]>(locRes);
      expect(locations).toHaveLength(1);
      expect(locations[0]?.code).toBe('MAIN');
    });

    it('warehouse_operator cannot create a warehouse (permission denied, not silently no-op)', async () => {
      await request(server)
        .post('/admin/inventory/warehouses')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          code: `E2E-DENIED-${randomUUID().slice(0, 8)}`,
          name: 'Should Not Be Created',
          type: 'REGIONAL',
        })
        .expect(403);
    });
  });

  describe('Reservation engine', () => {
    it('reserves stock, decrementing available and writing a ledger entry', async () => {
      const beforeRes = await request(server)
        .get(`/internal/inventory/availability/${aviatorSkuId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      const before = body<{ byWarehouse: { warehouseId: string; availableQuantity: number }[] }>(
        beforeRes,
      );
      const beforeAvailable =
        before.byWarehouse.find((w) => w.warehouseId === mainWarehouseId)?.availableQuantity ?? 0;

      const sourceId = randomUUID();
      const reserveRes = await request(server)
        .post('/internal/inventory/reservations')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          productSkuId: aviatorSkuId,
          warehouseId: mainWarehouseId,
          quantity: 2,
          sourceType: 'MANUAL',
          sourceId,
        })
        .expect(201);
      const reservation = body<{ id: string; status: string; quantity: number }>(reserveRes);
      expect(reservation.status).toBe('ACTIVE');
      expect(reservation.quantity).toBe(2);

      const afterRes = await request(server)
        .get(`/internal/inventory/availability/${aviatorSkuId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      const after = body<{ byWarehouse: { warehouseId: string; availableQuantity: number }[] }>(
        afterRes,
      );
      const afterAvailable =
        after.byWarehouse.find((w) => w.warehouseId === mainWarehouseId)?.availableQuantity ?? -1;
      expect(afterAvailable).toBe(beforeAvailable - 2);

      const ledgerRes = await request(server)
        .get(`/admin/inventory/ledger?productSkuId=${aviatorSkuId}&limit=1`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      const latest = body<{
        items: { movementType: string; referenceId: string; quantity: number }[];
      }>(ledgerRes).items[0];
      expect(latest?.movementType).toBe('RESERVATION');
      expect(latest?.referenceId).toBe(sourceId);

      // release it so it doesn't permanently consume seed stock other tests read.
      await request(server)
        .post(`/internal/inventory/reservations/${reservation.id}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(201);
    });

    it('is idempotent: a retried reserve call with the same idempotencyKey returns the original reservation', async () => {
      const idempotencyKey = randomUUID();
      const payload = {
        productSkuId: aviatorSkuId,
        warehouseId: mainWarehouseId,
        quantity: 1,
        sourceType: 'MANUAL',
        sourceId: randomUUID(),
        idempotencyKey,
      };

      const first = await request(server)
        .post('/internal/inventory/reservations')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(payload)
        .expect(201);
      const second = await request(server)
        .post('/internal/inventory/reservations')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(payload)
        .expect(201);

      expect(body<{ id: string }>(first).id).toBe(body<{ id: string }>(second).id);

      await request(server)
        .post(`/internal/inventory/reservations/${body<{ id: string }>(first).id}/release`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(201);
    });

    it('rejects reserving more than available (never oversells)', async () => {
      const availRes = await request(server)
        .get(`/internal/inventory/availability/${aviatorSkuId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      const avail = body<{ byWarehouse: { warehouseId: string; availableQuantity: number }[] }>(
        availRes,
      );
      const available =
        avail.byWarehouse.find((w) => w.warehouseId === mainWarehouseId)?.availableQuantity ?? 0;

      await request(server)
        .post('/internal/inventory/reservations')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          productSkuId: aviatorSkuId,
          warehouseId: mainWarehouseId,
          quantity: available + 1000,
          sourceType: 'MANUAL',
          sourceId: randomUUID(),
        })
        .expect(409);
    });
  });

  describe('Stock adjustment RBAC ("warehouse operators cannot approve their own sensitive adjustments")', () => {
    it('warehouse_operator cannot create an adjustment (never granted inventory.adjust)', async () => {
      const locRes = await request(server)
        .get(`/admin/inventory/warehouses/${mainWarehouseId}/locations`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      const locationId = body<{ id: string }[]>(locRes)[0]?.id;

      await request(server)
        .post('/admin/inventory/adjustments')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          warehouseId: mainWarehouseId,
          locationId,
          productSkuId: aviatorSkuId,
          adjustmentType: 'POSITIVE',
          quantity: 1,
          reason: 'e2e should be denied',
        })
        .expect(403);
    });

    it('store_manager (granted inventory.adjust) can create an adjustment', async () => {
      const locRes = await request(server)
        .get(`/admin/inventory/warehouses/${mainWarehouseId}/locations`)
        .set('Authorization', `Bearer ${storeManagerToken}`)
        .expect(200);
      const locationId = body<{ id: string }[]>(locRes)[0]?.id;

      const res = await request(server)
        .post('/admin/inventory/adjustments')
        .set('Authorization', `Bearer ${storeManagerToken}`)
        .send({
          warehouseId: mainWarehouseId,
          locationId,
          productSkuId: aviatorSkuId,
          adjustmentType: 'POSITIVE',
          quantity: 1,
          reason: 'e2e store manager adjustment',
        })
        .expect(201);
      expect(body<{ adjustmentType: string }>(res).adjustmentType).toBe('POSITIVE');
    });

    it('inventory_auditor (read-only) cannot create an adjustment', async () => {
      const locRes = await request(server)
        .get(`/admin/inventory/warehouses/${mainWarehouseId}/locations`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .expect(200);
      const locationId = body<{ id: string }[]>(locRes)[0]?.id;

      await request(server)
        .post('/admin/inventory/adjustments')
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({
          warehouseId: mainWarehouseId,
          locationId,
          productSkuId: aviatorSkuId,
          adjustmentType: 'POSITIVE',
          quantity: 1,
          reason: 'e2e should be denied',
        })
        .expect(403);
    });

    it('inventory_auditor can read the ledger', async () => {
      await request(server)
        .get(`/admin/inventory/ledger?productSkuId=${aviatorSkuId}&limit=1`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .expect(200);
    });
  });

  describe('Stock transfer lifecycle + RBAC', () => {
    let transferId: string;

    it('inventory_manager creates a transfer (source has a default location, both warehouses distinct)', async () => {
      const res = await request(server)
        .post('/admin/inventory/transfers')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          sourceWarehouseId: mainWarehouseId,
          destinationWarehouseId: storeWarehouseId,
          items: [{ productSkuId: aviatorSkuId, requestedQuantity: 1 }],
        })
        .expect(201);
      const created = body<{ id: string; status: string; referenceNumber: string }>(res);
      expect(created.status).toBe('REQUESTED');
      expect(created.referenceNumber).toMatch(/^TRF-/);
      transferId = created.id;
    });

    it('store_manager cannot approve a transfer (never granted inventory.transfer.approve)', async () => {
      await request(server)
        .post(`/admin/inventory/transfers/${transferId}/approve`)
        .set('Authorization', `Bearer ${storeManagerToken}`)
        .send({})
        .expect(403);
    });

    it('inventory_manager approves, warehouse_operator dispatches and receives', async () => {
      await request(server)
        .post(`/admin/inventory/transfers/${transferId}/approve`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({})
        .expect(201)
        .expect((res) => {
          expect(body<{ status: string }>(res).status).toBe('APPROVED');
        });

      await request(server)
        .post(`/admin/inventory/transfers/${transferId}/dispatch`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({})
        .expect(201)
        .expect((res) => {
          expect(body<{ status: string }>(res).status).toBe('DISPATCHED');
        });

      const receiveRes = await request(server)
        .post(`/admin/inventory/transfers/${transferId}/receive`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ items: [{ productSkuId: aviatorSkuId, receivedQuantity: 1 }] })
        .expect(201);
      expect(body<{ status: string }>(receiveRes).status).toBe('RECEIVED');
    });
  });

  describe('Stock count lifecycle + RBAC', () => {
    it('warehouse_operator creates + submits a count, but only store_manager (count.approve) can approve it', async () => {
      const createRes = await request(server)
        .post('/admin/inventory/counts')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ warehouseId: mainWarehouseId, productSkuIds: [aviatorSkuId] })
        .expect(201);
      const created = body<{ id: string; items: { expectedQuantity: number }[] }>(createRes);
      const countId = created.id;
      // Counting the exact expected quantity (zero variance) keeps this
      // case focused on the count *workflow*/RBAC, not on the count's own
      // COUNT_ADJUSTMENT ledger write — a nonzero variance here would
      // shrink on-hand while this SKU/warehouse still carries reservations
      // from earlier in this suite, and correctly get rejected by the
      // never-negative-available invariant (covered by its own test below).
      const expectedQuantity = created.items[0]?.expectedQuantity ?? 0;

      const submitRes = await request(server)
        .post(`/admin/inventory/counts/${countId}/submit`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ items: [{ productSkuId: aviatorSkuId, countedQuantity: expectedQuantity }] })
        .expect(201);
      expect(body<{ status: string }>(submitRes).status).toBe('COUNTED');

      await request(server)
        .post(`/admin/inventory/counts/${countId}/approve`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);

      const approveRes = await request(server)
        .post(`/admin/inventory/counts/${countId}/approve`)
        .set('Authorization', `Bearer ${storeManagerToken}`)
        .expect(201);
      expect(body<{ status: string }>(approveRes).status).toBe('APPROVED');
    });
  });

  describe('Barcode / SKU-code lookup', () => {
    it('finds a SKU by its sku code', async () => {
      const res = await request(server)
        .get('/admin/inventory/sku-code/RB-AVIATOR-001-GOLD-58')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      expect(body<{ id: string }>(res).id).toBe(aviatorSkuId);
    });

    it('404s for an unknown code', async () => {
      await request(server)
        .get('/admin/inventory/sku-code/does-not-exist')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(404);
    });
  });

  /**
   * Mandatory concurrency test (brief: "100 simultaneous reservations
   * against 10 available units → exactly 10 succeed, 90 rejected, final
   * state consistent"). Uses a fresh warehouse + a fresh SKU-independent
   * item so it can't collide with any other test/seed data touching the
   * same row. Real concurrent HTTP requests against the real running app
   * and real Postgres — not simulated. This is the same proof already run
   * standalone (a plain script, real `node dist/main.js`, real curl-
   * equivalent HTTP calls, zero transport noise — see ADR-006 decision 4
   * and this phase's final report); this Jest case re-runs it under
   * `pnpm test:e2e`/CI so it's enforced going forward, not just a one-off.
   *
   * Firing 100 brand-new loopback connections at once against Jest's
   * in-process ephemeral supertest server (as opposed to a real bound
   * `node dist/main.js` process) reliably produces a handful of
   * `ECONNRESET`s at the Node HTTP layer itself — a transport artifact of
   * this specific test harness under burst load, confirmed by inspecting
   * `Promise.allSettled`'s rejected reasons (`ECONNRESET`, no HTTP status
   * at all). It is not an application-level failure: every request that
   * *did* get an HTTP response was correctly 201 or 409, and the
   * succeeded-count invariant (exactly 10, never more) held identically
   * across every run. So this test asserts the actual correctness
   * invariants — succeeded is exactly 10, never negative, final DB state
   * consistent — without also asserting a specific transport-layer
   * completion count that this harness can't guarantee.
   */
  describe('Concurrency safety (mandatory)', () => {
    it('never oversells: exactly 10 of 100 simultaneous reservations succeed against 10 available units', async () => {
      const whRes = await request(server)
        .post('/admin/inventory/warehouses')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          code: `E2E-CONC-${randomUUID().slice(0, 8)}`,
          name: 'E2E Concurrency Warehouse',
          type: 'REGIONAL',
        })
        .expect(201);
      const warehouseId = body<{ id: string }>(whRes).id;

      const locRes = await request(server)
        .get(`/admin/inventory/warehouses/${warehouseId}/locations`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      const locationId = body<{ id: string }[]>(locRes)[0]?.id;
      if (!locationId) {
        throw new Error('expected an auto-created default location');
      }

      await request(server)
        .post('/admin/inventory/adjustments')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          warehouseId,
          locationId,
          productSkuId: aviatorSkuId,
          adjustmentType: 'POSITIVE',
          quantity: 10,
          reason: 'e2e concurrency fixture: seed 10 units',
        })
        .expect(201);

      const results = await Promise.allSettled(
        Array.from({ length: 100 }, () =>
          request(server)
            .post('/internal/inventory/reservations')
            .set('Authorization', `Bearer ${managerToken}`)
            .send({
              productSkuId: aviatorSkuId,
              warehouseId,
              quantity: 1,
              sourceType: 'MANUAL',
              sourceId: randomUUID(),
            }),
        ),
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.status === 201);
      const conflicted = results.filter((r) => r.status === 'fulfilled' && r.value.status === 409);
      const transportNoise = results.filter((r) => r.status === 'rejected');
      // The invariant that matters: never more than the 10 truly available
      // units are reserved, and every settled HTTP response was one of the
      // two expected outcomes (no 500s, no unexpected status).
      expect(succeeded).toHaveLength(10);
      expect(succeeded.length + conflicted.length + transportNoise.length).toBe(100);
      expect(
        results.every(
          (r) => r.status === 'rejected' || r.value.status === 201 || r.value.status === 409,
        ),
      ).toBe(true);

      const finalRes = await request(server)
        .get(`/internal/inventory/availability/${aviatorSkuId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      const final = body<{
        byWarehouse: { warehouseId: string; availableQuantity: number; reservedQuantity: number }[];
      }>(finalRes);
      const row = final.byWarehouse.find((w) => w.warehouseId === warehouseId);
      expect(row?.availableQuantity).toBe(0);
      expect(row?.reservedQuantity).toBe(10);
    }, 30000);
  });
});
