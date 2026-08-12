export const RESERVATION_EXPIRATION_SCHEDULER = Symbol('RESERVATION_EXPIRATION_SCHEDULER');

/** Schedules a reservation's asynchronous expiration (the brief's own
 * "reservation expiration must be processed asynchronously"). The
 * BullMQ-backed implementation delays the job to `expiresAt`; job id =
 * the reservation id, so re-scheduling the same reservation is a no-op. */
export interface ReservationExpirationSchedulerPort {
  scheduleExpiration(reservationId: string, expiresAt: Date): Promise<void>;
}
