import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

/**
 * A worker has no HTTP surface — it's a Nest application context that keeps
 * BullMQ processors alive, not an HTTP server. See services/api/src/main.ts for
 * the contrast.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  logger.log('worker started, processors listening');
}

void bootstrap();
