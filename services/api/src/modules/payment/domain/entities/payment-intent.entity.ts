import {
  asCheckoutSessionId,
  asCustomerId,
  asPaymentIntentId,
  asPaymentProviderId,
  type CheckoutSessionId,
  type CustomerId,
  type PaymentIntentId,
  type PaymentIntentStatus,
  type PaymentProviderId,
} from '@iecp/types';

/** The durable "customer owes `amount`" fact (ADR-008 decisions 1-2), one
 * per `CheckoutSession` (`checkoutSessionId` unique — the real anchor,
 * not `Order`, which doesn't exist yet). `amount`/`currency` are fixed at
 * creation from the checkout session's own frozen totals and never
 * re-read live. */
export class PaymentIntent {
  private constructor(
    public readonly id: PaymentIntentId,
    public readonly checkoutSessionId: CheckoutSessionId,
    public readonly customerId: CustomerId | null,
    public readonly guestToken: string | null,
    public readonly providerId: PaymentProviderId,
    public readonly status: PaymentIntentStatus,
    public readonly amount: bigint,
    public readonly currency: string,
    public readonly idempotencyKey: string,
    public readonly expiresAt: Date | null,
    public readonly metadata: Record<string, unknown> | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    checkoutSessionId: string;
    customerId?: string | null;
    guestToken?: string | null;
    providerId: string;
    status?: PaymentIntentStatus;
    amount: bigint;
    currency?: string;
    idempotencyKey: string;
    expiresAt?: Date | null;
    metadata?: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  }): PaymentIntent {
    return new PaymentIntent(
      asPaymentIntentId(props.id),
      asCheckoutSessionId(props.checkoutSessionId),
      props.customerId ? asCustomerId(props.customerId) : null,
      props.guestToken ?? null,
      asPaymentProviderId(props.providerId),
      props.status ?? 'CREATED',
      props.amount,
      props.currency ?? 'IRR',
      props.idempotencyKey,
      props.expiresAt ?? null,
      props.metadata ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }

  get isTerminal(): boolean {
    return this.status === 'SUCCEEDED' || this.status === 'EXPIRED' || this.status === 'CANCELLED';
  }

  get isExpired(): boolean {
    return this.expiresAt !== null && this.expiresAt.getTime() <= Date.now();
  }
}
