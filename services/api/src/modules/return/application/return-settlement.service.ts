import type { ReturnItemCondition } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import { AdjustmentService } from '../../inventory/application/adjustment.service';
import { InvoiceService } from '../../order/application/invoice.service';
import { OrderService } from '../../order/application/order.service';
import { PaymentIntentService } from '../../payment/application/payment-intent.service';
import { RefundService } from '../../payment/application/refund.service';
import {
  NonPositiveRefundAmountError,
  RefundExceedsTransactionAmountError,
} from '../../payment/domain/services/refund-validator';
import type { ReturnItem } from '../domain/entities/return-item.entity';
import type { ReturnSettlement } from '../domain/entities/return-settlement.entity';
import {
  RETURN_SETTLEMENT_REPOSITORY,
  type ReturnSettlementRepositoryPort,
} from '../domain/ports/return-settlement.repository.port';
import {
  RETURN_REPOSITORY,
  type ReturnRepositoryPort,
  type ReturnRequestWithDetail,
} from '../domain/ports/return.repository.port';
import { InvalidCreditNoteTransitionError } from '../domain/services/credit-note-state-machine';
import {
  CreditNoteExceedsRefundableAmountError,
  CreditNoteGrandTotalMismatchError,
  CreditNoteLineSumMismatchError,
  NonPositiveCreditNoteAmountError,
} from '../domain/services/credit-note-validator';
import { RefundAmountCalculator } from '../domain/services/refund-amount-calculator';
import {
  NonPositiveReturnQuantityError,
  OverReturnedError,
} from '../domain/services/return-quantity-validator';
import {
  MissingImmutableSnapshotError,
  NonPositiveRestockQuantityError,
  ReturnSettlementInvariants,
} from '../domain/services/return-settlement-invariants';
import {
  InvalidReturnSettlementTransitionError,
  ReturnSettlementStateMachine,
} from '../domain/services/return-settlement-state-machine';
import { InvalidReturnTransitionError } from '../domain/services/return-state-machine';

import { CreditNoteService } from './credit-note.service';

/** Same "physical condition determines resalability" rule ADR-012
 * decision 6 established — a damaged/defective/used unit is still
 * refunded, per policy, but never restocked. Duplicated here (not
 * imported from `ReturnService`) because it belongs to the restock
 * step this class now owns; kept identical on purpose. */
const RESTOCKABLE_CONDITIONS: readonly ReturnItemCondition[] = ['UNOPENED', 'OPENED_UNUSED'];

interface SettlementLine {
  returnItemId: string;
  orderItemId: string;
  amount: bigint;
}

/**
 * ADR-013 — the durable orchestration for everything that happens after
 * a return reaches `APPROVED_FOR_REFUND`: restocking eligible items and
 * requesting the actual money settlement (a real `Refund` or a
 * `CreditNote`). Every method here is safe to call any number of times,
 * concurrently, from the synchronous admin-triggered HTTP path *or* the
 * `return_settlement_recovery` sweep — the same idempotent code path
 * either way, never a separate "repair" branch with its own logic to
 * keep correct.
 *
 * Reaches settlement (`RefundService`/`CreditNoteService`) and restock
 * (`AdjustmentService`) only through the existing, single pathways for
 * each — this class introduces no new way to move money or mutate
 * inventory, only a durable record of *when* those existing pathways
 * were asked to run.
 */
@Injectable()
export class ReturnSettlementService {
  constructor(
    @Inject(RETURN_REPOSITORY) private readonly returns: ReturnRepositoryPort,
    @Inject(RETURN_SETTLEMENT_REPOSITORY)
    private readonly settlements: ReturnSettlementRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
    private readonly orders: OrderService,
    private readonly invoices: InvoiceService,
    private readonly payments: PaymentIntentService,
    private readonly refunds: RefundService,
    private readonly adjustments: AdjustmentService,
    private readonly creditNotes: CreditNoteService,
  ) {}

  async get(returnRequestId: string): Promise<ReturnSettlement | null> {
    return this.settlements.findByReturnRequestId(returnRequestId);
  }

  async getForAdmin(returnRequestId: string): Promise<ReturnSettlement> {
    const settlement = await this.settlements.findByReturnRequestId(returnRequestId);
    if (!settlement) throw new NotFoundException('No settlement exists for this return');
    return settlement;
  }

  async listActive(staleSince?: Date): Promise<ReturnSettlement[]> {
    return this.settlements.listActive(staleSince);
  }

  async listManualReview(): Promise<ReturnSettlement[]> {
    return this.settlements.listManualReview();
  }

  /** Called once, from `ReturnService.approveForRefund()`'s own
   * `transitioned: true` branch — idempotent via the real `@unique`
   * `returnRequestId` FK, safe even if that guard were ever bypassed by
   * a future code path or a reconciliation repair (ADR-013 §9
   * pattern 1). */
  async ensureSettlement(returnRequestId: string): Promise<ReturnSettlement> {
    return this.settlements.create(returnRequestId);
  }

