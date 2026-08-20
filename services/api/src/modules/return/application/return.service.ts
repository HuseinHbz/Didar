import { prisma } from '@iecp/database';
import type { ReturnItemCondition, ReturnReason, ReturnResolution } from '@iecp/types';
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import { AdjustmentService } from '../../inventory/application/adjustment.service';
import { FulfillmentService } from '../../order/application/fulfillment.service';
import { InvoiceService } from '../../order/application/invoice.service';
import { type OrderActor, OrderService } from '../../order/application/order.service';
import { PaymentIntentService } from '../../payment/application/payment-intent.service';
import { RefundService } from '../../payment/application/refund.service';
import type { ReturnItem } from '../domain/entities/return-item.entity';
import type { ReturnRequest } from '../domain/entities/return-request.entity';
import {
  RETURN_REPOSITORY,
  type ReturnListFilter,
  type ReturnRepositoryPort,
  type ReturnRequestWithDetail,
} from '../domain/ports/return.repository.port';
import { RefundAmountCalculator } from '../domain/services/refund-amount-calculator';
import { ReturnEligibilityValidator } from '../domain/services/return-eligibility-validator';
import { ReturnStateMachine } from '../domain/services/return-state-machine';

import { CreditNoteService } from './credit-note.service';

const RETURN_WINDOW_SETTING_KEY = 'returns.window_days';
const FALLBACK_RETURN_WINDOW_DAYS = 30;

/** Conditions the physical goods can be in and still go back on the
 * shelf — `DAMAGED`/`DEFECTIVE` never restock (ADR-012 decision 6's own
 * "rejected returns must NOT increase available inventory" requirement,
 * applied at the per-item level even inside an otherwise-accepted
 * return: a damaged unit is still refunded, per policy, but never
 * resold). A real, documented business-rule choice, not an oversight. */
const RESTOCKABLE_CONDITIONS: readonly ReturnItemCondition[] = ['UNOPENED', 'OPENED_UNUSED'];

interface SettlementLine {
  returnItemId: string;
  orderItemId: string;
  amount: bigint;
}

/**
 * Orchestrates the return lifecycle end to end (ADR-012 decision 1) —
 * reaches `Order`/`Invoice`/`Fulfillment` only through `OrderModule`'s
 * exports (decision 2), triggers settlement only through the existing
 * `RefundService`/`CreditNoteService` pathways (never a second refund
 * pathway), and restocks only through `AdjustmentService
 * .receiveReturnedStock()` (decision 6). Every privileged mutation
 * writes its own `system.AuditLog` entry — this module has no internal
 * audit logging to retrofit, same "caller writes the audit entry"
 * convention `OrderService` already established.
 */
@Injectable()
export class ReturnService {
  constructor(
    @Inject(RETURN_REPOSITORY) private readonly returns: ReturnRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
    private readonly orders: OrderService,
    private readonly invoices: InvoiceService,
    private readonly fulfillments: FulfillmentService,
    private readonly payments: PaymentIntentService,
    private readonly refunds: RefundService,
    private readonly adjustments: AdjustmentService,
    private readonly creditNotes: CreditNoteService,
  ) {}

  async get(id: string, actor: OrderActor): Promise<ReturnRequestWithDetail> {
    const detail = await this.returns.findById(id);
    if (!detail) throw new NotFoundException('Return not found');
    this.assertOwnership(detail.request, actor);
    return detail;
  }

  /** Admin/support read — no ownership check, gated entirely by
   * `@RequirePermission('return.read')` on the admin route. */
  async getForAdmin(id: string): Promise<ReturnRequestWithDetail> {
    const detail = await this.returns.findById(id);
    if (!detail) throw new NotFoundException('Return not found');
    return detail;
  }

  /** Same IDOR-protection shape `OrderService.assertOwnership()`
   * already establishes. */
  private assertOwnership(request: ReturnRequest, actor: OrderActor): void {
    if (request.customerId) {
      if (request.customerId !== actor.customerId) {
        throw new ForbiddenException('This return does not belong to the current customer');
      }
      return;
    }
    if (request.guestToken && request.guestToken !== actor.guestToken) {
      throw new ForbiddenException('This return does not belong to the current guest session');
    }
  }

