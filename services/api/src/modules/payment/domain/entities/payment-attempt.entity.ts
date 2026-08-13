import {
  asPaymentAttemptId,
  asPaymentIntentId,
  type PaymentAttemptId,
  type PaymentAttemptStatus,
  type PaymentIntentId,
} from '@iecp/types';

/** One redirect round trip against the provider (ADR-008 decision 2) — a
 * retried checkout creates a new attempt (`attemptNumber` increments),
 * never mutates a prior one. */
export class PaymentAttempt {
  private constructor(
    public readonly id: PaymentAttemptId,
    public readonly paymentIntentId: PaymentIntentId,
    public readonly attemptNumber: number,
    public readonly providerAuthority: string | null,
    public readonly redirectUrl: string | null,
    public readonly status: PaymentAttemptStatus,
    public readonly startedAt: Date,
    public readonly returnedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    paymentIntentId: string;
    attemptNumber: number;
    providerAuthority?: string | null;
    redirectUrl?: string | null;
    status?: PaymentAttemptStatus;
    startedAt?: Date;
    returnedAt?: Date | null;
    createdAt: Date;
  }): PaymentAttempt {
    return new PaymentAttempt(
      asPaymentAttemptId(props.id),
      asPaymentIntentId(props.paymentIntentId),
      props.attemptNumber,
      props.providerAuthority ?? null,
      props.redirectUrl ?? null,
      props.status ?? 'INITIATED',
      props.startedAt ?? props.createdAt,
      props.returnedAt ?? null,
      props.createdAt,
    );
  }

  get isTerminal(): boolean {
    return this.status === 'RETURNED' || this.status === 'ABANDONED' || this.status === 'EXPIRED';
  }
}
