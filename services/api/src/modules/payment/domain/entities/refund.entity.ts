import {
  asPaymentTransactionId,
  asRefundId,
  asUserId,
  type PaymentTransactionId,
  type RefundId,
  type RefundStatus,
  type UserId,
} from '@iecp/types';

/** Against an immutable `VERIFIED` `PaymentTransaction` — `RefundValidator`
 * (domain service) guards `amount` against the transaction's own total
 * before this row is ever created (ADR-008 decision 6). */
export class Refund {
  private constructor(
    public readonly id: RefundId,
    public readonly paymentTransactionId: PaymentTransactionId,
    public readonly amount: bigint,
    public readonly reason: string | null,
    public readonly status: RefundStatus,
    public readonly requestedBy: UserId | null,
    public readonly providerRefundReference: string | null,
    public readonly idempotencyKey: string,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    paymentTransactionId: string;
    amount: bigint;
    reason?: string | null;
    status?: RefundStatus;
    requestedBy?: string | null;
    providerRefundReference?: string | null;
    idempotencyKey: string;
    createdAt: Date;
    updatedAt: Date;
  }): Refund {
    return new Refund(
      asRefundId(props.id),
      asPaymentTransactionId(props.paymentTransactionId),
      props.amount,
      props.reason ?? null,
      props.status ?? 'PENDING',
      props.requestedBy ? asUserId(props.requestedBy) : null,
      props.providerRefundReference ?? null,
      props.idempotencyKey,
      props.createdAt,
      props.updatedAt,
    );
  }

  /** Whether this refund still counts against the transaction's
   * refundable balance — `REJECTED`/`FAILED` refunds free up the amount
   * they would have consumed (ADR-008 decision 6, mirrored in
   * `RefundValidator`). */
  get countsAgainstBalance(): boolean {
    return this.status !== 'REJECTED' && this.status !== 'FAILED';
  }
}
