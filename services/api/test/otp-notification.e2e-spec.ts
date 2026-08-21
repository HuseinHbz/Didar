import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
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

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * CP-017 — proves the real producer -> real Redis -> (would-be) real
 * consumer path with real infrastructure, never a mock: a raw `bullmq`
 * `Queue` instance, pointed at the same real Redis this test run's
 * `AppModule` boots against, directly inspects the `notifications` queue
 * `services/notification-worker` consumes in production. Delta-based
 * counting (not queue-clearing) so this stays safe to run alongside any
 * other e2e file, in any worker ordering.
 *
 * Requires a reachable REDIS_URL — same requirement CP-016's own
 * `redis-reliability.e2e-spec.ts` already established for this suite.
 */
describe('OTP notification dispatch (e2e) — real Redis, real cooldown', () => {
  let app: INestApplication;
  let server: Server;
  let queue: Queue;

  const jobCount = async (): Promise<number> => {
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'delayed');
    return Object.values(counts).reduce((sum, n) => sum + n, 0);
  };

  const requestOtp = async (phone: string): Promise<string | null> => {
    const res = await request(server)
      .post('/auth/otp/request')
      .send({ phone, purpose: 'LOGIN' })
      .expect(200);
    return body<OtpRequestResponseBody>(res).devOnlyCode;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;

    queue = new Queue('notifications', {
      connection: { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' },
    });
  });

  afterAll(async () => {
    await queue.close();
    await app.close();
  }, 20_000);

  it('enqueues exactly one real SMS-dispatch job for a fresh phone', async () => {
    const phone = `+989${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
    const before = await jobCount();

    await requestOtp(phone);

    const after = await jobCount();
    expect(after - before).toBe(1);
  });

  it('does NOT enqueue a second job for a rapid repeat request on the same (phone, purpose)', async () => {
    const phone = `+989${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;

    await requestOtp(phone);
    const afterFirst = await jobCount();

    await requestOtp(phone); // immediate repeat — still within the default cooldown
    const afterSecond = await jobCount();

    expect(afterSecond).toBe(afterFirst);
  });

  it('enqueues again once the prior code has been consumed via a real login', async () => {
    const phone = `+989${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;

    const firstCode = await requestOtp(phone);
    if (firstCode === null) throw new Error('devOnlyCode was null — is NODE_ENV=production?');
    const afterFirst = await jobCount();

    const verifyRes = await request(server)
      .post('/auth/otp/verify')
      .send({ phone, purpose: 'LOGIN', code: firstCode })
      .expect(200);
    expect(body<LoginResponseBody>(verifyRes).status).toBe('AUTHENTICATED');

    await requestOtp(phone); // the previous request is now consumed — no cooldown applies
    const afterSecond = await jobCount();

    expect(afterSecond - afterFirst).toBe(1);
  });

  it('still issues a fresh, verifiable code even when the SMS dispatch is skipped by the cooldown', async () => {
    const phone = `+989${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;

    await requestOtp(phone);
    const secondCode = await requestOtp(phone); // dispatch skipped, code still fresh
    if (secondCode === null) throw new Error('devOnlyCode was null — is NODE_ENV=production?');

    const verifyRes = await request(server)
      .post('/auth/otp/verify')
      .send({ phone, purpose: 'LOGIN', code: secondCode })
      .expect(200);
    expect(body<LoginResponseBody>(verifyRes).status).toBe('AUTHENTICATED');
  });
});