  /**
   * The restock phase (ADR-013 decision 6). Only ever does real work
   * when the settlement is exactly `PENDING_RESTOCK` — any other status
   * means restock already happened, is not yet applicable, or the
   * settlement has stopped for a reason this method has no business
   * overriding (`FAILED_TERMINAL`/`MANUAL_REVIEW`), so every other
   * status is a safe no-op return, never an error.
   */
  async beginRestock(
    returnRequestId: string,
    actorUserId: string | null,
  ): Promise<ReturnSettlement> {
    const settlement = await this.settlements.findByReturnRequestId(returnRequestId);
    if (!settlement) {
      throw new NotFoundException(`No settlement exists for return ${returnRequestId}`);
    }
    if (settlement.status !== 'PENDING_RESTOCK') {
      return settlement;
    }

    try {
      const detail = await this.returns.findById(returnRequestId);
      if (!detail) throw new Error(`ReturnRequest ${returnRequestId} not found`);

      const orderDetail = await this.orders.getForAdmin(detail.request.orderId);
      const orderItemById = new Map(orderDetail.items.map((item) => [item.id as string, item]));

      for (const item of detail.items) {
        if (item.restockedAt) continue;
        if (!item.condition || !RESTOCKABLE_CONDITIONS.includes(item.condition)) continue;
        const orderItem = orderItemById.get(item.orderItemId);
        if (!orderItem?.productSkuId || !detail.request.warehouseId || !detail.request.locationId) {
          // Same known limitation ADR-012 decision 6 already documents
          // (a deleted catalog SKU, or a return whose receiving
          // location was never captured) — never restocked, never
          // treated as a settlement failure either.
          continue;
        }
        ReturnSettlementInvariants.assertPositiveRestockQuantity(item.id, item.quantity);

        await this.adjustments.receiveReturnedStock({
          productSkuId: orderItem.productSkuId,
          warehouseId: detail.request.warehouseId,
          locationId: detail.request.locationId,
          quantity: item.quantity,
          returnRequestId,
          returnItemId: item.id,
          actorUserId,
        });
        await this.returns.markItemRestocked(item.id);
      }

      if (detail.request.resolution === 'CREDIT_NOTE') {
        await this.ensureDraftCreditNote(detail);
      }

      const result = await this.settlements.updateStatus(settlement.id, 'RESTOCKED', {
        restockCompletedAt: new Date(),
      });
      if (result.transitioned) {
        await this.auditLog.record({
          actorId: actorUserId,
          action: 'RETURN_SETTLEMENT_RESTOCKED',
          entityType: 'ReturnSettlement',
          entityId: settlement.id,
        });
      }
      return result.entity;
    } catch (error) {
      await this.recordFailure(settlement.id, actorUserId, error);
      throw error;
    }
  }

