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

// Same justified single-use-generic pattern as identity.e2e-spec.ts's
// `body<T>()` — see that file's comment for why.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * End-to-end coverage for the catalog module (Phase 005) against a real
 * Postgres, seeded via packages/database/prisma/seed.ts. `+9891200000{01,04}`
 * are the seed's admin/catalog_editor users — logged into here via the real
 * OTP flow (same as identity.e2e-spec.ts), not by fabricating a token.
 *
 * Every fixture this file creates uses a randomized slug/name per run (a
 * random suffix on top of a fixed prefix) — this database persists between
 * test runs and between phases (it is not reset per CI run the way a
 * throwaway test database would be), so a hardcoded slug would collide with
 * whatever the previous run already created, the same lesson
 * identity.e2e-spec.ts already learned the hard way with its OTP phone
 * number (see that file's own comments / this repo's session history).
 *
 * Idempotent-seed verification (Phase 005 `testing.e2e` list) is not a Jest
 * case here — it was verified directly by running `pnpm --filter
 * @iecp/database seed` three times in a row against this same database and
 * inspecting row counts, the same way Phase 003/004's seed idempotency bugs
 * were actually found (see this phase's final report / commit history), not
 * by re-invoking a script from inside a test.
 */
describe('Catalog (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let adminToken: string;
  let editorToken: string;

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
    // Real ValidationPipe (matching src/main.ts's bootstrap exactly) — this
    // app instance is private to this file (a fresh one per *.e2e-spec.ts,
    // see identity.e2e-spec.ts's own beforeAll), so enabling it here can't
    // affect that suite's app instance.
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

    adminToken = await loginByPhone('+989120000001'); // seed admin — full catalog.* access
    editorToken = await loginByPhone('+989120000004'); // seed catalog_editor — no publish/delete/pricing
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Unauthorized admin access', () => {
    it('rejects an admin catalog request with no bearer token', async () => {
      await request(server).get('/admin/catalog/products').expect(401);
    });

    it('rejects an admin catalog write with no bearer token', async () => {
      await request(server)
        .post('/admin/catalog/brands')
        .send({ name: 'Should Not Be Created' })
        .expect(401);
    });
  });

  describe('Storefront (public, no auth)', () => {
    it('lists brands without a token', async () => {
      await request(server).get('/catalog/brands').expect(200);
    });

    it('never returns the seed’s DRAFT product', async () => {
      const res = await request(server).get('/catalog/products').expect(200);
      const products = body<{ items: { slug: string }[] }>(res).items;
      expect(products.some((p) => p.slug === 'ray-ban-wayfarer-classic')).toBe(false);
    });

    it('404s for the DRAFT product fetched directly by slug', async () => {
      await request(server).get('/catalog/products/ray-ban-wayfarer-classic').expect(404);
    });

    it('serves the seed’s PUBLISHED product with its full commerce aggregate', async () => {
      const res = await request(server)
        .get('/catalog/products/ray-ban-aviator-classic')
        .expect(200);
      const detail = body<{
        product: { status: string };
        brand: { slug: string } | null;
        variants: { sku: { skuCode: string } | null; price: { basePrice: string } | null }[];
      }>(res);
      expect(detail.product.status).toBe('PUBLISHED');
      expect(detail.brand?.slug).toBe('ray-ban');
      expect(detail.variants[0]?.sku?.skuCode).toBe('RB-AVIATOR-001-GOLD-58');
      expect(detail.variants[0]?.price?.basePrice).toBe('12500000');
    });
  });

  describe('Full product creation -> publish workflow (admin)', () => {
    const suffix = randomUUID().slice(0, 8);
    const productSlug = `e2e-test-frame-${suffix}`;
    let productId: string;
    let variantId: string;
    let skuId: string;
    let mediaId: string;
    let brandId: string;
    let categoryId: string;

    it('reads the seed brand/category to build against', async () => {
      const brandRes = await request(server).get('/catalog/brands/ray-ban').expect(200);
      brandId = body<{ id: string }>(brandRes).id;

      const categoryRes = await request(server).get('/catalog/categories/sunglasses').expect(200);
      categoryId = body<{ id: string }>(categoryRes).id;
    });

    it('creates a DRAFT product', async () => {
      const res = await request(server)
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productType: 'EYEGLASSES',
          brandId,
          categoryId,
          name: `E2E Test Frame ${suffix}`,
          slug: productSlug,
          shortDescription: 'Created by the catalog e2e suite',
        })
        .expect(201);
      const created = body<{ id: string; status: string; slug: string }>(res);
      expect(created.status).toBe('DRAFT');
      expect(created.slug).toBe(productSlug);
      productId = created.id;
    });

    it('edits the product', async () => {
      const res = await request(server)
        .patch(`/admin/catalog/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ shortDescription: 'Edited by the e2e suite' })
        .expect(200);
      expect(body<{ shortDescription: string }>(res).shortDescription).toBe(
        'Edited by the e2e suite',
      );
    });

    it('creates a variant', async () => {
      const res = await request(server)
        .post('/admin/catalog/variants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, color: 'Black', size: '52mm', isDefault: true })
        .expect(201);
      variantId = body<{ id: string }>(res).id;
    });

    it('creates a SKU for the variant', async () => {
      const res = await request(server)
        .post('/admin/catalog/skus')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, variantId, skuCode: `E2E-SKU-${suffix}` })
        .expect(201);
      const created = body<{ id: string; skuCode: string }>(res);
      expect(created.skuCode).toBe(`E2E-SKU-${suffix}`);
      skuId = created.id;
    });

    it('registers and attaches media', async () => {
      const registerRes = await request(server)
        .post('/admin/catalog/media')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          storageKey: `e2e/${suffix}/primary.jpg`,
          url: `https://cdn.example.com/e2e/${suffix}/primary.jpg`,
          kind: 'IMAGE',
          mimeType: 'image/jpeg',
        })
        .expect(201);
      mediaId = body<{ id: string }>(registerRes).id;

      await request(server)
        .post(`/admin/catalog/products/${productId}/media`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ mediaId, role: 'PRIMARY' })
        .expect(201);

      const listRes = await request(server)
        .get(`/admin/catalog/products/${productId}/media`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<{ mediaId: string }[]>(listRes)).toHaveLength(1);
    });

    it('sets a price', async () => {
      const res = await request(server)
        .put(`/admin/catalog/skus/${skuId}/price`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ basePrice: '9990000', compareAtPrice: '12000000' })
        .expect(200);
      const price = body<{ basePrice: string; compareAtPrice: string | null }>(res);
      expect(price.basePrice).toBe('9990000');
      expect(price.compareAtPrice).toBe('12000000');
    });

    it('submits for review, then approves', async () => {
      await request(server)
        .post(`/admin/catalog/products/${productId}/submit-for-review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201)
        .expect((res) => {
          expect(body<{ status: string }>(res).status).toBe('IN_REVIEW');
        });

      await request(server)
        .post(`/admin/catalog/products/${productId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201)
        .expect((res) => {
          expect(body<{ status: string }>(res).status).toBe('APPROVED');
        });
    });

    it('rejects publishing straight from DRAFT for a different product (illegal transition)', async () => {
      const draftRes = await request(server)
        .post('/admin/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productType: 'EYEGLASSES',
          brandId,
          categoryId,
          name: `E2E Illegal Transition ${suffix}`,
          slug: `e2e-illegal-${suffix}`,
        })
        .expect(201);
      const draftId = body<{ id: string }>(draftRes).id;

      await request(server)
        .post(`/admin/catalog/products/${draftId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('a catalog_editor cannot publish (permission denied, not silently no-op)', async () => {
      await request(server)
        .post(`/admin/catalog/products/${productId}/publish`)
        .set('Authorization', `Bearer ${editorToken}`)
        .expect(403);
    });

    it('publishes the product as admin', async () => {
      const res = await request(server)
        .post(`/admin/catalog/products/${productId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect(body<{ status: string; publishedAt: string | null }>(res).status).toBe('PUBLISHED');
    });

    it('is now visible on the storefront with its price', async () => {
      const res = await request(server).get(`/catalog/products/${productSlug}`).expect(200);
      const detail = body<{
        product: { status: string };
        variants: { price: { basePrice: string } | null }[];
      }>(res);
      expect(detail.product.status).toBe('PUBLISHED');
      expect(detail.variants[0]?.price?.basePrice).toBe('9990000');
    });

    it('a catalog_editor cannot delete/archive it either, but admin can archive it', async () => {
      await request(server)
        .post(`/admin/catalog/products/${productId}/archive`)
        .set('Authorization', `Bearer ${editorToken}`)
        .expect(403);

      const res = await request(server)
        .post(`/admin/catalog/products/${productId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect(body<{ status: string }>(res).status).toBe('ARCHIVED');
    });

    it('is no longer visible on the storefront once archived', async () => {
      await request(server).get(`/catalog/products/${productSlug}`).expect(404);
    });
  });

  describe('Bulk operations', () => {
    it('bulk-publishes multiple products and reports per-item results', async () => {
      const suffix = randomUUID().slice(0, 8);
      const brandRes = await request(server).get('/catalog/brands/ray-ban').expect(200);
      const brandId = body<{ id: string }>(brandRes).id;
      const categoryRes = await request(server).get('/catalog/categories/sunglasses').expect(200);
      const categoryId = body<{ id: string }>(categoryRes).id;

      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const res = await request(server)
          .post('/admin/catalog/products')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            productType: 'EYEGLASSES',
            brandId,
            categoryId,
            name: `E2E Bulk ${suffix}-${i}`,
            slug: `e2e-bulk-${suffix}-${i}`,
          })
          .expect(201);
        ids.push(body<{ id: string }>(res).id);
      }

      // One of the two is still DRAFT (never submitted/approved) — bulk
      // publish must report it as a per-item failure, not abort the batch.
      const bulkRes = await request(server)
        .post('/admin/catalog/products/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'publish', ids })
        .expect(201);
      const result = body<{ succeeded: string[]; failed: { id: string; reason: string }[] }>(
        bulkRes,
      );
      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(2);
    });
  });
});