  async list(actor: OrderActor, limit: number, cursor?: string | null) {
    const filter: ReturnListFilter = actor.customerId
      ? { customerId: actor.customerId, limit, cursor }
      : { guestToken: actor.guestToken ?? undefined, limit, cursor };
    return this.returns.list(filter);
  }

  async listForAdmin(filter: ReturnListFilter) {
    return this.returns.list(filter);
  }

  /** Same `Setting`-plus-documented-fallback pattern
   * `CartPricingService.getMaxQuantityPerLine()` already established. */
  private async getReturnWindowDays(): Promise<number> {
    const setting = await prisma.setting.findUnique({ where: { key: RETURN_WINDOW_SETTING_KEY } });
    if (!setting) return FALLBACK_RETURN_WINDOW_DAYS;
    return Number(setting.value);
  }

  /** `POST /returns` — customer/guest-facing. Eligibility is checked
   * entirely against server-known facts (ADR-012 decision 3); the
   * quantity invariant is enforced transactionally by
   * `PrismaReturnRepository.create()`, not here (decision 5). */
  async create(
    actor: OrderActor,
    input: {
      orderId: string;
      reason: ReturnReason;
      reasonNote?: string | null;
      resolution?: ReturnResolution;
      items: readonly { orderItemId: string; quantity: number }[];
      idempotencyKey?: string | null;
    },
  ): Promise<ReturnRequest> {
    const orderDetail = await this.orders.get(input.orderId, actor);
    const orderItemIds = new Set(orderDetail.items.map((item) => item.id as string));
    for (const item of input.items) {
      if (!orderItemIds.has(item.orderItemId)) {
        throw new ForbiddenException(
          `Order item ${item.orderItemId} does not belong to this order`,
        );
      }
    }

    const fulfillmentDetails = await this.fulfillments.listByOrder(input.orderId);
    const deliveredAtByOrderItem = new Map<string, Date | null>();
    for (const detail of fulfillmentDetails) {
      if (detail.fulfillment.status !== 'DELIVERED') continue;
      for (const fulfillmentItem of detail.items) {
        deliveredAtByOrderItem.set(fulfillmentItem.orderItemId, detail.fulfillment.deliveredAt);
      }
    }

    const windowDays = await this.getReturnWindowDays();
    ReturnEligibilityValidator.assertEligible({
      orderStatus: orderDetail.order.status,
      orderPaymentStatus: orderDetail.order.paymentStatus,
      items: input.items.map((item) => ({
        orderItemId: item.orderItemId,
        deliveredAt: deliveredAtByOrderItem.get(item.orderItemId) ?? null,
      })),
      windowDays,
      now: new Date(),
    });

    const created = await this.returns.create({
      orderId: input.orderId,
      customerId: actor.customerId,
      guestToken: actor.guestToken,
      reason: input.reason,
      reasonNote: input.reasonNote,
      resolution: input.resolution,
      items: input.items,
      idempotencyKey: input.idempotencyKey,
    });

    await this.auditLog.record({
      actorId: actor.customerId,
      action: 'RETURN_REQUESTED',
      entityType: 'ReturnRequest',
      entityId: created.id,
      newValue: { orderId: input.orderId, reason: input.reason, items: input.items },
    });
    return created;
  }

  /** `POST /admin/returns/:id/approve` (`return.approve`) —
   * `REQUESTED -> APPROVED`. */
  async approve(id: string, actorUserId: string): Promise<ReturnRequest> {
    const result = await this.returns.updateStatus(id, 'APPROVED', actorUserId);
    if (result.transitioned) {
      await this.auditLog.record({
        actorId: actorUserId,
        action: 'RETURN_APPROVED',
        entityType: 'ReturnRequest',
        entityId: id,
      });
    }
    return result.entity;
  }

  /** `POST /admin/returns/:id/reject` (`return.reject`) — reachable from
   * `REQUESTED`/`APPROVED`/`INSPECTING` (ADR-012 decision 1). */
  async reject(id: string, actorUserId: string, reason: string): Promise<ReturnRequest> {
    const result = await this.returns.updateStatus(id, 'REJECTED', actorUserId, reason, {
      rejectionReason: reason,
      rejectedAt: new Date(),
    });
    if (result.transitioned) {
      await this.auditLog.record({
        actorId: actorUserId,
        action: 'RETURN_REJECTED',
        entityType: 'ReturnRequest',
        entityId: id,
        newValue: { reason },
      });
    }
    return result.entity;
  }

