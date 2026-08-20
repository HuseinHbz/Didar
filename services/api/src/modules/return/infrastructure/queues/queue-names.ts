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

/**
 * ADR-013 decision 5/8 — the crash-recovery queue: re-drives every
 * `ReturnSettlement` still active (`PENDING_RESTOCK`/`REFUND_REQUESTED`)
 * through the exact same idempotent `ReturnSettlementService.
 * beginRestock()`/`requestSettlement()` methods the synchronous admin
 * path calls, catching a settlement that crashed between its own DB
 * commit and its next side effect (ADR-013 crash windows A-E). A
 * tighter cadence than `RETURN_SETTLEMENT_SYNC_SWEEP_INTERVAL_MS`
 * (2 minutes, not 5) — an item stuck un-restocked or un-refunded is a
 * sharper, more visible business cost than a return sitting one sweep
 * tick short of `COMPLETED`.
 */
export const RETURN_SETTLEMENT_RECOVERY_QUEUE = 'return_settlement_recovery';
export const RETURN_SETTLEMENT_RECOVERY_INTERVAL_MS = 2 * 60_000;

/**
 * ADR-013 decision 9 — the reconciliation engine's own periodic driver.
 * Read-heavy and safe to run often; a 10 minute cadence is deliberately
 * looser than the recovery queue's 2 minutes — reconciliation exists to
 * catch patterns the recovery sweep structurally cannot (a missing
 * settlement row, a stuck settlement needing `MANUAL_REVIEW`
 * escalation, duplicate-artifact detection), not to race it.
 */
export const RETURN_RECONCILIATION_QUEUE = 'return_reconciliation';
export const RETURN_RECONCILIATION_INTERVAL_MS = 10 * 60_000;
