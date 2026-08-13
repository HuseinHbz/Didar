import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { CheckoutService } from '../../application/checkout.service';
import {
  CHECKOUT_SESSION_REPOSITORY,
  type CheckoutSessionRepositoryPort,
} from '../../domain/ports/checkout-session.repository.port';

import {
  CHECKOUT_EXPIRATION_QUEUE,
  CHECKOUT_SWEEP_INTERVAL_MS,
  DEFAULT_JOB_OPTIONS,
} from './queue-names';

const SWEEP_JOB_NAME = 'sweep-checkout-expiration';
const SWEEP_SCHEDULER_ID = 'checkout-expiration-sweep';

/**
 * Producer — schedules the recurring sweep itself. `onModuleInit` calls
 * BullMQ v6's `upsertJobScheduler` (the `repeat`-on-`add()` API it
 * replaced) with a fixed `SWEEP_SCHEDULER_ID`; upserting the same
 * scheduler id is idempotent by design, so a service restart never
 * accumulates a second concurrent sweep.
 *
 * A recurring sweep (rather than one delayed job per checkout session,
 * the pattern `ReservationExpirationQueueService` uses) is the right
 * shape here: `CheckoutSessionRepositoryPort.listExpirable` is the actual
 * source of truth for "what's due," and a session's `expiresAt` can move
 * forward via `POST /checkout/:id/refresh` after a job might already be
 * scheduled — a sweep re-reads the current state every minute instead of
 * needing every `refresh()` call to also reschedule a per-session job.
 */
@Injectable()
export class CheckoutExpirationQueueService implements OnModuleInit {
  constructor(@InjectQueue(CHECKOUT_EXPIRATION_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: CHECKOUT_SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: {}, opts: DEFAULT_JOB_OPTIONS },
    );
  }
}

/**
 * Consumer — reads every non-terminal `CheckoutSession` whose `expiresAt`
 * has already passed and runs `CheckoutService.expire()` on each, which
 * releases every reservation the session holds (never reimplemented here)
 * before transitioning it to `EXPIRED`. Idempotent: a session already
 * moved to a terminal state by a concurrent `cancel()`/`ready-for-payment`
 * call is skipped by `expire()`'s own no-op check, so overlapping sweep
 * runs (or a retried job) never double-process the same session.
 */
@Processor(CHECKOUT_EXPIRATION_QUEUE)
export class CheckoutExpirationProcessor extends WorkerHost {
  private readonly logger = new Logger(CheckoutExpirationProcessor.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepositoryPort,
    private readonly checkout: CheckoutService,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ expiredCount: number }> {
    const due = await this.sessions.listExpirable(new Date());
    for (const session of due) {
      await this.checkout.expire(session.id);
      this.logger.log(`checkout_session_expired checkoutSessionId=${session.id}`);
    }
    return { expiredCount: due.length };
  }
}
