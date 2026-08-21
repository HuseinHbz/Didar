import type { ReturnSettlementStatus } from '@iecp/types';

import type { ReturnSettlement } from '../entities/return-settlement.entity';

import type { StatusUpdateResult } from './return.repository.port';

export const RETURN_SETTLEMENT_REPOSITORY = Symbol('RETURN_SETTLEMENT_REPOSITORY');

/**
 * ADR-013 — one `ReturnSettlement` row per `ReturnRequest`. `create()`
 * is idempotent (upsert-shaped on the real `@unique returnRequestId`
 * FK) since it's called from `ReturnService.approveForRefund()`'s own
 * `transitioned: true` branch — safe even if that branch's own guard
 * were ever bypassed by a future code path. `updateStatus()` follows
 * the exact row-lock + re-check-the-state-machine technique every
 * other status-bearing aggregate in this codebase already uses.
 */
export interface ReturnSettlementRepositoryPort {
  findById(id: string): Promise<ReturnSettlement | null>;
  findByReturnRequestId(returnRequestId: string): Promise<ReturnSettlement | null>;

  /** Every settlement not yet `COMPLETED`/`FAILED_TERMINAL`/
   * `MANUAL_REVIEW` — what the recovery sweep and reconciliation both
   * scan. `staleSince`, when supplied, additionally filters to rows
   * whose `updatedAt` is older than that instant (the sweep's own
   * grace-period window, so a settlement still being worked by the
   * synchronous happy path is never yanked mid-flight). */
  listActive(staleSince?: Date): Promise<ReturnSettlement[]>;

  /** Every settlement currently `MANUAL_REVIEW` — the admin-facing
   * "needs a human" queue. */
  listManualReview(): Promise<ReturnSettlement[]>;

  /** Idempotent: a retried call for a `returnRequestId` that already
   * has a settlement row returns the existing one unchanged, never a
   * second row (real, `@unique` database-enforced). */
  create(returnRequestId: string): Promise<ReturnSettlement>;

  /** Row-locks the settlement (`SELECT ... FOR UPDATE`) and re-checks
   * `ReturnSettlementStateMachine` against the *locked* status before
   * writing. `transitioned: false` means a concurrent caller already
   * made this exact transition first — the caller must skip
   * audit-logging/side-effects it would otherwise perform. */
  updateStatus(
    id: string,
    status: ReturnSettlementStatus,
    extra?: {
      restockCompletedAt?: Date;
      refundRequestedAt?: Date;
      refundRecordedAt?: Date;
      settledAt?: Date;
      completedAt?: Date;
      lastError?: string | null;
    },
  ): Promise<StatusUpdateResult<ReturnSettlement>>;

  /** Records a transient (retryable) failure in place — increments
   * `attempts`, sets `lastError`/`lastAttemptAt` — without moving
   * `status` at all (ADR-013's own reasoning for why
   * `FAILED_RETRYABLE` is never a real transition target: the
   * settlement simply stays in its current progressing state and
   * tries again next tick). */
  recordAttemptFailure(id: string, error: string): Promise<ReturnSettlement>;

  /**
   * ADR-013 §12 (financial consistency) — the real fix for the
   * `OrderService.recordReturnRefund()` double-counting bug found while
   * auditing Phase 012: a single atomic
   * `UPDATE ... SET refund_recorded_at = NOW() WHERE id = $1 AND
   * refund_recorded_at IS NULL RETURNING id` (Postgres guarantees only
   * one of any number of truly concurrent identical statements ever
   * matches a row). Returns `true` only for the one caller that
   * actually flipped the column — that caller, and only that caller,
   * may call `OrderService.recordReturnRefund()`. Every other
   * concurrent or retried caller gets `false` and must skip it,
   * regardless of how many times `requestSettlement()` itself is
   * re-entered. Deliberately not folded into `updateStatus()`: this
   * needs to be callable (and safe to call) independently of whichever
   * status transition happens to be in flight around it.
   */
  claimRefundRecording(id: string): Promise<boolean>;
}
