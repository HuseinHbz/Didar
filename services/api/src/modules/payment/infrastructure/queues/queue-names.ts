/** The three BullMQ queues this phase requires, hosted in-process inside
 * `services/api` (same ADR-006 decision 8 / ADR-007 decision 3 precedent
 * `InventoryQueueModule`/`CartCheckoutQueueModule` established). */
export const PAYMENT_VERIFICATION_RETRY_QUEUE = 'payment_verification_retry';
export const RECONCILIATION_QUEUE = 'reconciliation';
export const REFUND_STATUS_SYNC_QUEUE = 'refund_status_sync';

/** Same retry/cleanup policy every other sweep queue in this repo uses. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: false,
};

/**
 * How often each sweep runs.
 *
 * `payment_verification_retry` covers two concerns in one sweep: expiring
 * whatever `PaymentIntent.expiresAt` has already passed, and re-running
 * `verifyPayment()` for an in-flight attempt whose callback may have been
 * lost (a dropped redirect, a network blip) — a real gap a pure "wait for
 * the callback" design would silently leave stuck in `AWAITING_PAYMENT`/
 * `PROCESSING` forever. Runs every minute, matching `checkout_expiration`'s
 * own cadence (`CheckoutSession`'s TTL is the shorter-lived neighbor this
 * queue's target directly depends on).
 *
 * `reconciliation` runs hourly over the last 24h of `VERIFIED`
 * transactions — frequent enough to catch a drift quickly, infrequent
 * enough that it's a background job, not a request-path cost.
 *
 * `refund_status_sync` catches a `Refund` stuck in `PENDING` (created but
 * never submitted to the provider — e.g. a crash between `requestRefund()`
 * and `processRefund()`) and drives it forward. Refunds are rare and
 * already synchronous end-to-end when nothing crashes, so a 5 minute
 * cadence is enough.
 */
export const VERIFICATION_RETRY_SWEEP_INTERVAL_MS = 60_000;
export const RECONCILIATION_SWEEP_INTERVAL_MS = 60 * 60_000;
export const REFUND_STATUS_SYNC_SWEEP_INTERVAL_MS = 5 * 60_000;

/** An attempt redirected less than this long ago is still plausibly "the
 * customer is on the gateway page right now" — the verification-retry
 * sweep only re-checks attempts older than this, so it never races a
 * customer who is genuinely mid-payment. */
export const VERIFICATION_RETRY_MIN_AGE_MS = 2 * 60_000;

/** A refund still `PENDING` after this long is stuck, not "about to be
 * processed" — the refund-status-sync sweep only picks up refunds older
 * than this. */
export const REFUND_STATUS_SYNC_MIN_AGE_MS = 60_000;
