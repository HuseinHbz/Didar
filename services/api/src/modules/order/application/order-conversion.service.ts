import { asProductSkuId } from '@iecp/types';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { CheckoutService } from '../../cart-checkout/application/checkout.service';
import { ProductsService } from '../../catalog/application/products.service';
import { SkusService } from '../../catalog/application/skus.service';
import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import { ReservationService } from '../../inventory/application/reservation.service';
import { PaymentIntentService } from '../../payment/application/payment-intent.service';
import type { Order } from '../domain/entities/order.entity';
import { ORDER_REPOSITORY, type OrderRepositoryPort } from '../domain/ports/order.repository.port';

import { InvoiceService } from './invoice.service';

/**
 * ADR-009 decision 4 — the single place an `Order` is ever created.
 * Called two ways: synchronously from `OrderController.getByCheckout()`
 * — the route a customer's post-payment redirect lands on, which calls
 * this before reading the order back so the very first request after a
 * successful payment already sees it, not just the next poll — and from
 * the `order_conversion` sweep as a reliability backstop for a customer
 * who never returns to trigger anything synchronously (`PaymentIntentController`
 * itself never calls this — Payment has no reason to reach forward into
 * Order). Both paths call this exact method, never two diverging
 * implementations.
 * `convertFromCheckout` also resumes cleanly if a prior call crashed
 * between `orders.create()` and `checkout.markConverted()` — an existing
 * order still `PENDING_PAYMENT` is treated as unfinished, not done, and
 * the method falls through to complete the remaining steps on it rather
 * than returning it stuck (see that method's own inline comment).
 */
@Injectable()
export class OrderConversionService {
  private readonly logger = new Logger(OrderConversionService.name);

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
    private readonly checkout: CheckoutService,
    private readonly payments: PaymentIntentService,
    private readonly reservations: ReservationService,
    private readonly skus: SkusService,
    private readonly products: ProductsService,
    private readonly invoices: InvoiceService,
  ) {}

  /**
   * Returns the existing/newly-created `Order`, or `null` when the
   * checkout hasn't actually verified a payment yet (not an error — the
   * caller, whether the presentation layer or the sweep, simply has
   * nothing to do this time). Never allows an `Order` to become `PAID`
   * merely because a client says so (instruction #15): the only signal
   * this method trusts is `PaymentIntent.status === 'SUCCEEDED'` backed by
   * a real `VERIFIED` `PaymentTransaction`, both written entirely by
   * Phase 008's own `PaymentIntentService.verifyPayment()`, never by
   * anything in this method.
   */
  async convertFromCheckout(checkoutSessionId: string): Promise<Order | null> {
    const existingOrder = await this.orders.findByCheckoutSessionId(checkoutSessionId);
    // Genuinely done: the PAID transition below already ran for this order
    // on a prior call. Return immediately — the fast, common path.
    if (existingOrder && existingOrder.status !== 'PENDING_PAYMENT') return existingOrder;
    // `existingOrder` here is either null (first attempt) or a real but
    // *stuck* row: `orders.create()` below succeeded on an earlier call,
    // but the process crashed before reaching `checkout.markConverted()`
    // at the end of this method — so a retry (or the `order_conversion`
    // sweep) lands back here with the checkout still not CONVERTED. Fall
    // through and resume from wherever it stopped, reusing the existing
    // order row instead of creating a second one, so this method's own
    // doc comment ("idempotent... both paths call this exact method")
    // stays true even across a mid-flight crash, not just for a clean
    // second call.

    const intentDetail = await this.payments.findByCheckoutSessionId(checkoutSessionId);
    if (intentDetail?.intent.status !== 'SUCCEEDED') return existingOrder ?? null;

    const verifiedTransaction = intentDetail.transactions.find((t) => t.isVerified);
    if (!verifiedTransaction) return existingOrder ?? null;

    const checkoutDetail = await this.checkout.findByIdSystem(checkoutSessionId);
    if (!checkoutDetail) {
      this.logger.warn(
        `checkout_session_missing_for_verified_payment checkoutSessionId=${checkoutSessionId}`,
      );
      return existingOrder ?? null;
    }
    const { session } = checkoutDetail;

    const items = [];
    for (const reservation of checkoutDetail.reservations) {
      const line = checkoutDetail.latestTotals?.breakdown.find(
        (b) => b.productSkuId === reservation.productSkuId,
      );
      const sku = await this.skus.get(asProductSkuId(reservation.productSkuId)).catch(() => null);
      const product = sku ? await this.products.get(sku.productId).catch(() => null) : null;
      items.push({
        productSkuId: reservation.productSkuId,
        skuSnapshot: sku?.skuCode ?? reservation.productSkuId,
        nameSnapshot: product?.name ?? reservation.productSkuId,
        unitPriceSnapshot: line?.resolvedUnitPrice ?? 0n,
        quantity: reservation.quantity,
        discountAmount: line?.lineDiscount ?? 0n,
        taxAmount: line?.lineTax ?? 0n,
        lineTotal: line?.lineSubtotal ?? 0n,
      });
    }

    const order =
      existingOrder ??
      (await this.orders.create({
        checkoutSessionId,
        paymentIntentId: intentDetail.intent.id,
        customerId: session.customerId,
        guestToken: session.guestToken,
        source: 'STOREFRONT',
        currency: session.currency,
        subtotal: session.subtotal,
        discountTotal: session.discountTotal,
        taxTotal: session.taxTotal,
        shippingTotal: session.shippingTotal,
        grandTotal: session.grandTotal,
        shippingAddressSnapshot: session.addressSnapshot ?? {},
        items,
      }));

    // Reconcile inventory reservation -> allocation (ADR-009 decision 4
    // step 4). Skipped defensively for any reservation already CONVERTED
    // so a retried/duplicate conversion attempt never double-consumes
    // stock (the order-creation race above always collapses to one
    // Order, but this loop still runs again on that same call).
    for (const checkoutReservation of checkoutDetail.reservations) {
      const reservation = await this.reservations
        .get(checkoutReservation.inventoryReservationId)
        .catch(() => null);
      if (reservation?.status === 'ACTIVE') {
        await this.reservations
          .convert(checkoutReservation.inventoryReservationId, null, {
            referenceType: 'ORDER',
            referenceId: order.id,
          })
          .catch((error: unknown) => {
            this.logger.warn(
              `reservation_convert_failed orderId=${order.id} reservationId=${checkoutReservation.inventoryReservationId} error=${String(error)}`,
            );
          });
      }
    }

    const paidOrder = await this.orders.updateStatus(
      order.id,
      'PAID',
      null,
      'Payment verified — order marked PAID',
    );
    await this.orders.updatePaymentState(order.id, {
      paymentStatus: 'PAID',
      paidTotal: verifiedTransaction.amount,
      refundedTotal: 0n,
    });

    await this.invoices.issueForOrder({
      orderId: order.id,
      customerId: session.customerId,
      currency: order.currency,
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      taxTotal: order.taxTotal,
      shippingTotal: order.shippingTotal,
      grandTotal: order.grandTotal,
      items: items.map((item) => ({
        description: item.nameSnapshot,
        quantity: item.quantity,
        unitPrice: item.unitPriceSnapshot,
        lineTotal: item.lineTotal,
      })),
    });

    await this.checkout.markConverted(checkoutSessionId);

    await this.auditLog.record({
      actorId: null,
      action: 'ORDER_CREATED',
      entityType: 'Order',
      entityId: order.id,
      newValue: { orderNumber: order.orderNumber, grandTotal: order.grandTotal.toString() },
    });

    return paidOrder;
  }
}