  /** `POST /returns/:id/cancel` — customer-facing, ownership-gated, no
   * RBAC permission consumed (the customer's own withdrawal option,
   * same shape `return.cancel` was deliberately *not* registered as a
   * permission for). Idempotent via `ReturnStateMachine.isNoOp`. */
  async cancel(id: string, actor: OrderActor): Promise<ReturnRequest> {
    const detail = await this.get(id, actor);
    if (ReturnStateMachine.isNoOp(detail.request.status, 'CANCELLED')) return detail.request;
    if (!ReturnStateMachine.isCancellable(detail.request.status)) {
      ReturnStateMachine.assertTransition(detail.request.status, 'CANCELLED');
    }
    const result = await this.returns.updateStatus(
      id,
      'CANCELLED',
      actor.customerId,
      'Cancelled by customer',
      { cancelledAt: new Date() },
    );
    if (result.transitioned) {
      await this.auditLog.record({
        actorId: actor.customerId,
        action: 'RETURN_CANCELLED',
        entityType: 'ReturnRequest',
        entityId: id,
      });
    }
    return result.entity;
  }

  /** `POST /returns/:id/ship` — customer-facing, ownership-gated, no
   * RBAC permission consumed: the customer marking their own return as
   * shipped back is not an admin/financial action. */
  async markShipped(id: string, actor: OrderActor): Promise<ReturnRequest> {
    await this.get(id, actor);
    const result = await this.returns.updateStatus(id, 'CUSTOMER_SHIPPING', actor.customerId);
    if (result.transitioned) {
      await this.auditLog.record({
        actorId: actor.customerId,
        action: 'RETURN_CUSTOMER_SHIPPED',
        entityType: 'ReturnRequest',
        entityId: id,
      });
    }
    return result.entity;
  }

  /** `POST /admin/returns/:id/receive` (`return.receive`) —
   * `CUSTOMER_SHIPPING -> RECEIVED`. `warehouseId`/`locationId` are the
   * real, present-tense receiving location an operator enters, never a
   * guess (ADR-012 decision 6). */
  async receive(
    id: string,
    actorUserId: string,
    warehouseId: string,
    locationId: string,
  ): Promise<ReturnRequest> {
    const result = await this.returns.updateStatus(id, 'RECEIVED', actorUserId, null, {
      warehouseId,
      locationId,
      receivedAt: new Date(),
    });
    if (result.transitioned) {
      await this.auditLog.record({
        actorId: actorUserId,
        action: 'RETURN_RECEIVED',
        entityType: 'ReturnRequest',
        entityId: id,
        newValue: { warehouseId, locationId },
      });
    }
    return result.entity;
  }

