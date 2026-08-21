import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { waitForRedis } from './bootstrap/wait-for-redis';
import { loadEnv } from './config/env';

/**
 * A worker has no HTTP surface — it's a Nest application context that keeps
 * BullMQ processors alive, not an HTTP server. See services/api/src/main.ts for
 * the contrast.
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
  logger.log('worker started, processors listening');
}

void bootstrap();
