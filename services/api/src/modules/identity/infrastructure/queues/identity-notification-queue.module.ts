import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../../config/env';
import { OTP_NOTIFICATION_PORT } from '../../domain/ports/otp-notification.port';
import { BullmqOtpNotificationAdapter } from '../notifications/bullmq-otp-notification.adapter';

import { NOTIFICATIONS_QUEUE } from './queue-names';

/**
 * CP-017 — registers this service as a producer onto the `notifications`
 * queue `services/notification-worker` consumes (see that queue's own
 * `queue-names.ts` doc comment for why this doesn't follow the usual
 * "queue owned by the module that registers it" convention — it's
 * cross-process). Same `BullModule.forRootAsync` + `registerQueue` shape
 * every other queue-owning module in this repo already establishes
 * (`OrderQueueModule`, `PaymentQueueModule`, ...).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  providers: [{ provide: OTP_NOTIFICATION_PORT, useClass: BullmqOtpNotificationAdapter }],
  exports: [OTP_NOTIFICATION_PORT],
})
export class IdentityNotificationQueueModule {}
