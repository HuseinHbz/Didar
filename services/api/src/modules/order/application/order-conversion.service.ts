import { asProductSkuId } from '@iecp/types';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { CheckoutService } from '../../cart-checkout/application/checkout.service';
import { ProductsService } from '../../catalog/application/products.service';
import { SkusService } from '../../catalog/application/skus.service';
import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import { PaymentIntentService } from '../../payment/application/payment-intent.service';
import { CouponRedemptionService } from '../../promotion/application/coupon-redemption.service';
import type { Order } from '../domain/entities/order.entity';
import { ORDER_REPOSITORY, type OrderRepositoryPort } from '../domain/ports/order.repository.port';

import { InvoiceService } from './invoice.service';
import { OrderAllocationService } from './order-allocation.service';
import { OrderExceptionService } from './order-exception.service';

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
    private readonly allocation: OrderAllocationService,
    private readonly exceptions: OrderExceptionService,
    private readonly skus: SkusService,
    private readonly products: ProductsService,
    private readonly invoices: InvoiceService,
    private readonly couponRedemption: CouponRedemptionService,
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

    // Phase 010 (ADR-010 decision 7/11) — copy the checkout's frozen
    // promotion/coupon resolution into immutable `OrderPromotion` rows,
    // once, at genuine order creation (never on a resumed/retried call —
    // `existingOrder` already guards `orders.create()` itself the same
    // way). Never recalculated against today's promotion rules.
    if (!existingOrder) {
      const appliedPromotions =
        (session.pricingSnapshot?.['appliedPromotions'] as
          | {
              promotionId: string;
              promotionName: string;
              couponId: string | null;
              couponCode: string | null;
              discountType: string;
              discountAmount: string;
              affectedProductSkuIds: string[];
            }[]
          | undefined) ?? [];
      if (appliedPromotions.length > 0) {
        const detail = await this.orders.findById(order.id);
        const orderItemIdBySku = new Map<string, string>();
        for (const item of detail?.items ?? []) {
          if (item.productSkuId) orderItemIdBySku.set(item.productSkuId, item.id);
        }
        await this.orders.addPromotions(
          order.id,
          appliedPromotions.map((promotion) => ({
            promotionId: promotion.promotionId,
            promotionName: promotion.promotionName,
            couponId: promotion.couponId,
            couponCode: promotion.couponCode,
            discountType: promotion.discountType,
            discountAmount: BigInt(promotion.discountAmount),
            affectedItemIds: promotion.affectedProductSkuIds.map(
              (skuId) => orderItemIdBySku.get(skuId) ?? skuId,
            ),
          })),
        );
      }
    }

    // Allocate stock for every line (CP-031, gap P0-5). The customer has paid,
    // so the order is created either way — but a PAID order must never exist
    // with no stock behind it and nobody knowing. Each line's units are taken
    // out of the warehouse exactly once (the checkout's own reservation if it
    // still holds them, otherwise re-acquired afresh); a line whose stock is
    // genuinely gone opens a STOCK_SHORTFALL `OrderException`, which blocks
    // `approve` until an operator allocates or cancels. The previous loop
    // converted only still-ACTIVE reservations and logged-and-ignored every
    // other outcome — including a failed convert — so a lapsed checkout
    // produced a PAID, approvable order with zero SALE rows.
    //
    // Unexpected failures (database down…) are deliberately NOT caught: the
    // call fails, the order stays PENDING_PAYMENT, and the order_conversion
    // sweep resumes it — every step below is idempotent.
    for (const checkoutReservation of checkoutDetail.reservations) {
      const outcome = await this.allocation.allocateLine({
        orderId: order.id,
        productSkuId: checkoutReservation.productSkuId,
        quantity: checkoutReservation.quantity,
        checkoutReservationId: checkoutReservation.inventoryReservationId,
      });
      if (outcome.kind === 'SHORT') {
        await this.exceptions.openStockShortfall({
          orderId: order.id,
          productSkuId: checkoutReservation.productSkuId,
          requestedQuantity: checkoutReservation.quantity,
          reason: outcome.reason,
          checkoutReservationId: checkoutReservation.inventoryReservationId,
        });
      } else if (existingOrder) {
        // A resumed conversion: a shortfall recorded by the earlier attempt
        // may have been fixed since (stock arrived). Close it.
        await this.exceptions.markAllocated(order.id, checkoutReservation.productSkuId);
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

    // ADR-010 decision 7/8 — every `RESERVED` coupon/promotion redemption
    // this checkout holds becomes `REDEEMED`, `orderId` set. Idempotent
    // (`updateMany` against `status = 'RESERVED'` only): a resumed/
    // retried conversion attempt finds nothing left to finalize.
    await this.couponRedemption.finalize(checkoutSessionId, order.id);

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
