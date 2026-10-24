import type { RefundStatus } from '@iecp/types';

import type { RefundLine } from '../entities/refund-line.entity';
import type { Refund } from '../entities/refund.entity';

export const REFUND_REPOSITORY = Symbol('REFUND_REPOSITORY');

export interface RefundWithLines {
  refund: Refund;
  lines: RefundLine[];
}

/** How a refund the caller holds in `PROCESSING` ended (CP-031). `failureReason`
 * is written only for `REJECTED`/`FAILED`. */
export interface RefundOutcome {
  status: Extract<RefundStatus, 'COMPLETED' | 'FAILED' | 'REJECTED'>;
  providerRefundReference?: string | null;
  failureReason?: string | null;
}

/** Admin listing filter; every field optional and combinable. */
export interface RefundSearchFilter {
  paymentTransactionId?: string;
  returnRequestId?: string;
  status?: RefundStatus;
}

export interface RefundRepositoryPort {
  findById(id: string): Promise<Refund | null>;
  /** Same aggregate as `findById()`, plus its `RefundLine` breakdown —
   * empty for a direct/order-level refund, one entry per `ReturnItem`
   * for a return-triggered refund (ADR-012 decision 8). */
  findByIdWithLines(id: string): Promise<RefundWithLines | null>;
  findByIdempotencyKey(key: string): Promise<Refund | null>;
  listByTransactionId(paymentTransactionId: string): Promise<Refund[]>;
  /** Every refund linked to `returnRequestId` — `ReturnService` reads
   * this to resolve a return's own refund status; there is never more
   * than one non-`REJECTED`/non-`FAILED` entry in practice, but this
   * stays a list (not `findOne`) since a first rejected attempt and a
   * later retried one can both exist as real rows. */
  listByReturnRequestId(returnRequestId: string): Promise<Refund[]>;

  /** Admin listing (`GET /admin/payments/refunds`): one database query, every
   * filter applied in SQL, newest first with an `id` tie-break so the order is
   * deterministic, bounded by `limit`. The caller guarantees at least one
   * filter is set — this never becomes an unfiltered scan. */
  search(filter: RefundSearchFilter, limit: number): Promise<Refund[]>;

  /** Every `PENDING` refund created before `olderThan` — stuck, not
   * "about to be processed." What the `refund_status_sync` sweep drives
   * forward through `RefundService.processRefund()`. */
  listStalePending(olderThan: Date): Promise<Refund[]>;

  /** Idempotent on `idempotencyKey` (ADR-008 decision 9) — same
   * P2002-catch-and-reread race-safety pattern as
   * `PaymentIntentRepositoryPort.create()`. Callers must run
   * `RefundValidator.assertRefundable()` before calling this — the
   * repository itself does not re-derive the refundable balance.
   *
   * `returnRequestId`/`lines`, added by ADR-012 decision 8, are both
   * optional and additive — every existing caller
   * (`OrderService.cancel()`/`.requestPartialRefund()`) omits them and
   * gets the exact same direct/order-level refund as before. When
   * supplied, `lines` is written in the same transaction as the
   * `Refund` insert itself; the repository does not re-validate that
   * the lines sum to `amount` — `ReturnService` does, via
   * `RefundAmountCalculator`, before calling this. */
  create(props: {
    paymentTransactionId: string;
    amount: bigint;
    reason?: string | null;
    requestedBy?: string | null;
    idempotencyKey: string;
    returnRequestId?: string | null;
    lines?: readonly { returnItemId: string; amount: bigint }[];
  }): Promise<Refund>;

  /**
   * Atomically moves a refund `PENDING -> PROCESSING` — one conditional UPDATE,
   * so of any number of concurrent callers (an admin double-click, the
   * `refund_status_sync` sweep overlapping an admin request) exactly one gets
   * `true` and is the only one allowed to send the refund to the provider.
   * Everyone else gets `false` and must not send anything (CP-031).
   *
   * There is deliberately no way to claim a refund already in `PROCESSING`: if a
   * send was lost mid-flight (a crash after the gateway accepted but before the
   * outcome was written) the gateway may already have returned the money, and a
   * blind re-send could be answered with an error that would then be recorded as
   * "not refunded". A refund stuck in `PROCESSING` keeps its balance consumed and
   * is for finance to check — the safe failure.
   */
  claimForProcessing(id: string): Promise<boolean>;

  /**
   * Records how a refund this caller holds in `PROCESSING` ended. Conditional on
   * `status = 'PROCESSING'`, so a terminal state is never overwritten — the old
   * unconditional write let a late loser flip a `COMPLETED` refund to `REJECTED`
   * (freeing its balance although the money had already left). Returns `null`
   * when the row was no longer `PROCESSING`; the caller treats that as a loud
   * inconsistency, never as success.
   */
  settleProcessing(id: string, outcome: RefundOutcome): Promise<Refund | null>;
}
