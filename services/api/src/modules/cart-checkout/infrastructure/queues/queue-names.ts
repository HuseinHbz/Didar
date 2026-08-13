/** The two BullMQ queues this phase requires, hosted in-process inside
 * `services/api` (same ADR-006 decision 8 precedent `InventoryQueueModule`
 * established — not `services/worker`). */
export const CHECKOUT_EXPIRATION_QUEUE = 'checkout_expiration';
export const CART_ABANDONMENT_QUEUE = 'cart_abandonment';

/** Shared retry/cleanup policy for the sweep jobs themselves — same
 * defaults `inventory`'s queues use: 3 attempts with exponential backoff,
 * completed jobs removed, failed jobs kept (BullMQ's failed set doubling
 * as the de facto dead letter queue). */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: false,
};

/** How often each sweep runs. Checkout sessions are short-lived (a 20
 * minute TTL — see `CheckoutService`'s `DEFAULT_CHECKOUT_TTL_MINUTES`), so
 * the sweep runs every minute to catch an expired session promptly and
 * release its held reservations. Carts are long-lived (a 30 day TTL), so
 * checking every 15 minutes is more than frequent enough. */
export const CHECKOUT_SWEEP_INTERVAL_MS = 60_000;
export const CART_SWEEP_INTERVAL_MS = 15 * 60_000;
