import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { prisma } from '@iecp/database';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import * as otplib from 'otplib';
import request from 'supertest';

import { AppModule } from '../src/app.module';

interface OtpRequestResponseBody {
  expiresAt: string;
  devOnlyCode: string | null;
}
interface LoginResponseBody {
  status: 'AUTHENTICATED' | 'TWO_FACTOR_REQUIRED';
  tokens?: { accessToken: string; refreshToken: string };
  pendingToken?: string;
}
interface TwoFactorSetupResponseBody {
  provisioningUri: string;
  recoveryCodes: string[];
}

/** supertest's `response.body` is typed `any` — this project bans `any`
 * flowing anywhere unchecked (see packages/eslint-config/base.mjs), so
 * every response body gets cast through here instead of accessed loosely.
 * It's still just an assertion, not runtime validation — the DTOs on the
 * other end are the actual contract; this only satisfies the lint rule
 * honestly rather than suppressing it. `T` genuinely needs to be supplied
 * at each call site (`body<LoginResponseBody>(res)`), which is exactly the
 * pattern `no-unnecessary-type-parameters` doesn't have a case for. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * Security-focused e2e coverage for the identity module (Phase 004's
 * required tests: JWT validation, permission bypass, session expiration),
 * against a real Postgres — see docs/database/README.md and this repo's CI
 * for how that database gets migrated + seeded before this file runs.
 * `+9891200000{01,02,03}` are the seed's admin/customer/support_agent
 * users (packages/database/prisma/seed.ts) — logged into here via the real
 * OTP flow, not by fabricating a token, so these tests exercise the same
 * path a real client does.
 */
