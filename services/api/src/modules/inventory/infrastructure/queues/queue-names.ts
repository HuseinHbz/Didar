/** The three BullMQ queues this phase requires, hosted in-process inside
 * `services/api` (ADR-006 decision 8) — not `services/worker`. */
export const RESERVATION_EXPIRATION_QUEUE = 'reservation_expiration';
export const LOW_STOCK_NOTIFICATION_QUEUE = 'low_stock_notification';
export const INVENTORY_EVENT_PROCESSING_QUEUE = 'inventory_event_processing';

/** Shared retry/cleanup policy — every queue in this module uses the same
 * defaults (the brief's "retry strategy" + "dead letter handling"
 * requirements): 3 attempts with exponential backoff, completed jobs
 * removed, failed jobs kept (BullMQ's failed set is the de facto dead
 * letter queue — inspectable via `queue.getFailed()`/Bull Board rather
 * than a separate DLQ this phase doesn't need). */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: false,
};
