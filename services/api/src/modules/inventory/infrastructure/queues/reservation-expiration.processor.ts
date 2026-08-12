import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { ReservationService } from '../../application/reservation.service';
import type { ReservationExpirationSchedulerPort } from '../../domain/ports/reservation-expiration-scheduler.port';

import { DEFAULT_JOB_OPTIONS, RESERVATION_EXPIRATION_QUEUE } from './queue-names';

export interface ReservationExpirationJobData {
  reservationId: string;
}

/** Producer — implements `ReservationExpirationSchedulerPort` so
 * `ReservationService` depends on that port, not this BullMQ-specific
 * class. `ReservationService`/`ReservationController` schedule a delayed
 * job here whenever a reservation is created with an `expiresAt`. Job id =
 * the reservation id, so re-scheduling the same reservation (e.g. a
 * retried request) is a no-op rather than a duplicate job (the brief's
 * "job idempotency"). */
@Injectable()
export class ReservationExpirationQueueService implements ReservationExpirationSchedulerPort {
  constructor(
    @InjectQueue(RESERVATION_EXPIRATION_QUEUE)
    private readonly queue: Queue<ReservationExpirationJobData>,
  ) {}

  async scheduleExpiration(reservationId: string, expiresAt: Date): Promise<void> {
    const delay = Math.max(expiresAt.getTime() - Date.now(), 0);
    await this.queue.add(
      'expire-reservation',
      { reservationId },
      { ...DEFAULT_JOB_OPTIONS, delay, jobId: reservationId },
    );
  }
}

/**
 * Consumer — expires a reservation asynchronously (the brief's own
 * "reservation expiration must be processed asynchronously," never a
 * synchronous request-time check alone). Idempotent: `ReservationService.
 * expire()` is a no-op if the reservation isn't `ACTIVE` anymore (already
 * released/converted/expired by something else in the meantime), so a
 * retried or duplicate job never double-releases stock.
 */
@Processor(RESERVATION_EXPIRATION_QUEUE)
export class ReservationExpirationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReservationExpirationProcessor.name);

  constructor(private readonly reservations: ReservationService) {
    super();
  }

  async process(job: Job<ReservationExpirationJobData>): Promise<{ status: string }> {
    const reservation = await this.reservations.expire(job.data.reservationId);
    this.logger.log(
      `inventory_reservation_expired reservationId=${reservation.id} status=${reservation.status}`,
    );
    return { status: reservation.status };
  }
}