describe('Identity (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let jwtService: JwtService;

  const loginByPhone = async (
    phone: string,
  ): Promise<{ accessToken: string; refreshToken: string }> => {
    const requestRes = await request(server)
      .post('/auth/otp/request')
      .send({ phone, purpose: 'LOGIN' })
      .expect(200);
    const code = body<OtpRequestResponseBody>(requestRes).devOnlyCode;
    if (code === null) {
      throw new Error('devOnlyCode was null — is NODE_ENV=production in this test run?');
    }
    expect(code).toEqual(expect.stringMatching(/^\d{6}$/));

    const verifyRes = await request(server)
      .post('/auth/otp/verify')
      .send({ phone, purpose: 'LOGIN', code })
      .expect(200);

    const verified = body<LoginResponseBody>(verifyRes);
    expect(verified.status).toBe('AUTHENTICATED');
    if (!verified.tokens) {
      throw new Error('expected tokens on an AUTHENTICATED response');
    }
    return verified.tokens;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
    jwtService = moduleFixture.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('JWT validation', () => {
    it('rejects a request with no bearer token', async () => {
      await request(server).get('/me/sessions').expect(401);
    });

    it('rejects a malformed token', async () => {
      await request(server)
        .get('/me/sessions')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);
    });

    it('rejects a token signed with the wrong secret (tampered/forged)', async () => {
      const forged = new JwtService({ secret: 'a-different-secret-entirely' }).sign(
        { sub: randomUUID(), jti: randomUUID(), type: 'access' },
        { expiresIn: 900 },
      );
      await request(server)
        .get('/me/sessions')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });

    it('rejects an expired token', async () => {
      const expired = jwtService.sign(
        { sub: randomUUID(), jti: randomUUID(), type: 'access' },
        { expiresIn: -10 }, // already expired the instant it's issued
      );
      await request(server)
        .get('/me/sessions')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
    });

    it('rejects a two_factor_pending token used as a bearer access token', async () => {
      // Same signer, same secret, wrong `type` claim — proves the type
      // discriminator in JwtTokenService actually gates access, not just
      // the signature. See infrastructure/crypto/jwt-token.service.ts.
      const pendingTypeToken = jwtService.sign(
        { sub: randomUUID(), jti: randomUUID(), type: 'two_factor_pending' },
        { expiresIn: 900 },
      );
      await request(server)
        .get('/me/sessions')
        .set('Authorization', `Bearer ${pendingTypeToken}`)
        .expect(401);
    });

    it('accepts a validly issued token', async () => {
      const { accessToken } = await loginByPhone('+989120000002'); // seeded customer
      await request(server)
        .get('/me/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });
  });

  describe('Permission bypass', () => {
    it('blocks a user with no identity permissions from a module-gated route (403, not silently empty)', async () => {
      const { accessToken } = await loginByPhone('+989120000002'); // seeded customer — no identity role
      const res = await request(server).get('/roles').set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(403);
    });

    it('allows a user whose role grants the permission (direct grant)', async () => {
      const { accessToken } = await loginByPhone('+989120000001'); // seeded admin
      await request(server).get('/roles').set('Authorization', `Bearer ${accessToken}`).expect(200);
    });

    it('allows access via role INHERITANCE, not just a direct grant', async () => {
      // admin's parent is support_agent (seed.ts); support_agent directly
      // grants identity.users.view_contact. admin has no direct grant of
      // that permission — only inherits it. If this passes, inheritance is
      // real, not just each role's own RolePermission rows.
      const { accessToken } = await loginByPhone('+989120000001');
      const adminId = await userIdByPhone('+989120000001');

      const res = await request(server)
        .get(`/users/${adminId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('phone');
      expect(res.body).toHaveProperty('email');
    });

    it('a per-user DENY override blocks access even though the role grants it', async () => {
      // support_agent role grants identity.users.view_contact; the seeded
      // support user (+989120000003) has that role AND an explicit DENY
      // override on that exact permission (blueprint §53's exception
      // pattern). Effective access must be denied — deny wins.
      const { accessToken } = await loginByPhone('+989120000003');
      const someUserId = await userIdByPhone('+989120000002');

      const res = await request(server)
        .get(`/users/${someUserId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200); // field-level gate, not a route-level block
      expect(res.body).not.toHaveProperty('phone');
      expect(res.body).not.toHaveProperty('email');
    });

    it('field-permission-gated fields are hidden by default, present for a permitted caller', async () => {
      const customerId = await userIdByPhone('+989120000002');

      const { accessToken: noAccessToken } = await loginByPhone('+989120000002');
      const withoutPermission = await request(server)
        .get(`/users/${customerId}`)
        .set('Authorization', `Bearer ${noAccessToken}`)
        .expect(200);
      expect(withoutPermission.body).not.toHaveProperty('phone');
      expect(withoutPermission.body).toHaveProperty('id');

      // support_agent role (no override) — the seed's admin inherits this
      // grant, already proven above; reuse that token for the "has access" side.
      const { accessToken: withAccessToken } = await loginByPhone('+989120000001');
      const withPermission = await request(server)
        .get(`/users/${customerId}`)
        .set('Authorization', `Bearer ${withAccessToken}`)
        .expect(200);
      expect(withPermission.body).toHaveProperty('phone');
      expect(withPermission.body).toHaveProperty('email');
    });
  });

  describe('Session expiration', () => {
    it('an expired session cannot be used to refresh', async () => {
      const { refreshToken } = await loginByPhone('+989120000002');

      // Directly expire the session row this refresh token maps to —
      // simulates real-world clock passage without waiting out a real TTL.
      const hash = sha256Hex(refreshToken);
      const updated = await prisma.userSession.updateMany({
        where: { refreshTokenHash: hash },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(updated.count).toBe(1);

      await request(server).post('/auth/refresh').send({ refreshToken }).expect(401);
    });

    it('a revoked session cannot be used to refresh', async () => {
      const { refreshToken } = await loginByPhone('+989120000002');

      await request(server).post('/auth/logout').send({ refreshToken }).expect(204);
      await request(server).post('/auth/refresh').send({ refreshToken }).expect(401);
    });

    it('refresh rotation: a used refresh token cannot be reused', async () => {
      const { refreshToken } = await loginByPhone('+989120000002');

      const first = await request(server).post('/auth/refresh').send({ refreshToken }).expect(200);
      const rotated = body<LoginResponseBody>(first).tokens;
      if (!rotated) {
        throw new Error('expected tokens on a refresh response');
      }
      expect(rotated.refreshToken).not.toBe(refreshToken);

      // The original token was single-use — reusing it must fail even
      // though it hasn't "expired" by TTL, only been consumed.
      await request(server).post('/auth/refresh').send({ refreshToken }).expect(401);

      // The newly rotated token, however, is live.
      await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: rotated.refreshToken })
        .expect(200);
    });

    it('a valid, unexpired session refreshes normally', async () => {
      const { refreshToken } = await loginByPhone('+989120000002');
      const res = await request(server).post('/auth/refresh').send({ refreshToken }).expect(200);
      const tokens = body<LoginResponseBody>(res).tokens;
      expect(tokens?.accessToken).toEqual(expect.any(String));
    });
  });

  describe('Two-factor login flow', () => {
    // A fresh, randomized phone per run — not one of the seed's fixed
    // users (enabling 2FA here must not affect the plain-OTP-login
    // assertions above that reuse +989120000001/2/3 across the whole
    // file), and not a fixed constant either: this test enables 2FA as a
    // side effect with no matching teardown, and the database persists
    // across repeated local runs (unlike CI, which migrates+seeds fresh
    // every time) — a fixed phone would make a second local run of just
    // this file fail at its own first line, since `loginByPhone` would
    // find 2FA already on from the previous run.
    const phone = `+989${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;

    it('setup -> enable -> login pauses for 2FA -> a valid code completes it', async () => {
      const { accessToken } = await loginByPhone(phone);

      const setupRes = await request(server)
        .post('/auth/2fa/setup')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const setup = body<TwoFactorSetupResponseBody>(setupRes);
      const secret = new URL(setup.provisioningUri).searchParams.get('secret');
      if (secret === null) {
        throw new Error('provisioningUri had no secret param');
      }
      expect(setup.recoveryCodes).toHaveLength(8);

      const currentCode = async (): Promise<string> => otplib.generate({ secret });

      await request(server)
        .post('/auth/2fa/enable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: await currentCode() })
        .expect(204);

      // Logging in the same way as before now pauses for a second factor
      // instead of returning tokens directly.
      const requestRes = await request(server)
        .post('/auth/otp/request')
        .send({ phone, purpose: 'LOGIN' })
        .expect(200);
      const otpCode = body<OtpRequestResponseBody>(requestRes).devOnlyCode;
      const verifyRes = await request(server)
        .post('/auth/otp/verify')
        .send({ phone, purpose: 'LOGIN', code: otpCode })
        .expect(200);
      const paused = body<LoginResponseBody>(verifyRes);
      expect(paused.status).toBe('TWO_FACTOR_REQUIRED');
      expect(paused.pendingToken).toEqual(expect.any(String));
      expect(paused.tokens).toBeUndefined();

      // The pendingToken alone is not a valid bearer token (already proven
      // in "JWT validation" above) and a wrong code doesn't complete login.
      await request(server)
        .post('/auth/2fa/verify')
        .send({ pendingToken: paused.pendingToken, code: '000000' })
        .expect(401);

      const completedRes = await request(server)
        .post('/auth/2fa/verify')
        .send({ pendingToken: paused.pendingToken, code: await currentCode() })
        .expect(200);
      const completed = body<LoginResponseBody>(completedRes);
      expect(completed.status).toBe('AUTHENTICATED');
      expect(completed.tokens?.accessToken).toEqual(expect.any(String));
    });
  });
});

async function userIdByPhone(phone: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
  return user.id;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
