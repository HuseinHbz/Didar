import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { waitForRedis } from './bootstrap/wait-for-redis';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const env = loadEnv();

  // CP-016: fail fast, deterministically, before NestFactory.create() ever
  // runs — that call is what used to hang indefinitely when Redis was
  // unreachable (every domain module's BullModule.forRootAsync resolves
  // during it). See src/bootstrap/wait-for-redis.ts and
  // docs/architecture/redis-reliability.md.
  try {
    await waitForRedis(env.REDIS_URL);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    logger.error(message);
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.enableCors({
    origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
  });
  // CP-029 (P1-5): `/metrics` stays unprefixed — Prometheus scrape targets
  // (infrastructure/monitoring/prometheus.yml) expect the standard
  // unversioned path regardless of API versioning, and this repo has no
  // other consumer of an unprefixed route to conflict with.
  app.setGlobalPrefix('api/v1', { exclude: ['metrics'] });
  app.enableShutdownHooks();

  // Reject unknown/extra fields and coerce DTOs to their class types at the
  // boundary — "Validation fails, security first" (blueprint §100).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('IECP API')
    .setDescription('Iran Eyewear Commerce Platform — API gateway (blueprint §91/§92)')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/v1/docs', app, swaggerDocument);

  await app.listen(env.PORT);
  logger.log(`listening on :${env.PORT} (docs at /api/v1/docs)`);
}

void bootstrap();
