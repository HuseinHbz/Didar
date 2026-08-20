import type { InvoiceStatus } from '@iecp/types';

import type { InvoiceItem } from '../entities/invoice-item.entity';
import type { Invoice } from '../entities/invoice.entity';

export const INVOICE_REPOSITORY = Symbol('INVOICE_REPOSITORY');

export interface InvoiceWithItems {
  invoice: Invoice;
  items: InvoiceItem[];
}

/** `Invoice` is the aggregate root for `InvoiceItem`. */
export interface InvoiceRepositoryPort {
  findById(id: string): Promise<InvoiceWithItems | null>;
  findByOrderId(orderId: string): Promise<InvoiceWithItems | null>;
  findByInvoiceNumber(invoiceNumber: string): Promise<Invoice | null>;

  /** Generates the next invoice number from
   * `finance.invoice_number_seq` (ADR-009 decision 6). Idempotent on
   * `orderId` (`@unique`) — implementations must catch the resulting
   * `P2002` and re-read the winner's row. */
  create(props: {
    orderId: string;
    customerId?: string | null;
    currency: string;
    subtotal: bigint;
    discountTotal: bigint;
    taxTotal: bigint;
    shippingTotal: bigint;
    grandTotal: bigint;
    items: readonly {
      description: string;
      quantity: number;
      unitPrice: bigint;
      lineTotal: bigint;
    }[];
  }): Promise<Invoice>;

  updateStatus(
    id: string,
    status: InvoiceStatus,
    extra?: { issuedAt?: Date; voidedAt?: Date },
  ): Promise<Invoice>;
}
