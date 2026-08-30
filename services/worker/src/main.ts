import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { waitForRedis } from './bootstrap/wait-for-redis';
import { loadEnv } from './config/env';
import { startMetricsServer } from './observability/metrics.server';

/**
 * A worker has no HTTP surface for its actual job — it's a Nest application
 * context that keeps BullMQ processors alive, not an HTTP server (see
 * services/api/src/main.ts for the contrast). CP-029 (P1-5) adds one
 * narrow exception: a minimal `/metrics` listener (`observability/
 * metrics.server.ts`), not a general-purpose HTTP surface for this
 * service's own domain.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const env = loadEnv();

  // CP-016: fail fast, deterministically, before createApplicationContext()
  // ever runs — see src/bootstrap/wait-for-redis.ts and
  // docs/architecture/redis-reliability.md. This service has no HTTP
  // surface, so without this check a stuck boot would be entirely silent.
  try {
    await waitForRedis(env.REDIS_URL);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    logger.error(message);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();

  const metricsServer = startMetricsServer(env.METRICS_PORT);
  // The metrics server is a plain `node:http` listener, outside Nest's own
  // DI-managed lifecycle — `enableShutdownHooks()` above closes the Nest
  // application context (queues, Redis connections) on SIGTERM/SIGINT, but
  // has no reference to this server, whose open listening socket would
  // otherwise keep the process alive indefinitely after everything else has
  // shut down cleanly.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      metricsServer.close();
    });
  }

  logger.log('worker started, processors listening');
}

void bootstrap();
