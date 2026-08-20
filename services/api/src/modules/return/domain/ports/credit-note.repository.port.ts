import type { CreditNoteStatus } from '@iecp/types';

import type { CreditNoteLine } from '../entities/credit-note-line.entity';
import type { CreditNote } from '../entities/credit-note.entity';

export const CREDIT_NOTE_REPOSITORY = Symbol('CREDIT_NOTE_REPOSITORY');

export interface CreditNoteWithLines {
  creditNote: CreditNote;
  lines: CreditNoteLine[];
}

/**
 * `CreditNote` is the aggregate root for `CreditNoteLine` — same "child
 * entities with no independent lifecycle" reasoning `Invoice`/
 * `InvoiceItem` already use.
 */
export interface CreditNoteRepositoryPort {
  findById(id: string): Promise<CreditNoteWithLines | null>;
  findByCreditNoteNumber(creditNoteNumber: string): Promise<CreditNote | null>;
  listByOrderId(orderId: string): Promise<CreditNote[]>;
  listByReturnRequestId(returnRequestId: string): Promise<CreditNote[]>;

  /** Generates the next credit note number from
   * `finance.credit_note_number_seq` (ADR-012 decision 7) and creates the
   * `CreditNote` + its `CreditNoteLine` rows, status `DRAFT`, in one
   * transaction — the number is drawn here, at insert time, same as
   * `Invoice.invoiceNumber`, never deferred to a later transition. No
   * separate idempotency key: the caller (`ReturnService`'s
   * `APPROVED_FOR_REFUND -> REFUNDED` step) only ever reaches this once
   * per return, structurally guarded by that same row-locked transition
   * (ADR-012 decision 9) — a real duplicate call here would mean the
   * caller's own lock was bypassed, a bug this repository doesn't need
   * to defend against a second time. Callers must run
   * `CreditNoteValidator.assertValid()` before calling this — the
   * repository itself does not re-derive the refundable balance. */
  create(props: {
    orderId: string;
    returnRequestId?: string | null;
    invoiceId?: string | null;
    customerId?: string | null;
    currency?: string;
    subtotal: bigint;
    discountTotal?: bigint;
    taxTotal?: bigint;
    grandTotal: bigint;
    lines: readonly {
      description: string;
      quantity: number;
      unitPrice: bigint;
      lineTotal: bigint;
    }[];
  }): Promise<CreditNote>;

  /**
   * Row-locks `finance.credit_notes` (`SELECT ... FOR UPDATE`) and
   * re-checks `CreditNoteStateMachine` against the *locked* status before
   * writing — the same technique every other status-bearing aggregate in
   * this repo already proved. `transitioned: false` means a concurrent
   * caller already made this exact transition first — the caller must
   * skip audit-logging/side-effects it would otherwise perform.
   */
  updateStatus(
    id: string,
    status: CreditNoteStatus,
    extra?: { issuedAt?: Date; appliedAt?: Date; voidedAt?: Date },
  ): Promise<{ entity: CreditNote; transitioned: boolean }>;
}
