import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { loadEnv, type Env } from './config/env';
import { ExampleQueueModule } from './queues/example/example-queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: loadEnv }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        // Explicit <string> generic + getOrThrow, not `.get(key, { infer: true })`
        // — the latter resolved to `any` here (ConfigService's inference from a
        // Zod-derived Env type doesn't always narrow), which is exactly the kind
        // of silent `any` leak the lint config exists to catch.
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    ExampleQueueModule,
  ],
})
export class AppModule {}