  /** `POST /admin/returns/:id/inspect` (`return.inspect`) —
   * `RECEIVED -> INSPECTING`. Records each item's physical `condition`
   * and its server-computed `refundAmount` in the same call — the
   * refund amount is a pure function of what was ordered and already
   * returned (`RefundAmountCalculator`), independent of the accept/
   * reject decision that follows (`return-item.entity.ts`'s own doc
   * comment). */
  async inspect(
    id: string,
    actorUserId: string,
    items: readonly { returnItemId: string; condition: ReturnItemCondition }[],
  ): Promise<ReturnRequest> {
    const detail = await this.getForAdmin(id);
    const result = await this.returns.updateStatus(id, 'INSPECTING', actorUserId, null, {
      inspectedAt: new Date(),
    });
    if (!result.transitioned) return result.entity;

    const orderDetail = await this.orders.getForAdmin(detail.request.orderId);
    const orderItemById = new Map(orderDetail.items.map((item) => [item.id as string, item]));
    const returnItemById = new Map(detail.items.map((item) => [item.id as string, item]));

    const recorded: {
      returnItemId: string;
      condition: ReturnItemCondition;
      refundAmount: bigint;
    }[] = [];
    for (const input of items) {
      const returnItem = returnItemById.get(input.returnItemId);
      if (!returnItem) continue;
      const orderItem = orderItemById.get(returnItem.orderItemId);
      if (!orderItem) continue;

      const totalPayable = RefundAmountCalculator.lineTotalPayable(
        orderItem.lineTotal,
        orderItem.discountAmount,
        orderItem.taxAmount,
      );
      const alreadyReturnedQuantity = await this.returns.sumReturnedQuantity(orderItem.id);
      const refundAmount = RefundAmountCalculator.amountForReturnedUnits(
        totalPayable,
        orderItem.quantity,
        Math.max(0, alreadyReturnedQuantity - returnItem.quantity),
        returnItem.quantity,
      );
      recorded.push({ returnItemId: input.returnItemId, condition: input.condition, refundAmount });
    }
    await this.returns.recordInspection(id, recorded);

    await this.auditLog.record({
      actorId: actorUserId,
      action: 'RETURN_INSPECTED',
      entityType: 'ReturnRequest',
      entityId: id,
      newValue: { items: recorded.map((r) => ({ ...r, refundAmount: r.refundAmount.toString() })) },
    });
    return result.entity;
  }

  /** Builds the per-`ReturnItem` settlement breakdown (already computed
   * at `inspect()` time) plus whether the order's shipping charge is
   * included — only on a full-order return (ADR-012 decision 4). Shared
   * by `approveForRefund()` (to draft a `CreditNote`) and `refund()` (to
   * build a `Refund`'s lines). */
  private async computeSettlement(
    detail: ReturnRequestWithDetail,
  ): Promise<{
    lines: SettlementLine[];
    lineTotal: bigint;
    shippingAmount: bigint;
    totalAmount: bigint;
  }> {
    const lines: SettlementLine[] = detail.items
      .filter((item): item is ReturnItem & { refundAmount: bigint } => item.refundAmount !== null)
      .map((item) => ({
        returnItemId: item.id,
        orderItemId: item.orderItemId,
        amount: item.refundAmount,
      }));
    const lineTotal = lines.reduce((sum, line) => sum + line.amount, 0n);

    const orderDetail = await this.orders.getForAdmin(detail.request.orderId);
    const returnedAfter = await Promise.all(
      orderDetail.items.map(async (orderItem) => ({
        orderedQuantity: orderItem.quantity,
        returnedQuantityAfterThisRequest: await this.returns.sumReturnedQuantity(orderItem.id),
      })),
    );
    const includeShipping = RefundAmountCalculator.isFullOrderReturn(returnedAfter);
    const shippingAmount = includeShipping ? orderDetail.order.shippingTotal : 0n;
    return { lines, lineTotal, shippingAmount, totalAmount: lineTotal + shippingAmount };
  }

