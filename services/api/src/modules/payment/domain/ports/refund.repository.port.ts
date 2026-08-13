import type { RefundStatus } from '@iecp/types';

import type { Refund } from '../entities/refund.entity';

export const REFUND_REPOSITORY = Symbol('REFUND_REPOSITORY');

export interface RefundRepositoryPort {
  findById(id: string): Promise<Refund | null>;
  findByIdempotencyKey(key: string): Promise<Refund | null>;
  listByTransactionId(paymentTransactionId: string): Promise<Refund[]>;

  /** Every `PENDING` refund created before `olderThan` — stuck, not
   * "about to be processed." What the `refund_status_sync` sweep drives
   * forward through `RefundService.processRefund()`. */
  listStalePending(olderThan: Date): Promise<Refund[]>;

  /** Idempotent on `idempotencyKey` (ADR-008 decision 9) — same
   * P2002-catch-and-reread race-safety pattern as
   * `PaymentIntentRepositoryPort.create()`. Callers must run
   * `RefundValidator.assertRefundable()` before calling this — the
   * repository itself does not re-derive the refundable balance. */
  create(props: {
    paymentTransactionId: string;
    amount: bigint;
    reason?: string | null;
    requestedBy?: string | null;
    idempotencyKey: string;
  }): Promise<Refund>;

  updateStatus(
    id: string,
    status: RefundStatus,
    extra?: { providerRefundReference?: string | null },
  ): Promise<Refund>;
}
