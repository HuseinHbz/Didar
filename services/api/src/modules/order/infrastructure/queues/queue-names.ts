/** The two BullMQ queues this phase justifies (same ADR-006 decision 8 /
 * ADR-007 decision 3 / ADR-008 precedent every prior phase's own queue
 * module establishes) — each a reliability backstop for a synchronous
 * path that can be legitimately missed (a customer who never returns
 * after paying; a crash mid-`OrderConversionService` call), never a
 * queue added just because the brief's suggestion list mentioned a name.
 * `order-expiration`/`fulfillment-processing`/`shipment-sync` are
 * deliberately *not* built — `PENDING_PAYMENT` is not a durably-persisted
 * reachable state in this design (an `Order` row is only ever written
 * already `PAID`, see `OrderConversionService`), so there is nothing for
 * an order-expiration sweep to expire; fulfillment/shipment status
 * changes are synchronous admin actions with no async processing to
 * decouple, and no live courier exists to sync against. */
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
