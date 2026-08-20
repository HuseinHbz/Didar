import {
  asCustomerId,
  asInvoiceId,
  asOrderId,
  type CustomerId,
  type InvoiceId,
  type InvoiceStatus,
  type OrderId,
} from '@iecp/types';

/** ADR-009 decision 7 — `orderId` is `@unique` (one invoice per order),
 * `invoiceNumber` is server-generated from `finance.invoice_number_seq`.
 * Immutable once `ISSUED` — no repository method exposes an update path
 * for `subtotal`/`taxTotal`/`grandTotal`/its items after that. */
export class Invoice {
  private constructor(
    public readonly id: InvoiceId,
    public readonly invoiceNumber: string,
    public readonly orderId: OrderId,
    public readonly customerId: CustomerId | null,
    public readonly status: InvoiceStatus,
    public readonly currency: string,
    public readonly subtotal: bigint,
    public readonly discountTotal: bigint,
    public readonly taxTotal: bigint,
    public readonly shippingTotal: bigint,
    public readonly grandTotal: bigint,
    public readonly issuedAt: Date | null,
    public readonly voidedAt: Date | null,
    public readonly pdfUrl: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    invoiceNumber: string;
    orderId: string;
    customerId?: string | null;
    status?: InvoiceStatus;
    currency?: string;
    subtotal: bigint;
    discountTotal?: bigint;
    taxTotal?: bigint;
    shippingTotal?: bigint;
    grandTotal: bigint;
    issuedAt?: Date | null;
    voidedAt?: Date | null;
    pdfUrl?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Invoice {
    return new Invoice(
      asInvoiceId(props.id),
      props.invoiceNumber,
      asOrderId(props.orderId),
      props.customerId ? asCustomerId(props.customerId) : null,
      props.status ?? 'DRAFT',
      props.currency ?? 'IRR',
      props.subtotal,
      props.discountTotal ?? 0n,
      props.taxTotal ?? 0n,
      props.shippingTotal ?? 0n,
      props.grandTotal,
      props.issuedAt ?? null,
      props.voidedAt ?? null,
      props.pdfUrl ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }
}
