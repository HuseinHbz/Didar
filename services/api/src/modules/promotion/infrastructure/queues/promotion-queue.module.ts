import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../../config/env';
import { COUPON_REPOSITORY } from '../../domain/ports/coupon.repository.port';
import { PROMOTION_REPOSITORY } from '../../domain/ports/promotion.repository.port';
import { PrismaCouponRepository } from '../repositories/prisma-coupon.repository';
import { PrismaPromotionRepository } from '../repositories/prisma-promotion.repository';

import {
  CouponReservationCleanupProcessor,
  CouponReservationCleanupQueueService,
} from './coupon-reservation-cleanup.processor';
import {
  PromotionExpirationProcessor,
  PromotionExpirationQueueService,
} from './promotion-expiration.processor';
import { COUPON_RESERVATION_CLEANUP_QUEUE, PROMOTION_EXPIRATION_QUEUE } from './queue-names';

/**
 * Registers BullMQ in-process inside `services/api` for this module's two
 * sweeps (ADR-010 decision 9) — same ADR-006 decision 8 precedent
 * `InventoryQueueModule`/`CartCheckoutQueueModule` established.
 *
 * `PromotionModule` imports this module, not the other way around, so
 * this module re-declares its own repository-port bindings as fresh
 * instances (rebound to the same stateless Prisma implementations) rather
 * than importing `PromotionModule` back — the same "separate instance for
 * the queue processors" precedent every prior phase's own queue module
 * doc comment explains.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue(
      { name: PROMOTION_EXPIRATION_QUEUE },
      { name: COUPON_RESERVATION_CLEANUP_QUEUE },
    ),
  ],
  providers: [
    { provide: PROMOTION_REPOSITORY, useClass: PrismaPromotionRepository },
    { provide: COUPON_REPOSITORY, useClass: PrismaCouponRepository },
    PromotionExpirationQueueService,
    PromotionExpirationProcessor,
    CouponReservationCleanupQueueService,
    CouponReservationCleanupProcessor,
  ],
})
export class PromotionQueueModule {}
