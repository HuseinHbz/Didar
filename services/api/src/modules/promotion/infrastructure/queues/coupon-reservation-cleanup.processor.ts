import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import {
  COUPON_REPOSITORY,
  type CouponRepositoryPort,
} from '../../domain/ports/coupon.repository.port';

import {
  COUPON_RESERVATION_CLEANUP_INTERVAL_MS,
  COUPON_RESERVATION_CLEANUP_QUEUE,
  DEFAULT_JOB_OPTIONS,
  STALE_RESERVATION_AGE_MS,
} from './queue-names';

const SWEEP_JOB_NAME = 'sweep-coupon-reservation-cleanup';
const SWEEP_SCHEDULER_ID = 'coupon-reservation-cleanup-sweep';

/** Producer — same idempotent-by-design recurring-sweep shape every
 * prior phase's own queue producer uses. */
@Injectable()
export class CouponReservationCleanupQueueService implements OnModuleInit {
  constructor(@InjectQueue(COUPON_RESERVATION_CLEANUP_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: COUPON_RESERVATION_CLEANUP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: {}, opts: DEFAULT_JOB_OPTIONS },
    );
  }
}

/**
 * Consumer — ADR-010 decision 8/9's reliability backstop: a `RESERVED`
 * redemption whose checkout crashed (or expired without ever reaching
 * `CheckoutService.expire()`'s own explicit release) is otherwise stuck
 * holding capacity forever. Every `RESERVED` redemption older than
 * `STALE_RESERVATION_AGE_MS` is released via
 * `CouponRepositoryPort.release()` — the same row-locked, transactional
 * release path `CheckoutService.cancel()`/`expire()` already use, grouped
 * by `checkoutSessionId` so one crashed checkout's several stacked
 * promotions release together. Idempotent: releasing an
 * already-`RELEASED`/`REDEEMED` checkout's redemptions is a no-op
 * (`release()` only touches rows still `RESERVED`).
 */
@Processor(COUPON_RESERVATION_CLEANUP_QUEUE)
export class CouponReservationCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(CouponReservationCleanupProcessor.name);

  constructor(@Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepositoryPort) {
    super();
  }

  async process(_job: Job): Promise<{ releasedCheckouts: number }> {
    const olderThan = new Date(Date.now() - STALE_RESERVATION_AGE_MS);
    const stale = await this.coupons.listStaleReservations(olderThan);
    const checkoutSessionIds = [
      ...new Set(stale.map((redemption) => redemption.checkoutSessionId)),
    ];

    for (const checkoutSessionId of checkoutSessionIds) {
      await this.coupons.release(checkoutSessionId);
      this.logger.log(`coupon_reservation_released checkoutSessionId=${checkoutSessionId}`);
    }

    return { releasedCheckouts: checkoutSessionIds.length };
  }
}
