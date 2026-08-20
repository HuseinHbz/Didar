import type { OrderPaymentStatus } from '@iecp/types';
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import { PaymentIntentService } from '../../payment/application/payment-intent.service';
import { RefundService } from '../../payment/application/refund.service';
import type { Order } from '../domain/entities/order.entity';
import {
  FULFILLMENT_REPOSITORY,
  type FulfillmentRepositoryPort,
} from '../domain/ports/fulfillment.repository.port';
import {
  ORDER_REPOSITORY,
  type OrderListFilter,
  type OrderRepositoryPort,
  type OrderWithDetail,
} from '../domain/ports/order.repository.port';
import { OrderCompletionValidator } from '../domain/services/order-completion-validator';
import { OrderStateMachine } from '../domain/services/order-state-machine';

export interface OrderActor {
  customerId: string | null;
  guestToken: string | null;
}

/**
 * General order lifecycle — ownership/IDOR, read paths, admin-driven
 * `approve`/`complete` advancement, and cancellation (ADR-009 decision
 * 10). `Order` creation itself is `OrderConversionService`'s job, never
 * this class's — this service never writes `PENDING_PAYMENT`/`PAID`.
 */
@Injectable()
export class OrderService {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepositoryPort,
    @Inject(FULFILLMENT_REPOSITORY) private readonly fulfillments: FulfillmentRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
    private readonly payments: PaymentIntentService,
    private readonly refunds: RefundService,
  ) {}

  async get(orderId: string, actor: OrderActor): Promise<OrderWithDetail> {
    const detail = await this.orders.findById(orderId);
    if (!detail) throw new NotFoundException('Order not found');
    this.assertOwnership(detail.order, actor);
    return detail;
  }

  /** Admin/support read — no ownership check, gated entirely by
   * `@RequirePermission('order.read')` on the admin route. */
  async getForAdmin(orderId: string): Promise<OrderWithDetail> {
    const detail = await this.orders.findById(orderId);
    if (!detail) throw new NotFoundException('Order not found');
    return detail;
  }

  /** Same IDOR-protection shape `CheckoutService`/`PaymentIntentService`
   * already establish. */
  private assertOwnership(order: Order, actor: OrderActor): void {
    if (order.customerId) {
      if (order.customerId !== actor.customerId) {
        throw new ForbiddenException('This order does not belong to the current customer');
      }
      return;
    }
    if (order.guestToken && order.guestToken !== actor.guestToken) {
      throw new ForbiddenException('This order does not belong to the current guest session');
    }
  }

  async list(actor: OrderActor, limit: number, cursor?: string | null) {
    const filter: OrderListFilter = actor.customerId
      ? { customerId: actor.customerId, limit, cursor }
      : { guestToken: actor.guestToken ?? undefined, limit, cursor };
    return this.orders.list(filter);
  }

  async listForAdmin(filter: OrderListFilter) {
    return this.orders.list(filter);
  }

  /** `POST /admin/orders/:id/approve` — advances the order one legal step
   * forward toward fulfillment: `PAID -> PROCESSING` or
   * `PROCESSING -> READY_TO_FULFILL`, whichever the order's current
   * status makes legal. Rejects (via `OrderStateMachine`) from any other
   * status — this is deliberately not a generic "set any status" escape
   * hatch. */
  async approve(orderId: string, actorUserId: string): Promise<Order> {
    const detail = await this.getForAdmin(orderId);
    const next = detail.order.status === 'PAID' ? 'PROCESSING' : 'READY_TO_FULFILL';
    OrderStateMachine.assertTransition(detail.order.status, next);
    const updated = await this.orders.updateStatus(orderId, next, actorUserId);
    await this.auditLog.record({
      actorId: actorUserId,
      action: 'ORDER_STATUS_CHANGED',
      entityType: 'Order',
      entityId: orderId,
      oldValue: { status: detail.order.status },
      newValue: { status: next },
    });
    return updated;
  }

  /** `POST /admin/orders/:id/complete` — `FULFILLED -> COMPLETED`.
   * ADR-011 decision 3: this is a server-derived fact, not an admin
   * button — `OrderCompletionValidator` checks every non-cancelled
   * `Fulfillment` is actually `DELIVERED` (not merely quantity-covered)
   * and the order's payment state is settled *before* the state-machine
   * edge is even asserted, raising a real `OrderNotReadyToCompleteError`
   * (409) when it isn't. */
  async complete(orderId: string, actorUserId: string): Promise<Order> {
    const detail = await this.getForAdmin(orderId);
    if (OrderStateMachine.isNoOp(detail.order.status, 'COMPLETED')) return detail.order;

    const fulfillments = await this.fulfillments.listByOrderId(orderId);
    OrderCompletionValidator.assertReady({
      fulfillmentStatus: detail.order.fulfillmentStatus,
      paymentStatus: detail.order.paymentStatus,
      fulfillments: fulfillments.map((f) => ({ status: f.fulfillment.status })),
    });
    OrderStateMachine.assertTransition(detail.order.status, 'COMPLETED');
    const updated = await this.orders.updateStatus(orderId, 'COMPLETED', actorUserId, null, {
      completedAt: new Date(),
    });
    await this.auditLog.record({
      actorId: actorUserId,
      action: 'ORDER_STATUS_CHANGED',
      entityType: 'Order',
      entityId: orderId,
      oldValue: { status: detail.order.status },
      newValue: { status: 'COMPLETED' },
    });
    return updated;
  }

  /**
   * ADR-009 decision 10. Idempotent by construction
   * (`OrderStateMachine.isNoOp`): cancelling an already-`CANCELLED` order
   * returns it unchanged. Rejects (via `OrderStateMachine`) once
   * fulfillment has begun or the order is `COMPLETED` — a real, structural
   * rejection, not a soft warning. Never issues a refund itself — only
   * requests one via `RefundService.requestRefund()` (Phase 008 owns
   * money movement), resolving the `VERIFIED` `PaymentTransaction` via
   * `PaymentIntentService.findById()`.
   *
   * Deliberately does **not** restock inventory: by the time an `Order`
   * row exists at all, `OrderConversionService.convertFromCheckout()` has
   * already called `ReservationService.convert()` on every reservation
   * the checkout held (stock is genuinely sold, not merely held) — the
   * same "no refund-triggered inventory restock" gap
   * `docs/product/payment.md`'s own Phase 008 scope already declares, not
   * a new omission this phase introduces.
   */
  async cancel(
    orderId: string,
    actorUserId: string | null,
    reason?: string | null,
  ): Promise<Order> {
    const detail = await this.getForAdmin(orderId);
    if (OrderStateMachine.isNoOp(detail.order.status, 'CANCELLED')) return detail.order;
    if (!OrderStateMachine.isCancellable(detail.order.status)) {
      OrderStateMachine.assertTransition(detail.order.status, 'CANCELLED');
    }

    if (detail.order.paidTotal > 0n) {
      const intentDetail = await this.payments.findById(detail.order.paymentIntentId);
      const transaction = intentDetail?.transactions.find((t) => t.isVerified);
      if (transaction) {
        await this.refunds
          .requestRefund({
            paymentTransactionId: transaction.id,
            amount: detail.order.paidTotal - detail.order.refundedTotal,
            reason: reason ?? 'Order cancelled',
            requestedBy: actorUserId ?? undefined,
            idempotencyKey: `order-cancel__${orderId}`,
          })
          .catch(() => undefined);
      }
    }

    const updated = await this.orders.updateStatus(
      orderId,
      'CANCELLED',
      actorUserId,
      reason ?? 'Order cancelled',
      { cancelledAt: new Date() },
    );
    await this.auditLog.record({
      actorId: actorUserId,
      action: 'ORDER_CANCELLED',
      entityType: 'Order',
      entityId: orderId,
      oldValue: { status: detail.order.status },
      newValue: { status: 'CANCELLED', reason: reason ?? null },
    });
    return updated;
  }

  /** `POST /admin/orders/:id/refund` (`order.refund`) — a partial refund
   * on a still-active order, distinct from `cancel()`: the order itself
   * is untouched (no status/state-machine transition), only its
   * `refundedTotal` cache moves once the refund is requested. Never
   * exceeds what remains refundable — `RefundService.requestRefund()`'s
   * own `RefundValidator` is the real guard (Phase 008), this method never
   * duplicates that check. */
  async requestPartialRefund(
    orderId: string,
    actorUserId: string,
    amount: bigint,
    reason?: string | null,
  ): Promise<Order> {
    const detail = await this.getForAdmin(orderId);
    if (detail.order.paidTotal <= 0n) {
      throw new ForbiddenException('This order has no payment to refund');
    }

    const intentDetail = await this.payments.findById(detail.order.paymentIntentId);
    const transaction = intentDetail?.transactions.find((t) => t.isVerified);
    if (!transaction) {
      throw new NotFoundException('No verified payment transaction found for this order');
    }

    await this.refunds.requestRefund({
      paymentTransactionId: transaction.id,
      amount,
      reason: reason ?? undefined,
      requestedBy: actorUserId,
      idempotencyKey: `order-partial-refund__${orderId}__${amount.toString()}`,
    });

    const updated = await this.orders.updatePaymentState(orderId, {
      paymentStatus: 'PARTIALLY_REFUNDED',
      paidTotal: detail.order.paidTotal,
      refundedTotal: detail.order.refundedTotal + amount,
    });
    await this.auditLog.record({
      actorId: actorUserId,
      action: 'ORDER_REFUND_REQUESTED',
      entityType: 'Order',
      entityId: orderId,
      newValue: { amount: amount.toString(), reason: reason ?? null },
    });
    return updated;
  }

  /**
   * ADR-012 — called by `ReturnService.refund()`, and nothing else,
   * after a return-triggered `Refund` is successfully requested via
   * `RefundService.requestRefund()` — keeps `Order`'s cached
   * `paymentStatus`/`refundedTotal` columns in sync with the real
   * refund, the same "cache read alongside status, never independently
   * authoritative" discipline `updatePaymentState()` already establishes
   * for `requestPartialRefund()` above. Never creates a `Refund` itself
   * — that already happened; this only updates the cache, so a
   * return-triggered refund is visible on the order the same way an
   * admin-triggered partial refund already is. Deliberately not called
   * for a `CREDIT_NOTE`-resolution return: a credit note is a separate,
   * non-payment-method adjustment (ADR-012 decision 7's own point) —
   * `Order.refundedTotal` reflects real payment-method money movement
   * only.
   */
  async recordReturnRefund(orderId: string, additionalRefundedAmount: bigint): Promise<Order> {
    const detail = await this.getForAdmin(orderId);
    const refundedTotal = detail.order.refundedTotal + additionalRefundedAmount;
    const paymentStatus: OrderPaymentStatus =
      refundedTotal >= detail.order.paidTotal ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    return this.orders.updatePaymentState(orderId, {
      paymentStatus,
      paidTotal: detail.order.paidTotal,
      refundedTotal,
    });
  }
}
