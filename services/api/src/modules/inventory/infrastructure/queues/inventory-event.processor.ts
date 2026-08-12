import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import type {
  InventoryEventName,
  InventoryEventPublisherPort,
} from '../../domain/ports/inventory-event-publisher.port';

import { DEFAULT_JOB_OPTIONS, INVENTORY_EVENT_PROCESSING_QUEUE } from './queue-names';

export type { InventoryEventName };

export interface InventoryEventJobData {
  event: InventoryEventName;
  correlationId: string;
  payload: Record<string, unknown>;
}

/**
 * Producer — implements `InventoryEventPublisherPort` so the application
 * layer depends on that port, not this BullMQ-specific class. Every
 * application service that performs a mutation worth publishing calls
 * `publish()`. Deliberately does not become "a second source of truth"
 * (the brief's own rule): the job payload is metadata about a mutation
 * that already committed to PostgreSQL, never the only record of it —
 * every field here is also in `inventory_ledger` or the entity's own row.
 */
@Injectable()
export class InventoryEventsQueueService implements InventoryEventPublisherPort {
  constructor(
    @InjectQueue(INVENTORY_EVENT_PROCESSING_QUEUE)
    private readonly queue: Queue<InventoryEventJobData>,
  ) {}

  async publish(
    event: InventoryEventName,
    correlationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // Job id includes the event name + correlationId, so a retried publish
    // of the exact same mutation collapses to one job (job idempotency).
    // BullMQ rejects custom job ids containing ':', so join with '__'.
    await this.queue.add(
      event,
      { event, correlationId, payload },
      { ...DEFAULT_JOB_OPTIONS, jobId: `${event}__${correlationId}` },
    );
  }
}

/**
 * Consumer — logs every event with its correlation id (the brief's own
 * observability requirement: "every mutation should have correlation_id").
 * Idempotent by construction: it only logs, never mutates state, so
 * processing the same job twice (a retry after a transient failure) is
 * harmless. This is the seam a future real event consumer (search
 * indexing, analytics, webhook fan-out) would replace, not extend
 * in-place — see this module's README.
 */
@Processor(INVENTORY_EVENT_PROCESSING_QUEUE)
export class InventoryEventProcessor extends WorkerHost {
  private readonly logger = new Logger(InventoryEventProcessor.name);

  process(job: Job<InventoryEventJobData>): Promise<{ logged: true }> {
    this.logger.log(
      `${job.data.event} correlationId=${job.data.correlationId} payload=${JSON.stringify(job.data.payload)}`,
    );
    return Promise.resolve({ logged: true });
  }
}
