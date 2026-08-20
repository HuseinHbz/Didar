import {
  asCreditNoteId,
  asCustomerId,
  asInvoiceId,
  asOrderId,
  asReturnRequestId,
  type CreditNoteId,
  type CreditNoteStatus,
  type CustomerId,
  type InvoiceId,
  type OrderId,
  type ReturnRequestId,
} from '@iecp/types';

/** `creditNoteNumber` is server-generated from
 * `finance.credit_note_number_seq`, never client-supplied. `invoiceId`
 * is a real, enforced FK (both live in `finance`); `orderId`/
 * `returnRequestId`/`customerId` are unenforced cross-schema pointers,
 * same convention `Invoice.orderId` already uses — never a Prisma
 * relation (ADR-012 decision 7's own note on why). Never a historical-
 * `Invoice` rewrite: `Invoice` itself gains no new column, this row is
 * the adjustment. */
export class CreditNote {
  private constructor(
    public readonly id: CreditNoteId,
    public readonly creditNoteNumber: string,
    public readonly orderId: OrderId,
    public readonly returnRequestId: ReturnRequestId | null,
    public readonly invoiceId: InvoiceId | null,
    public readonly customerId: CustomerId | null,
    public readonly status: CreditNoteStatus,
    public readonly currency: string,
    public readonly subtotal: bigint,
    public readonly discountTotal: bigint,
    public readonly taxTotal: bigint,
    public readonly grandTotal: bigint,
    public readonly issuedAt: Date | null,
    public readonly appliedAt: Date | null,
    public readonly voidedAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    creditNoteNumber: string;
    orderId: string;
    returnRequestId?: string | null;
    invoiceId?: string | null;
    customerId?: string | null;
    status?: CreditNoteStatus;
    currency?: string;
    subtotal: bigint;
    discountTotal?: bigint;
    taxTotal?: bigint;
    grandTotal: bigint;
    issuedAt?: Date | null;
    appliedAt?: Date | null;
    voidedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): CreditNote {
    return new CreditNote(
      asCreditNoteId(props.id),
      props.creditNoteNumber,
      asOrderId(props.orderId),
      props.returnRequestId ? asReturnRequestId(props.returnRequestId) : null,
      props.invoiceId ? asInvoiceId(props.invoiceId) : null,
      props.customerId ? asCustomerId(props.customerId) : null,
      props.status ?? 'DRAFT',
      props.currency ?? 'IRR',
      props.subtotal,
      props.discountTotal ?? 0n,
      props.taxTotal ?? 0n,
      props.grandTotal,
      props.issuedAt ?? null,
      props.appliedAt ?? null,
      props.voidedAt ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }
}
