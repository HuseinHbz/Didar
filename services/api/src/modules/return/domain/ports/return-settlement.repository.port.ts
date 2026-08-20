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
}
