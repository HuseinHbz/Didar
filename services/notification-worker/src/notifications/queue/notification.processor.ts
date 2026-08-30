import type { NotificationChannel } from '@iecp/types';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { recordJobOutcome } from '../../observability/job-metrics';
import type { NotificationMessage, NotificationSendResult } from '../notification-channel.port';
import { NotificationDispatcherService } from '../notification-dispatcher.service';

export interface NotificationJobData {
  channel: NotificationChannel;
  message: NotificationMessage;
}

/**
 * Consumes the `notifications` queue. Nothing upstream (e.g. `services/api`'s
 * order module) ever calls an adapter directly or waits on a provider round-trip
 * — it commits its own transaction, then enqueues a job here (blueprint §39).
 */
@Processor('notifications')
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly dispatcher: NotificationDispatcherService) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<NotificationSendResult> {
    this.logger.log(`dispatching job ${job.id} on channel ${job.data.channel}`);
    return this.dispatcher.dispatch(job.data.channel, job.data.message);
  }

  // CP-029 (P1-5) — job-outcome metrics for the one real production queue
  // this worker runs.
  @OnWorkerEvent('completed')
  onCompleted(job: Job<NotificationJobData>): void {
    recordJobOutcome('notifications', 'completed', job);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<NotificationJobData> | undefined): void {
    if (job) recordJobOutcome('notifications', 'failed', job);
  }
}
