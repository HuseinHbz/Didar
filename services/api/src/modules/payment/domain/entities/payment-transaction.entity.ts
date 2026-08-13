import {
  asPaymentAttemptId,
  asPaymentIntentId,
  asPaymentProviderId,
  asPaymentTransactionId,
  type PaymentAttemptId,
  type PaymentIntentId,
  type PaymentProviderId,
  type PaymentTransactionId,
  type PaymentTransactionStatus,
} from '@iecp/types';

/** The verified, immutable settlement record (ADR-008 decisions 2-3) —
 * created only from a real server-to-server `verifyPayment()` call whose
 * `amount`/`providerReference` match the `PaymentIntent` exactly. No
 * repository method exposes an update path for a `VERIFIED` row's
 * `amount`/`status` — this class has no mutators for that reason. */
export class PaymentTransaction {
  private constructor(
    public readonly id: PaymentTransactionId,
    public readonly paymentIntentId: PaymentIntentId,
    public readonly paymentAttemptId: PaymentAttemptId | null,
    public readonly providerId: PaymentProviderId,
    public readonly providerReference: string,
    public readonly amount: bigint,
    public readonly currency: string,
    public readonly status: PaymentTransactionStatus,
    public readonly verifiedAt: Date | null,
    public readonly rawVerificationResponse: Record<string, unknown> | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    paymentIntentId: string;
    paymentAttemptId?: string | null;
    providerId: string;
    providerReference: string;
    amount: bigint;
    currency?: string;
    status?: PaymentTransactionStatus;
    verifiedAt?: Date | null;
    rawVerificationResponse?: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  }): PaymentTransaction {
    return new PaymentTransaction(
      asPaymentTransactionId(props.id),
      asPaymentIntentId(props.paymentIntentId),
      props.paymentAttemptId ? asPaymentAttemptId(props.paymentAttemptId) : null,
      asPaymentProviderId(props.providerId),
      props.providerReference,
      props.amount,
      props.currency ?? 'IRR',
      props.status ?? 'PENDING',
      props.verifiedAt ?? null,
      props.rawVerificationResponse ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }

  get isVerified(): boolean {
    return this.status === 'VERIFIED';
  }
}
