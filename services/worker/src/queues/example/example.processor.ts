import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { recordJobOutcome } from '../../observability/job-metrics';

export interface ExampleJobData {
  message: string;
}

/**
 * Template processor proving the BullMQ + Nest wiring (blueprint §62: Redis +
 * BullMQ for SMS/Telegram/WhatsApp/Email/image processing/PDF invoices/analytics/
 * search indexing). Not a real queue — replace once the first real background job
 * is designed (e.g. order-confirmation PDF generation).
 */
@Processor('example')
export class ExampleProcessor extends WorkerHost {
  private readonly logger = new Logger(ExampleProcessor.name);

  // Not `async` — this stub does no actual async work. A real processor doing
  // I/O (DB write, external API call, …) will naturally have an `await` and
  // should be declared `async` normally; keep the `Promise.resolve` wrapper
  // gone once it does.
  process(job: Job<ExampleJobData>): Promise<{ processedAt: string }> {
    this.logger.log(`processing job ${job.id}: ${job.data.message}`);
    return Promise.resolve({ processedAt: new Date().toISOString() });
  }

  // CP-029 (P1-5) — job-outcome metrics wired the same way for every real
  // processor going forward, proven here on the template so the first real
  // processor built from this one inherits observability, not just wiring.
  @OnWorkerEvent('completed')
  onCompleted(job: Job<ExampleJobData>): void {
    recordJobOutcome('example', 'completed', job);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ExampleJobData> | undefined): void {
    if (job) recordJobOutcome('example', 'failed', job);
  }
}