  /**
   * `POST /admin/returns/:id/approve-refund` (`return.refund`) —
   * `INSPECTING -> APPROVED_FOR_REFUND`. Restocks every accepted
   * (sellable-condition) `ReturnItem` — once, only when this call
   * actually wins the row lock (`transitioned: true`) — and, for a
   * `CREDIT_NOTE` resolution, drafts the `CreditNote` now (ADR-012
   * decisions 6/7). Never restocks a `productSkuId`-less line (the
   * catalog SKU was deleted since — a known limitation, not silently
   * swallowed) or one with no receiving location captured.
   */
  async approveForRefund(id: string, actorUserId: string): Promise<ReturnRequest> {
    const detail = await this.getForAdmin(id);
    const result = await this.returns.updateStatus(id, 'APPROVED_FOR_REFUND', actorUserId);
    if (!result.transitioned) return result.entity;

    const orderDetail = await this.orders.getForAdmin(detail.request.orderId);
    const orderItemById = new Map(orderDetail.items.map((item) => [item.id as string, item]));

    for (const item of detail.items) {
      if (!item.condition || !RESTOCKABLE_CONDITIONS.includes(item.condition)) continue;
      const orderItem = orderItemById.get(item.orderItemId);
      if (!orderItem?.productSkuId || !detail.request.warehouseId || !detail.request.locationId) {
        continue;
      }
      await this.adjustments.receiveReturnedStock({
        productSkuId: orderItem.productSkuId,
        warehouseId: detail.request.warehouseId,
        locationId: detail.request.locationId,
        quantity: item.quantity,
        returnRequestId: id,
        returnItemId: item.id,
        actorUserId,
      });
    }

    if (detail.request.resolution === 'CREDIT_NOTE') {
      const settlement = await this.computeSettlement(detail);
      const invoice = await this.invoices.getByOrderId(detail.request.orderId);
      await this.creditNotes.createDraftForReturn({
        orderId: detail.request.orderId,
        returnRequestId: id,
        invoiceId: invoice?.invoice.id ?? null,
        customerId: detail.request.customerId,
        currency: orderDetail.order.currency,
        subtotal: settlement.lineTotal,
        taxTotal: 0n,
        discountTotal: 0n,
        grandTotal: settlement.totalAmount,
        refundableAmount: settlement.totalAmount,
        lines: settlement.lines.map((line) => ({
          description: `Refund for order item ${line.orderItemId}`,
          quantity: 1,
          unitPrice: line.amount,
          lineTotal: line.amount,
        })),
      });
    }

    await this.auditLog.record({
      actorId: actorUserId,
      action: 'RETURN_APPROVED_FOR_REFUND',
      entityType: 'ReturnRequest',
      entityId: id,
    });
    return result.entity;
  }

  /**
   * `POST /admin/returns/:id/refund` (`return.refund`) —
   * `APPROVED_FOR_REFUND -> REFUNDED`. Creates the settlement *before*
   * transitioning status, not after: `RefundService.requestRefund()` is
   * idempotent on a deterministic `return-refund__${id}` key (ADR-012
   * decision 9), so a retry after a crash between the two steps safely
   * resolves to the same row rather than duplicating it, then completes
   * the status transition. For `CREDIT_NOTE` resolution, issues the
   * `DRAFT` note `approveForRefund()` already created — `issue()`'s own
   * `CreditNoteStateMachine.isNoOp` gives the same retry-safety without
   * needing a separate key.
   */
  async refund(id: string, actorUserId: string): Promise<ReturnRequest> {
    const detail = await this.getForAdmin(id);
    if (ReturnStateMachine.isNoOp(detail.request.status, 'REFUNDED')) return detail.request;
    ReturnStateMachine.assertTransition(detail.request.status, 'REFUNDED');

    let settlementAmount = 0n;
    if (detail.request.resolution === 'CREDIT_NOTE') {
      const notes = await this.creditNotes.listByReturnRequestId(id);
      const draft = notes.find((note) => note.status === 'DRAFT') ?? notes[0];
      if (!draft) throw new NotFoundException('No credit note found for this return');
      await this.creditNotes.issue(draft.id, actorUserId);
      settlementAmount = draft.grandTotal;
    } else {
      const settlement = await this.computeSettlement(detail);
      const orderDetail = await this.orders.getForAdmin(detail.request.orderId);
      const intentDetail = await this.payments.findById(orderDetail.order.paymentIntentId);
      const transaction = intentDetail?.transactions.find((t) => t.isVerified);
      if (!transaction) {
        throw new NotFoundException('No verified payment transaction found for this order');
      }
      await this.refunds.requestRefund({
        paymentTransactionId: transaction.id,
        amount: settlement.totalAmount,
        reason: `Return ${detail.request.returnNumber}`,
        requestedBy: actorUserId,
        idempotencyKey: `return-refund__${id}`,
        returnRequestId: id,
        lines: settlement.lines.map((line) => ({
          returnItemId: line.returnItemId,
          amount: line.amount,
        })),
      });
      settlementAmount = settlement.totalAmount;
    }

    const result = await this.returns.updateStatus(id, 'REFUNDED', actorUserId, null, {
      refundedAt: new Date(),
    });
    if (result.transitioned) {
      await this.auditLog.record({
        actorId: actorUserId,
        action: 'RETURN_REFUNDED',
        entityType: 'ReturnRequest',
        entityId: id,
        newValue: { resolution: detail.request.resolution, amount: settlementAmount.toString() },
      });
    }
    return result.entity;
  }
}
