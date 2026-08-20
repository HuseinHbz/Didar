/** The one BullMQ queue Phase 012 requires, hosted in-process inside
 * `services/api` (same ADR-006 decision 8 / ADR-007 decision 3
 * precedent `InventoryQueueModule`/`CartCheckoutQueueModule` established,
 * most recently `PaymentQueueModule`'s own `refund_status_sync`). */
export const RETURN_SETTLEMENT_SYNC_QUEUE = 'return_settlement_sync';

/** Same retry/cleanup policy every other sweep queue in this repo uses. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: false,
};

/**
 * ADR-012 decision 8 — `ReturnRequest.status === 'REFUNDED'` means
 * settlement was *triggered*, not that money has actually moved yet: a
 * `REFUND`-resolution return's linked `Refund` starts `PENDING` and is
 * driven to `COMPLETED` asynchronously by the payment module's own
 * `refund_status_sync` sweep — a separate, pre-existing process this
 * queue does not duplicate. `return_settlement_sync` is the caller
 * Decision 1's `REFUNDED -> COMPLETED` step always needed: every
 * `ReturnRequest` still `REFUNDED` whose linked `Refund.status` has
 * reached `COMPLETED` (or whose linked `CreditNote.status` is `ISSUED`/
 * `APPLIED` — issued synchronously inside `ReturnService.refund()`
 * itself, so this half of the check almost always finds it settled on
 * the very next sweep tick) is driven to `COMPLETED`. Refunds against a
 * return are rare, so a 5 minute cadence — the same
 * `REFUND_STATUS_SYNC_SWEEP_INTERVAL_MS` this sweep's own upstream
 * dependency uses — is enough.
 */
export const RETURN_SETTLEMENT_SYNC_SWEEP_INTERVAL_MS = 5 * 60_000;
