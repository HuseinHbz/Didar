import { Socket } from 'node:net';

import { Logger } from '@nestjs/common';

/**
 * CP-016 — bounded, explicit Redis reachability check run at process
 * startup, before `NestFactory.create()` ever runs. This service has
 * required a reachable Redis to boot since Phase 006 (every domain
 * module's own `BullModule.forRootAsync`) — see
 * docs/architecture/redis-reliability.md for the full account of why this
 * exists: without it, an unreachable Redis makes `NestFactory.create()`
 * hang indefinitely inside BullMQ's own module initialization, with no
 * timeout, no crash, and no external signal (empirically reproduced in
 * the Phase 014 audit — a live boot against a killed Redis produced an
 * unbroken `ECONNREFUSED` retry loop for 2+ minutes with no resolution).
 *
 * This check is intentionally independent of BullMQ's own connection —
 * it opens and closes its own short-lived raw socket purely to prove
 * reachability (same RESP `PING`/`PONG` technique as
 * `scripts/verify-redis.mjs`, duplicated rather than shared because a
 * repo-root script and a compiled service package can't cleanly import
 * from each other — matching this repo's existing per-service `env.ts`
 * duplication convention). BullMQ's own runtime retry behavior for an
 * already-established connection is untouched by this — a transient
 * Redis blip on a service that's been running for days should keep
 * retrying, not crash; this check only gates the very first connection,
 * at startup.
 */
const MAX_ATTEMPTS = 5;
const CONNECT_TIMEOUT_MS = 3000;

function pingOnce(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let response = '';

    const fail = (message: string): void => {
      socket.destroy();
      reject(new Error(message));
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('timeout', () => {
      fail(`connection to ${host}:${port} timed out after ${CONNECT_TIMEOUT_MS}ms`);
    });
    socket.once('error', (err: Error) => {
      fail(err.message);
    });

    socket.connect(port, host, () => {
      socket.write('PING\r\n');
    });

    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString();
      if (response.includes('+PONG')) {
        socket.end();
        resolve();
      }
    });
  });
}

/**
 * Single, un-retried Redis reachability probe — a real RESP `PING`, not a
 * report of whatever `waitForRedis()` last concluded at boot. Used by
 * `HealthController`'s `GET /api/v1/health/ready` (see
 * docs/architecture/redis-reliability.md's health/readiness split):
 * readiness is polled repeatedly by the orchestrator/load balancer, so the
 * retry loop belongs to the poller, not to a single check — unlike
 * `waitForRedis()` below, which owns its own bounded retries because it
 * runs exactly once, at startup, with nothing else polling it.
 */
export async function pingRedisOnce(redisUrl: string): Promise<void> {
  const url = new URL(redisUrl);
  const host = url.hostname || 'localhost';
  const port = Number(url.port) || 6379;
  await pingOnce(host, port);
}

/**
 * Resolves once Redis answers a real PING, or throws (never hangs)
 * after `MAX_ATTEMPTS` bounded, backed-off attempts. Callers are expected
 * to treat a thrown error as fatal — see `main.ts`, where this gates
 * `NestFactory.create()` and a failure here exits the process.
 */
export async function waitForRedis(redisUrl: string): Promise<void> {
  const logger = new Logger('WaitForRedis');
  const url = new URL(redisUrl);
  const host = url.hostname || 'localhost';
  const port = Number(url.port) || 6379;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await pingOnce(host, port);
      logger.log(`Redis reachable at ${host}:${port} (attempt ${attempt}/${MAX_ATTEMPTS})`);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      // No credential/URL-with-password ever appears in these log lines —
      // only the resolved host/port, never `url.toString()` or `redisUrl`
      // itself (which could carry auth in `redis://user:pass@host` form).
      logger.warn(
        `Redis unreachable at ${host}:${port} (attempt ${attempt}/${MAX_ATTEMPTS}): ${message}`,
      );
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(
          `Redis still unreachable at ${host}:${port} after ${MAX_ATTEMPTS} attempts — refusing to boot. ` +
            `This service has required Redis since Phase 006 (BullMQ queues); see docs/architecture/redis-reliability.md.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}
