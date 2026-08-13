import {
  asCartId,
  asCheckoutSessionId,
  asCustomerId,
  type CartId,
  type CheckoutSessionId,
  type CheckoutStatus,
  type CustomerId,
} from '@iecp/types';

/** The payment-ready artifact this phase builds toward (ADR-007 decision
 * 1) — `OPEN -> VALIDATING -> READY_FOR_PAYMENT`, with `EXPIRED`/
 * `CANCELLED` terminal off-ramps and `CONVERTED` once a future payment/
 * order phase claims it. `idempotencyKey` makes `POST /checkout` safe to
 * retry. Snapshots (`pricingSnapshot`/`shippingSnapshot`/`addressSnapshot`)
 * freeze what the customer agreed to pay once `READY_FOR_PAYMENT` is
 * reached — kept as untyped JSON here (the domain layer's own
 * `PriceLineBreakdown`/address shapes are what get serialized into them,
 * see the application layer). */
export class CheckoutSession {
  private constructor(
    public readonly id: CheckoutSessionId,
    public readonly cartId: CartId,
    public readonly customerId: CustomerId | null,
    public readonly guestToken: string | null,
    public readonly status: CheckoutStatus,
    public readonly currency: string,
    public readonly subtotal: bigint,
    public readonly discountTotal: bigint,
    public readonly taxTotal: bigint,
    public readonly shippingTotal: bigint,
    public readonly grandTotal: bigint,
    public readonly pricingSnapshot: Record<string, unknown> | null,
    public readonly shippingSnapshot: Record<string, unknown> | null,
    public readonly addressSnapshot: Record<string, unknown> | null,
    public readonly idempotencyKey: string,
    public readonly expiresAt: Date | null,
    public readonly cancelledAt: Date | null,
    public readonly convertedAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    cartId: string;
    customerId?: string | null;
    guestToken?: string | null;
    status?: CheckoutStatus;
    currency?: string;
    subtotal?: bigint;
    discountTotal?: bigint;
    taxTotal?: bigint;
    shippingTotal?: bigint;
    grandTotal?: bigint;
    pricingSnapshot?: Record<string, unknown> | null;
    shippingSnapshot?: Record<string, unknown> | null;
    addressSnapshot?: Record<string, unknown> | null;
    idempotencyKey: string;
    expiresAt?: Date | null;
    cancelledAt?: Date | null;
    convertedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): CheckoutSession {
    return new CheckoutSession(
      asCheckoutSessionId(props.id),
      asCartId(props.cartId),
      props.customerId ? asCustomerId(props.customerId) : null,
      props.guestToken ?? null,
      props.status ?? 'OPEN',
      props.currency ?? 'IRR',
      props.subtotal ?? 0n,
      props.discountTotal ?? 0n,
      props.taxTotal ?? 0n,
      props.shippingTotal ?? 0n,
      props.grandTotal ?? 0n,
      props.pricingSnapshot ?? null,
      props.shippingSnapshot ?? null,
      props.addressSnapshot ?? null,
      props.idempotencyKey,
      props.expiresAt ?? null,
      props.cancelledAt ?? null,
      props.convertedAt ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }

  get isTerminal(): boolean {
    return this.status === 'EXPIRED' || this.status === 'CANCELLED' || this.status === 'CONVERTED';
  }

  get isExpired(): boolean {
    return this.expiresAt !== null && this.expiresAt.getTime() <= Date.now();
  }
}
