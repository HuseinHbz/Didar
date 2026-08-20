import type { RefundStatus } from '@iecp/types';

import type { RefundLine } from '../entities/refund-line.entity';
import type { Refund } from '../entities/refund.entity';

export const REFUND_REPOSITORY = Symbol('REFUND_REPOSITORY');

export interface RefundWithLines {
  refund: Refund;
  lines: RefundLine[];
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

  updateStatus(
    id: string,
    status: RefundStatus,
    extra?: { providerRefundReference?: string | null },
  ): Promise<Refund>;
}
