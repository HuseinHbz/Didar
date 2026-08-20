import {
  asCheckoutSessionId,
  asCustomerId,
  asOrderId,
  asPaymentIntentId,
  type CheckoutSessionId,
  type CustomerId,
  type OrderFulfillmentStatus,
  type OrderId,
  type OrderPaymentStatus,
  type OrderSource,
  type OrderStatus,
  type PaymentIntentId,
} from '@iecp/types';

/** The durable commercial record (ADR-009 decision 1) — created only by
 * `OrderConversionService` from a verified `PaymentTransaction`, never
 * from a client-supplied body. `checkoutSessionId`/`paymentIntentId` are
 * both real, `@unique`, same-schema FKs — the idempotency anchor (ADR-009
 * decision 4). `status` is the 8-state lifecycle machine;
 * `paymentStatus`/`fulfillmentStatus` are cached reads alongside it
 * (ADR-009 decision 3), never independently authoritative. */
export class Order {
  private constructor(
    public readonly id: OrderId,
    public readonly orderNumber: string,
    public readonly checkoutSessionId: CheckoutSessionId,
    public readonly paymentIntentId: PaymentIntentId,
    public readonly customerId: CustomerId | null,
    public readonly guestToken: string | null,
    public readonly source: OrderSource,
    public readonly status: OrderStatus,
    public readonly paymentStatus: OrderPaymentStatus,
    public readonly fulfillmentStatus: OrderFulfillmentStatus,
    public readonly currency: string,
    public readonly subtotal: bigint,
    public readonly discountTotal: bigint,
    public readonly taxTotal: bigint,
    public readonly shippingTotal: bigint,
    public readonly grandTotal: bigint,
    public readonly paidTotal: bigint,
    public readonly refundedTotal: bigint,
    public readonly shippingAddressSnapshot: Record<string, unknown>,
    public readonly billingAddressSnapshot: Record<string, unknown> | null,
    public readonly placedAt: Date,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly cancelledAt: Date | null,
    public readonly completedAt: Date | null,
  ) {}

  static create(props: {
    id: string;
    orderNumber: string;
    checkoutSessionId: string;
    paymentIntentId: string;
    customerId?: string | null;
    guestToken?: string | null;
    source?: OrderSource;
    status?: OrderStatus;
    paymentStatus?: OrderPaymentStatus;
    fulfillmentStatus?: OrderFulfillmentStatus;
    currency?: string;
    subtotal: bigint;
    discountTotal?: bigint;
    taxTotal?: bigint;
    shippingTotal?: bigint;
    grandTotal: bigint;
    paidTotal?: bigint;
    refundedTotal?: bigint;
    shippingAddressSnapshot: Record<string, unknown>;
    billingAddressSnapshot?: Record<string, unknown> | null;
    placedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    cancelledAt?: Date | null;
    completedAt?: Date | null;
  }): Order {
    return new Order(
      asOrderId(props.id),
      props.orderNumber,
      asCheckoutSessionId(props.checkoutSessionId),
      asPaymentIntentId(props.paymentIntentId),
      props.customerId ? asCustomerId(props.customerId) : null,
      props.guestToken ?? null,
      props.source ?? 'STOREFRONT',
      props.status ?? 'PENDING_PAYMENT',
      props.paymentStatus ?? 'UNPAID',
      props.fulfillmentStatus ?? 'UNFULFILLED',
      props.currency ?? 'IRR',
      props.subtotal,
      props.discountTotal ?? 0n,
      props.taxTotal ?? 0n,
      props.shippingTotal ?? 0n,
      props.grandTotal,
      props.paidTotal ?? 0n,
      props.refundedTotal ?? 0n,
      props.shippingAddressSnapshot,
      props.billingAddressSnapshot ?? null,
      props.placedAt,
      props.createdAt,
      props.updatedAt,
      props.cancelledAt ?? null,
      props.completedAt ?? null,
    );
  }

  get isTerminal(): boolean {
    return this.status === 'CANCELLED' || this.status === 'COMPLETED';
  }
}
