import type { Server } from 'node:http';

import { prisma } from '@iecp/database';
import type { INestApplication } from '@nestjs/common';
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
interface CreatedApiKeyResponseBody {
  id: string;
  rawKey: string;
}
interface ApiKeyResponseBody {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  isActive: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * CP-028 (P2-6) — real end-to-end coverage for API-key authentication:
 * issue a real key through the real `/me/api-keys` route, use it as a
 * real credential against a real permission-gated admin route, and
 * specifically try to break the one new security boundary this pass
 * introduces (a key narrower than its owner's real RBAC must never grant
 * more than its own scopes) — not just the happy path. Real Postgres,
 * same "seeded admin, real OTP login" convention `identity.e2e-spec.ts`
 * and `catalog.e2e-spec.ts` already established.
 */
describe('API key authentication (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let adminToken: string;

  const loginByPhone = async (
    phone: string,
  ): Promise<{ accessToken: string; refreshToken: string }> => {
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
    return verified.tokens;
  };

  const createApiKey = async (scopes: string[]): Promise<CreatedApiKeyResponseBody> => {
    const res = await request(server)
      .post('/me/api-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `e2e-key-${scopes.join('-') || 'unscoped'}-${Date.now()}`, scopes })
      .expect(201);
    return body<CreatedApiKeyResponseBody>(res);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;

    const tokens = await loginByPhone('+989120000001'); // seed admin — full catalog.* access
    adminToken = tokens.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unknown API key with 401', async () => {
    await request(server)
      .get('/me/api-keys')
      .set('X-API-Key', 'iecp_totally-unknown-key-value')
      .expect(401);
  });

  it('authenticates a real key on an unscoped ("authenticated only") route regardless of scopes', async () => {
    const { rawKey } = await createApiKey([]);

    await request(server).get('/me/api-keys').set('X-API-Key', rawKey).expect(200);
  });

  it('allows a scoped key through a permission-gated route when the scope matches', async () => {
    const { rawKey } = await createApiKey(['catalog.brands.create']);
    const suffix = Date.now().toString(36);

    await request(server)
      .post('/admin/catalog/brands')
      .set('X-API-Key', rawKey)
      .send({ name: `E2E API-key brand ${suffix}`, slug: `e2e-api-key-brand-${suffix}` })
      .expect(201);
  });

  it(
    'blocks a narrower-scoped key from a permission-gated route even though its owner has that ' +
      'permission via RBAC — the real adversarial case a leaked, narrowly-scoped key must survive',
    async () => {
      const { rawKey } = await createApiKey(['catalog.brands.read']); // deliberately not .create
      const suffix = Date.now().toString(36);

      await request(server)
        .post('/admin/catalog/brands')
        .set('X-API-Key', rawKey)
        .send({ name: `Should never be created ${suffix}`, slug: `should-not-exist-${suffix}` })
        .expect(403);
    },
  );

  it('blocks a key with no scopes at all from any permission-gated route', async () => {
    const { rawKey } = await createApiKey([]);
    const suffix = Date.now().toString(36);

    await request(server)
      .post('/admin/catalog/brands')
      .set('X-API-Key', rawKey)
      .send({ name: `Should never be created ${suffix}`, slug: `should-not-exist-${suffix}` })
      .expect(403);
  });

  it('rejects a revoked key with 401, and it stays rejected even for an unscoped route', async () => {
    const { id, rawKey } = await createApiKey(['catalog.brands.create']);

    await request(server)
      .delete(`/me/api-keys/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    await request(server).get('/me/api-keys').set('X-API-Key', rawKey).expect(401);
  });

  it('records lastUsedAt after a successful API-key request (real DB read, not just the response body)', async () => {
    const { id, rawKey } = await createApiKey([]);

    const before = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    expect(before.lastUsedAt).toBeNull();

    await request(server).get('/me/api-keys').set('X-API-Key', rawKey).expect(200);

    const after = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    expect(after.lastUsedAt).not.toBeNull();
  });

  it('never returns the raw key value from the list endpoint — only at creation, exactly once', async () => {
    await createApiKey(['catalog.brands.create']);

    const res = await request(server)
      .get('/me/api-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const keys = body<ApiKeyResponseBody[]>(res);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toHaveProperty('rawKey');
      expect(key).not.toHaveProperty('keyHash');
    }
  });

  it('prefers X-API-Key over a simultaneously-sent (even invalid) Bearer token', async () => {
    const { rawKey } = await createApiKey([]);

    await request(server)
      .get('/me/api-keys')
      .set('X-API-Key', rawKey)
      .set('Authorization', 'Bearer this-is-not-a-real-jwt')
      .expect(200);
  });
});
