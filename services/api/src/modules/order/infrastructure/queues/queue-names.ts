/** The two BullMQ queues this phase justifies (same ADR-006 decision 8 /
 * ADR-007 decision 3 / ADR-008 precedent every prior phase's own queue
 * module establishes) — each a reliability backstop for a synchronous
 * path that can be legitimately missed (a customer who never returns
 * after paying; a crash mid-`OrderConversionService` call), never a
 * queue added just because the brief's suggestion list mentioned a name.
 * `PENDING_PAYMENT` *is* a real, if narrow and short-lived, reachable
 * state — a crash between `orders.create()` and the rest of
 * `convertFromCheckout()` leaves a row there — which is exactly why
 * `order_conversion`'s own sweep also scans for it directly (see
 * `ORDER_STUCK_PENDING_GRACE_MS` below), not only for already-`CONVERTED`
 * checkouts. A dedicated `order-expiration`/`fulfillment-processing`/
 * `shipment-sync` queue is still deliberately *not* built beyond that:
 * fulfillment/shipment status changes are synchronous admin actions with
 * no async processing to decouple, and no live courier exists to sync
 * against. */
export const ORDER_CONVERSION_QUEUE = 'order_conversion';
export const INVOICE_GENERATION_QUEUE = 'invoice_generation';

/** Same retry/cleanup policy every other sweep queue in this repo uses. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: false,
};

/**
 * `order_conversion` runs every minute, matching `payment_verification_
 * retry`'s own cadence (the sweep it's the direct downstream reliability
 * partner of) — a checkout marked `CONVERTED` by Payment but never
 * followed by a synchronous `convertFromCheckout()` call (a customer who
 * closes the browser right after paying, before any Order endpoint is
 * ever hit) would otherwise never get an `Order` at all.
 *
 * `invoice_generation` runs every 5 minutes — the gap it closes (a crash
 * between `orders.create()` and `invoices.issueForOrder()` inside the
 * same `OrderConversionService` call) is rare by construction, so a
 * background job, not a request-path cost, same reasoning
 * `refund_status_sync`'s own cadence gives.
 */
export const ORDER_CONVERSION_SWEEP_INTERVAL_MS = 60_000;
export const INVOICE_GENERATION_SWEEP_INTERVAL_MS = 5 * 60_000;

/** How far back each sweep looks — wide enough to catch anything the
 * synchronous path missed, narrow enough that a healthy system's sweep
 * does near-zero work most runs. */
export const ORDER_CONVERSION_LOOKBACK_MS = 24 * 60 * 60_000;
export const INVOICE_GENERATION_LOOKBACK_MS = 24 * 60 * 60_000;

/** How long an order may sit `PENDING_PAYMENT` before the sweep treats it
 * as stuck rather than merely in-flight — same 2-minute grace window
 * `payment_verification_retry`'s own "never returned" threshold uses. */
export const ORDER_STUCK_PENDING_GRACE_MS = 2 * 60_000;
