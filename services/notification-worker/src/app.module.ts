import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { loadEnv, type Env } from './config/env';
import { NotificationModule } from './notifications/notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: loadEnv }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        // See services/worker/src/app.module.ts for why getOrThrow<string>, not
        // `.get(key, { infer: true })`.
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    NotificationModule,
  ],
})
export class AppModule {}
