import type {
  OrderFulfillmentStatus,
  OrderPaymentStatus,
  OrderSource,
  OrderStatus,
} from '@iecp/types';

import type { OrderItem } from '../entities/order-item.entity';
import type { OrderStatusHistory } from '../entities/order-status-history.entity';
import type { Order } from '../entities/order.entity';

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');

export interface OrderWithDetail {
  order: Order;
  items: OrderItem[];
  statusHistory: OrderStatusHistory[];
}

export interface OrderListFilter {
  customerId?: string;
  guestToken?: string;
  status?: OrderStatus;
  limit: number;
  /** Opaque cursor from a previous page's `nextCursor` — same shape
   * `AuditLogRepositoryPort.list()` already established. */
  cursor?: string | null;
}

/**
 * `Order` is the aggregate root for `OrderItem` and `OrderStatusHistory` —
 * same "child entities with no independent lifecycle" reasoning
 * `CheckoutSessionRepositoryPort`/`PaymentIntentRepositoryPort` already
 * use for their own children.
 */
export interface OrderRepositoryPort {
  findById(id: string): Promise<OrderWithDetail | null>;
  findByOrderNumber(orderNumber: string): Promise<Order | null>;
  findByCheckoutSessionId(checkoutSessionId: string): Promise<Order | null>;
  findByPaymentIntentId(paymentIntentId: string): Promise<Order | null>;
  list(filter: OrderListFilter): Promise<{ items: Order[]; nextCursor: string | null }>;

  /** Every order past `PENDING_PAYMENT` (i.e. real, paid) updated since
   * `since` — reserved for the `invoice_generation` sweep's reliability
   * backstop (a crash between `orders.create()` and
   * `invoices.issueForOrder()` inside `OrderConversionService`). */
  listRecentlyPaid(since: Date): Promise<Order[]>;

  /** Every order still `PENDING_PAYMENT` and created before `olderThan` —
   * reserved for the `order_conversion` sweep's other reliability
   * backstop: a crash between `orders.create()` and
   * `checkout.markConverted()` inside `OrderConversionService.
   * convertFromCheckout()` leaves an order stuck here *and* leaves its
   * checkout still short of `CONVERTED`, so the sweep's own
   * `listConvertedSince()` scan alone would never find it. `olderThan`
   * (not "since now") is deliberate — a genuinely in-flight conversion a
   * few milliseconds into its own transaction is not stuck, just busy. */
  listStuckPendingConversion(olderThan: Date): Promise<Order[]>;

  /** Generates the next order number from `commerce.order_number_seq`
   * (ADR-009 decision 6) and creates the `Order` + its `OrderItem` rows in
   * one transaction. Idempotent on `checkoutSessionId`/`paymentIntentId`
   * (both `@unique`, ADR-009 decision 4) — implementations must catch the
   * resulting `P2002` and re-read the winner's row, same pattern every
   * prior phase's idempotency guarantee uses. */
  create(props: {
    checkoutSessionId: string;
    paymentIntentId: string;
    customerId?: string | null;
    guestToken?: string | null;
    source?: OrderSource;
    currency: string;
    subtotal: bigint;
    discountTotal: bigint;
    taxTotal: bigint;
    shippingTotal: bigint;
    grandTotal: bigint;
    shippingAddressSnapshot: Record<string, unknown>;
    billingAddressSnapshot?: Record<string, unknown> | null;
    items: readonly {
      productSkuId?: string | null;
      skuSnapshot: string;
      nameSnapshot: string;
      unitPriceSnapshot: bigint;
      quantity: number;
      discountAmount: bigint;
      taxAmount: bigint;
      lineTotal: bigint;
    }[];
  }): Promise<Order>;

  /** Writes the new `status` and appends an `OrderStatusHistory` row in
   * the same call — same cache-plus-append-only-history split every prior
   * status-bearing aggregate in this repo uses. `changedBy: null` records
   * a system-generated transition. */
  updateStatus(
    id: string,
    status: OrderStatus,
    changedBy: string | null,
    note?: string | null,
    extra?: { cancelledAt?: Date; completedAt?: Date },
  ): Promise<Order>;

  /** Cache-column update only (ADR-009 decision 3) — never the source of
   * truth; called the moment `OrderService` learns of a new
   * `PaymentTransaction`/`Refund` outcome. */
  updatePaymentState(
    id: string,
    props: { paymentStatus: OrderPaymentStatus; paidTotal: bigint; refundedTotal: bigint },
  ): Promise<Order>;

  /** Cache-column update only (ADR-009 decision 3) — derived from this
   * order's own `FulfillmentItem` sums. */
  updateFulfillmentStatus(id: string, fulfillmentStatus: OrderFulfillmentStatus): Promise<Order>;
}
