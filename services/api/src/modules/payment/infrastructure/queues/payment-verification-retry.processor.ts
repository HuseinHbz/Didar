import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { PaymentIntentService } from '../../application/payment-intent.service';

import {
  DEFAULT_JOB_OPTIONS,
  PAYMENT_VERIFICATION_RETRY_QUEUE,
  VERIFICATION_RETRY_MIN_AGE_MS,
  VERIFICATION_RETRY_SWEEP_INTERVAL_MS,
} from './queue-names';

const SWEEP_JOB_NAME = 'sweep-payment-verification-retry';
const SWEEP_SCHEDULER_ID = 'payment-verification-retry-sweep';

/** Producer — same `upsertJobScheduler` shape every sweep queue in this
 * repo uses (idempotent across restarts, never a duplicate concurrent
 * sweep). */
@Injectable()
export class PaymentVerificationRetryQueueService implements OnModuleInit {
  constructor(@InjectQueue(PAYMENT_VERIFICATION_RETRY_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: VERIFICATION_RETRY_SWEEP_INTERVAL_MS },
      { name: SWEEP_JOB_NAME, data: {}, opts: DEFAULT_JOB_OPTIONS },
    );
  }
}

/**
 * Consumer — two concerns, one sweep (see `queue-names.ts`'s own doc
 * comment for why): expires whatever `PaymentIntent.expiresAt` has
 * already passed via `PaymentIntentService.expireIntents()`, then
 * re-verifies every intent whose latest attempt was redirected more than
 * `VERIFICATION_RETRY_MIN_AGE_MS` ago and never returned — a real
 * `verifyPayment()` call, never inferred from anything (ADR-008 decision
 * 3), catching a callback ZarinPal never delivered or this service
 * missed. `verifyPayment()` is itself idempotent on an intent that has
 * since resolved by other means (a genuine callback arriving between
 * sweep runs), so an overlapping sweep or a retried job can't
 * double-process.
 */
@Processor(PAYMENT_VERIFICATION_RETRY_QUEUE)
export class PaymentVerificationRetryProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentVerificationRetryProcessor.name);

  constructor(private readonly payments: PaymentIntentService) {
    super();
  }

  async process(_job: Job): Promise<{ expiredCount: number; retriedCount: number }> {
    const now = new Date();
    const expiredCount = await this.payments.expireIntents(now);

    const cutoff = new Date(now.getTime() - VERIFICATION_RETRY_MIN_AGE_MS);
    const due = await this.payments.listAwaitingVerification(cutoff);
    for (const intent of due) {
      await this.payments.verifyPayment(intent.id).catch((error: unknown) => {
        this.logger.warn(
          `verification_retry_failed paymentIntentId=${intent.id} error=${String(error)}`,
        );
      });
    }
    this.logger.log(
      `payment_verification_retry_sweep expiredCount=${expiredCount} retriedCount=${due.length}`,
    );
    return { expiredCount, retriedCount: due.length };
  }
}
