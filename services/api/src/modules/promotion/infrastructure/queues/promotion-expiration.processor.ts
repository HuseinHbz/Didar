import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import {
  COUPON_REPOSITORY,
  type CouponRepositoryPort,
} from '../../domain/ports/coupon.repository.port';
import {
  PROMOTION_REPOSITORY,
  type PromotionRepositoryPort,
} from '../../domain/ports/promotion.repository.port';

import {
  DEFAULT_JOB_OPTIONS,
  PROMOTION_EXPIRATION_QUEUE,
  PROMOTION_EXPIRATION_SWEEP_INTERVAL_MS,
} from './queue-names';

const SWEEP_JOB_NAME = 'sweep-promotion-expiration';
const SWEEP_SCHEDULER_ID = 'promotion-expiration-sweep';

/** Producer — schedules the recurring sweep. Same `upsertJobScheduler`
 * idempotent-by-design shape `CheckoutExpirationQueueService` already
 * established: a service restart never accumulates a second sweep. */
@Injectable()
export class PromotionExpirationQueueService implements OnModuleInit {
  constructor(@InjectQueue(PROMOTION_EXPIRATION_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: PROMOTION_EXPIRATION_SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: {}, opts: DEFAULT_JOB_OPTIONS },
    );
  }
}

/**
 * Consumer — ADR-010 decision 9. Flips every `Promotion`/`Coupon` past
 * its own `endsAt`/`expiresAt` from an active status to `EXPIRED`.
 * Admin-list/audit readability only — eligibility (`EligibilityEngine`)
 * already reads the live window on every resolution and never depends on
 * this sweep having run for correctness; a promotion is ineligible the
 * instant `now > endsAt` even if this job hasn't fired yet. Idempotent:
 * re-running against an already-`EXPIRED` row is a no-op update.
 */
@Processor(PROMOTION_EXPIRATION_QUEUE)
export class PromotionExpirationProcessor extends WorkerHost {
  private readonly logger = new Logger(PromotionExpirationProcessor.name);

  constructor(
    @Inject(PROMOTION_REPOSITORY) private readonly promotions: PromotionRepositoryPort,
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepositoryPort,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ expiredPromotions: number; expiredCoupons: number }> {
    const now = new Date();
    const duePromotions = await this.promotions.listExpiredNotMarked(now);
    for (const promotion of duePromotions) {
      await this.promotions.updateStatus(promotion.id, 'EXPIRED');
      this.logger.log(`promotion_expired promotionId=${promotion.id}`);
    }

    const dueCoupons = await this.coupons.listExpiredNotMarked(now);
    for (const coupon of dueCoupons) {
      await this.coupons.updateStatus(coupon.id, 'EXPIRED');
      this.logger.log(`coupon_expired couponId=${coupon.id}`);
    }

    return { expiredPromotions: duePromotions.length, expiredCoupons: dueCoupons.length };
  }
}