  /** Drafts the `CreditNote` if one doesn't already exist for this
   * return — checked first (cheap, avoids a needless P2002 round trip
   * on every retry), backstopped by the real `@unique returnRequestId`
   * database constraint either way (ADR-013 decision 9). */
  private async ensureDraftCreditNote(detail: ReturnRequestWithDetail): Promise<void> {
    const existing = await this.creditNotes.listByReturnRequestId(detail.request.id);
    if (existing.length > 0) return;

    const settlement = await this.computeSettlement(detail);
    const orderDetail = await this.orders.getForAdmin(detail.request.orderId);
    const invoice = await this.invoices.getByOrderId(detail.request.orderId);
    await this.creditNotes.createDraftForReturn({
      orderId: detail.request.orderId,
      returnRequestId: detail.request.id,
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

  /**
   * The money-settlement phase (ADR-013 decision 3, Window B). A
   * premature call (settlement still `PENDING_RESTOCK`, restock not
   * yet complete) is rejected as a real domain conflict *before* this
   * method's own try/catch — a legitimate "not ready yet" business
   * state, never recorded as a settlement failure.
   */
  async requestSettlement(
    returnRequestId: string,
    actorUserId: string | null,
  ): Promise<ReturnSettlement> {
    const settlement = await this.settlements.findByReturnRequestId(returnRequestId);
    if (!settlement) {
      throw new NotFoundException(`No settlement exists for return ${returnRequestId}`);
    }
    if (settlement.status === 'SETTLED' || settlement.status === 'COMPLETED') {
      return settlement;
    }
    if (settlement.status !== 'REFUND_REQUESTED') {
      ReturnSettlementStateMachine.assertTransition(settlement.status, 'REFUND_REQUESTED');
    }

    try {
      await this.settlements.updateStatus(settlement.id, 'REFUND_REQUESTED', {
        refundRequestedAt: new Date(),
      });

      const detail = await this.returns.findById(returnRequestId);
      if (!detail) throw new Error(`ReturnRequest ${returnRequestId} not found`);

      if (detail.request.resolution === 'CREDIT_NOTE') {
        const notes = await this.creditNotes.listByReturnRequestId(returnRequestId);
        const draft = notes.find((note) => note.status === 'DRAFT') ?? notes[0];
        if (!draft) {
          throw new MissingImmutableSnapshotError(returnRequestId, 'CreditNote (DRAFT)');
        }
        await this.creditNotes.issue(draft.id, actorUserId);
      } else {
        const computed = await this.computeSettlement(detail);
        const orderDetail = await this.orders.getForAdmin(detail.request.orderId);
        const intentDetail = await this.payments.findById(orderDetail.order.paymentIntentId);
        const transaction = intentDetail?.transactions.find((t) => t.isVerified);
        if (!transaction) {
          throw new MissingImmutableSnapshotError(returnRequestId, 'verified PaymentTransaction');
        }
        await this.refunds.requestRefund({
          paymentTransactionId: transaction.id,
          amount: computed.totalAmount,
          reason: `Return ${detail.request.returnNumber}`,
          requestedBy: actorUserId ?? undefined,
          idempotencyKey: `return-refund__${returnRequestId}`,
          returnRequestId,
          lines: computed.lines.map((line) => ({
            returnItemId: line.returnItemId,
            amount: line.amount,
          })),
        });

        // ADR-013 §12 — at most one caller, ever, records this
        // return's refund against Order.refundedTotal, regardless of
        // how many times this method is retried or raced.
        const claimed = await this.settlements.claimRefundRecording(settlement.id);
        if (claimed) {
          await this.orders.recordReturnRefund(detail.request.orderId, computed.totalAmount);
        }
      }

      const settledResult = await this.settlements.updateStatus(settlement.id, 'SETTLED', {
        settledAt: new Date(),
      });
      if (settledResult.transitioned) {
        await this.auditLog.record({
          actorId: actorUserId,
          action: 'RETURN_SETTLEMENT_SETTLED',
          entityType: 'ReturnSettlement',
          entityId: settlement.id,
        });
      }

      const returnResult = await this.returns.updateStatus(
        returnRequestId,
        'REFUNDED',
        actorUserId,
        null,
        {
          refundedAt: new Date(),
        },
      );
      if (returnResult.transitioned) {
        await this.auditLog.record({
          actorId: actorUserId,
          action: 'RETURN_REFUNDED',
          entityType: 'ReturnRequest',
          entityId: returnRequestId,
          newValue: { resolution: detail.request.resolution },
        });
      }

      return settledResult.entity;
    } catch (error) {
      await this.recordFailure(settlement.id, actorUserId, error);
      throw error;
    }
  }

  /** Builds the per-`ReturnItem` settlement breakdown (already computed
   * at `inspect()` time) plus whether the order's shipping charge is
   * included — only on a full-order return (ADR-012 decision 4). */
  private async computeSettlement(detail: ReturnRequestWithDetail): Promise<{
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

  /** ADR-013 decision 10 — classifies the failure and records it
   * durably, but never swallows it: the caller still sees the original
   * error (a synchronous HTTP caller surfaces a real error response;
   * the recovery sweep's own per-settlement `catch` is what actually
   * stops it from propagating further, matching the exact
   * `RefundStatusSyncProcessor`/`ReturnSettlementSyncProcessor`
   * precedent). */
  private async recordFailure(
    settlementId: string,
    actorUserId: string | null,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    if (this.isTerminal(error)) {
      const result = await this.settlements
        .updateStatus(settlementId, 'FAILED_TERMINAL', { lastError: message })
        .catch(() => null);
      if (result?.transitioned) {
        await this.auditLog.record({
          actorId: actorUserId,
          action: 'RETURN_SETTLEMENT_FAILED',
          entityType: 'ReturnSettlement',
          entityId: settlementId,
          newValue: { terminal: true, message },
        });
      }
      return;
    }
    await this.settlements.recordAttemptFailure(settlementId, message);
  }

  /** A domain-invariant violation is always terminal, never transient
   * — every one of these fires only against server-computed values or
   * genuinely corrupted historical data, the same "this can only be an
   * internal-consistency bug, not a bad request" reasoning
   * `ReturnDomainExceptionFilter` already applies to the
   * `CreditNoteValidator` errors specifically. Anything not in this
   * list (a transient DB/network error, an unexpected exception) is
   * retryable by default. */
  private isTerminal(error: unknown): boolean {
    return (
      error instanceof InvalidReturnSettlementTransitionError ||
      error instanceof MissingImmutableSnapshotError ||
      error instanceof NonPositiveRestockQuantityError ||
      error instanceof NonPositiveReturnQuantityError ||
      error instanceof OverReturnedError ||
      error instanceof InvalidReturnTransitionError ||
      error instanceof InvalidCreditNoteTransitionError ||
      error instanceof CreditNoteLineSumMismatchError ||
      error instanceof CreditNoteGrandTotalMismatchError ||
      error instanceof CreditNoteExceedsRefundableAmountError ||
      error instanceof NonPositiveCreditNoteAmountError ||
      error instanceof RefundExceedsTransactionAmountError ||
      error instanceof NonPositiveRefundAmountError
    );
  }
}
