/** The two BullMQ queues this phase requires, hosted in-process inside
 * `services/api` (same ADR-006 decision 8 / ADR-007 decision 3 precedent
 * `InventoryQueueModule`/`CartCheckoutQueueModule` established). */
export const PROMOTION_EXPIRATION_QUEUE = 'promotion_expiration';
export const COUPON_RESERVATION_CLEANUP_QUEUE = 'coupon_reservation_cleanup';

/** Same retry/cleanup policy every prior phase's own sweep jobs use. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: false,
};

/** ADR-010 decision 9 — both sweeps are admin-list/reliability backstops,
 * not correctness-critical (eligibility already reads the live window;
 * `readyForPayment()`'s own reservation is what's actually
 * concurrency-safe) — every 5 minutes is frequent enough. */
export const PROMOTION_EXPIRATION_SWEEP_INTERVAL_MS = 5 * 60_000;
export const COUPON_RESERVATION_CLEANUP_INTERVAL_MS = 5 * 60_000;

/** A `RESERVED` redemption older than this with no matching order is
 * treated as abandoned (the checkout that reserved it crashed, expired
 * without going through `CheckoutService.expire()`'s own release call,
 * or the process died between "reserve" and "redeem"/"release") and is
 * released back to the pool. */
export const STALE_RESERVATION_AGE_MS = 30 * 60_000;
