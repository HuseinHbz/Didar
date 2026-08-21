import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import type { CreditNote } from '../domain/entities/credit-note.entity';
import {
  CREDIT_NOTE_REPOSITORY,
  type CreditNoteRepositoryPort,
  type CreditNoteWithLines,
} from '../domain/ports/credit-note.repository.port';
import { CreditNoteValidator } from '../domain/services/credit-note-validator';

/**
 * ADR-012 decision 7 — a real, minimal credit-note lifecycle, never a
 * historical-`Invoice` rewrite. `createDraftForReturn()` is the only
 * creation path (no standalone "create an ad-hoc credit note" endpoint,
 * called only by `ReturnService.approveForRefund()`); `issue()`
 * afterwards is a pure `DRAFT -> ISSUED` transition, no further number
 * generation involved (the number was already drawn at insert time,
 * same as `Invoice.invoiceNumber`).
 */
@Injectable()
export class CreditNoteService {
  constructor(
    @Inject(CREDIT_NOTE_REPOSITORY) private readonly creditNotes: CreditNoteRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
  ) {}

  async get(id: string): Promise<CreditNoteWithLines> {
    const detail = await this.creditNotes.findById(id);
    if (!detail) throw new NotFoundException('Credit note not found');
    return detail;
  }

  listByOrderId(orderId: string): Promise<CreditNote[]> {
    return this.creditNotes.listByOrderId(orderId);
  }

  listByReturnRequestId(returnRequestId: string): Promise<CreditNote[]> {
    return this.creditNotes.listByReturnRequestId(returnRequestId);
  }

  /** Called once, by `ReturnService.approveForRefund()`, structurally
   * guarded by that method's own `INSPECTING -> APPROVED_FOR_REFUND` row
   * lock — never reachable a second time for the same return (ADR-012
   * decision 9), so no separate idempotency key is needed here. Re-proves
   * the line/grand-total arithmetic via `CreditNoteValidator` before
   * writing — defense in depth on top of the caller's own computation. */
  async createDraftForReturn(props: {
    orderId: string;
    returnRequestId: string;
    invoiceId?: string | null;
    customerId?: string | null;
    currency?: string;
    subtotal: bigint;
    discountTotal?: bigint;
    taxTotal?: bigint;
    grandTotal: bigint;
    refundableAmount: bigint;
    lines: readonly {
      description: string;
      quantity: number;
      unitPrice: bigint;
      lineTotal: bigint;
    }[];
  }): Promise<CreditNote> {
    CreditNoteValidator.assertValid({
      lines: props.lines,
      subtotal: props.subtotal,
      discountTotal: props.discountTotal ?? 0n,
      taxTotal: props.taxTotal ?? 0n,
      grandTotal: props.grandTotal,
      refundableAmount: props.refundableAmount,
    });

    const created = await this.creditNotes.create({
      orderId: props.orderId,
      returnRequestId: props.returnRequestId,
      invoiceId: props.invoiceId,
      customerId: props.customerId,
      currency: props.currency,
      subtotal: props.subtotal,
      discountTotal: props.discountTotal,
      taxTotal: props.taxTotal,
      grandTotal: props.grandTotal,
      lines: props.lines,
    });
    await this.auditLog.record({
      actorId: null,
      action: 'CREDIT_NOTE_DRAFTED',
      entityType: 'CreditNote',
      entityId: created.id,
      newValue: { returnRequestId: props.returnRequestId, grandTotal: props.grandTotal.toString() },
    });
    return created;
  }

  /** `DRAFT -> ISSUED` — the moment the credit note becomes real/usable.
   * Idempotent via `CreditNoteStateMachine.isNoOp`: a retried call on an
   * already-`ISSUED` note is a safe no-op, no duplicate audit entry.
   * `actorUserId` may be `null` (ADR-013) — called by the
   * `return_settlement_recovery` sweep as well as the synchronous admin
   * path, same "null means system-generated" convention
   * `ReturnStatusHistory.changedBy`/`system.AuditLog.actorId` already
   * use elsewhere in this codebase. */
  async issue(id: string, actorUserId: string | null): Promise<CreditNote> {
    const result = await this.creditNotes.updateStatus(id, 'ISSUED', { issuedAt: new Date() });
    if (result.transitioned) {
      await this.auditLog.record({
        actorId: actorUserId,
        action: 'CREDIT_NOTE_ISSUED',
        entityType: 'CreditNote',
        entityId: id,
      });
    }
    return result.entity;
  }

  /** `POST /admin/credit-notes/:id/void` (`credit_note.void`) — never
   * reachable once `APPLIED` (`CreditNoteStateMachine`'s own doc comment
   * explains why: money already accounted for). */
  async void(id: string, actorUserId: string, reason?: string | null): Promise<CreditNote> {
    const result = await this.creditNotes.updateStatus(id, 'VOID', { voidedAt: new Date() });
    if (result.transitioned) {
      await this.auditLog.record({
        actorId: actorUserId,
        action: 'CREDIT_NOTE_VOIDED',
        entityType: 'CreditNote',
        entityId: id,
        newValue: { reason: reason ?? null },
      });
    }
    return result.entity;
  }
}
