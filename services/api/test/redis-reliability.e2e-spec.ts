import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

interface HealthIndicatorDetail {
  status: string;
  message?: string;
}

interface HealthCheckResponseBody {
  status: 'ok' | 'error' | 'shutting_down';
  info?: Record<string, HealthIndicatorDetail>;
  error?: Record<string, HealthIndicatorDetail>;
  details: Record<string, HealthIndicatorDetail>;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function body<T>(res: request.Response): T {
  return res.body as T;
}

function setRedisUrl(url: string): void {
  process.env['REDIS_URL'] = url;
}

function getRedisUrl(): string | undefined {
  return process.env['REDIS_URL'];
}

function detail(record: Record<string, HealthIndicatorDetail> | undefined, key: string): HealthIndicatorDetail {
  const found = record?.[key];
  if (found === undefined) throw new Error(`expected a "${key}" health indicator in the response`);
  return found;
}

/**
 * CP-016 — proves the liveness/readiness split (see
 * docs/architecture/redis-reliability.md) with real network behavior, not
 * a mocked Redis client ("no fake Redis mocks for infrastructure
 * reliability proofs"). The "Redis down" cases here point `REDIS_URL` at
 * a real closed TCP port on localhost — an address nothing is listening
 * on — so `pingRedisOnce()` makes a genuine outbound connection attempt
 * and gets a genuine `ECONNREFUSED`, exactly what a real unreachable
 * Redis produces over the wire. The "Redis up" cases use the real
 * `REDIS_URL` this test run was booted against (CI's `redis:7.4-alpine`
 * service container, or a local dev `redis-server` — see README "Running
 * tests").
 *
 * `HealthController` re-reads `loadEnv()` fresh on every request rather
 * than caching it at boot, which is what makes swapping
 * `process.env.REDIS_URL` around each request here a valid way to drive
 * both branches without tearing the whole Nest app (and its already-
 * established, unrelated BullMQ connections) down and back up.
 *
 * Each failure/recovery pair runs twice, per CP-016's own stability_rule
 * ("failure-injection at least twice per critical mode").
 */
describe('Redis readiness (e2e) — real network failure/recovery', () => {
  let app: INestApplication;
  let server: Server;
  let realRedisUrl: string;

  const UNREACHABLE_REDIS_URL = 'redis://127.0.0.1:1';

  beforeAll(async () => {
    realRedisUrl = getRedisUrl() ?? 'redis://localhost:6379';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    setRedisUrl(realRedisUrl);
    await app.close();
  });

  afterEach(() => {
    setRedisUrl(realRedisUrl);
  });

  it('/health (GET) stays up regardless of Redis reachability — liveness is DB-only', async () => {
    setRedisUrl(UNREACHABLE_REDIS_URL);
    const response = await request(server).get('/health');
    const parsed = body<HealthCheckResponseBody>(response);

    expect(response.status).toBe(200);
    expect(parsed.details).not.toHaveProperty('redis');
  });

  it('/health/ready (GET) reports up when Redis is really reachable (round 1)', async () => {
    setRedisUrl(realRedisUrl);
    const response = await request(server).get('/health/ready');
    const parsed = body<HealthCheckResponseBody>(response);

    expect(response.status).toBe(200);
    expect(detail(parsed.info, 'redis').status).toBe('up');
  });

  it('/health/ready (GET) reports 503 with a real connection failure when Redis is unreachable (round 1)', async () => {
    setRedisUrl(UNREACHABLE_REDIS_URL);
    const response = await request(server).get('/health/ready');
    const parsed = body<HealthCheckResponseBody>(response);
    const redis = detail(parsed.error, 'redis');

    expect(response.status).toBe(503);
    expect(redis.status).toBe('down');
    expect(redis.message).toMatch(/ECONNREFUSED/);
    // No credential/URL leakage into the response body.
    expect(JSON.stringify(parsed)).not.toContain(realRedisUrl);
  });

  it('/health/ready (GET) recovers to up once Redis is reachable again (round 1)', async () => {
    setRedisUrl(realRedisUrl);
    const response = await request(server).get('/health/ready');
    const parsed = body<HealthCheckResponseBody>(response);

    expect(response.status).toBe(200);
    expect(detail(parsed.info, 'redis').status).toBe('up');
  });

  it('/health/ready (GET) fails deterministically a second time (round 2)', async () => {
    setRedisUrl(UNREACHABLE_REDIS_URL);
    const response = await request(server).get('/health/ready');

    expect(response.status).toBe(503);
  });

  it('/health/ready (GET) recovers a second time (round 2)', async () => {
    setRedisUrl(realRedisUrl);
    const response = await request(server).get('/health/ready');
    const parsed = body<HealthCheckResponseBody>(response);

    expect(response.status).toBe(200);
    expect(detail(parsed.info, 'redis').status).toBe('up');
  });

  it('/health/ready (GET) still reports the database independently while Redis is down', async () => {
    setRedisUrl(UNREACHABLE_REDIS_URL);
    const response = await request(server).get('/health/ready');
    const parsed = body<HealthCheckResponseBody>(response);

    // Postgres remains the sole source of truth — a Redis outage must
    // never be reported as a database problem, or vice versa.
    expect(detail(parsed.details, 'database').status).toBe('up');
    expect(detail(parsed.details, 'redis').status).toBe('down');
  });
});
