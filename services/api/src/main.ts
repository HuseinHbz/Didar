import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const env = loadEnv();

  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1');
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
