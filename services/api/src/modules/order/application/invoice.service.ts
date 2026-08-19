import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { Invoice } from '../domain/entities/invoice.entity';
import {
  INVOICE_REPOSITORY,
  type InvoiceRepositoryPort,
  type InvoiceWithItems,
} from '../domain/ports/invoice.repository.port';
import { InvoiceStateMachine } from '../domain/services/invoice-state-machine';

/**
 * ADR-009 decision 7 — invoice issuance is automatic and synchronous
 * (called from `OrderConversionService` the moment an `Order` is created),
 * with the `invoice_generation` sweep (task #122) as a reliability
 * backstop for the rare case a crash lands between the two. Totals come
 * verbatim from the `Order`'s own already-trusted figures — this service
 * never computes anything itself. Immutable once `ISSUED`: no method here
 * exposes an update path for `subtotal`/`taxTotal`/`grandTotal`/items.
 */
@Injectable()
export class InvoiceService {
  constructor(@Inject(INVOICE_REPOSITORY) private readonly invoices: InvoiceRepositoryPort) {}

  async get(invoiceId: string): Promise<InvoiceWithItems> {
    const detail = await this.invoices.findById(invoiceId);
    if (!detail) throw new NotFoundException('Invoice not found');
    return detail;
  }

  async getByOrderId(orderId: string): Promise<InvoiceWithItems | null> {
    return this.invoices.findByOrderId(orderId);
  }

  /** Idempotent — a duplicate call for the same `orderId` resolves to the
   * existing invoice (the repository's own P2002-catch-and-reread) rather
   * than creating (or re-issuing) a second one. Goes straight
   * `DRAFT -> ISSUED` in one call since nothing in this phase edits a
   * draft before issuing it. */
  async issueForOrder(props: {
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
  }): Promise<Invoice> {
    const existing = await this.invoices.findByOrderId(props.orderId);
    if (existing) return existing.invoice;

    const created = await this.invoices.create(props);
    if (created.status === 'DRAFT') {
      return this.invoices.updateStatus(created.id, 'ISSUED', { issuedAt: new Date() });
    }
    return created;
  }

  /** Called once the order's own `paymentStatus` reaches `PAID` (which,
   * by construction, is already true the moment an order/invoice exist —
   * see `OrderConversionService`) — kept as its own step so a future
   * partial-payment flow has somewhere to call this from without
   * re-deriving invoice status logic. */
  async markPaid(invoiceId: string): Promise<Invoice> {
    const detail = await this.get(invoiceId);
    if (InvoiceStateMachine.isNoOp(detail.invoice.status, 'PAID')) return detail.invoice;
    InvoiceStateMachine.assertTransition(detail.invoice.status, 'PAID');
    return this.invoices.updateStatus(invoiceId, 'PAID');
  }

  /** ADR-009 decision 7 — a correction is a VOID plus manual admin
   * follow-up, never an in-place edit. */
  async void(invoiceId: string): Promise<Invoice> {
    const detail = await this.get(invoiceId);
    if (InvoiceStateMachine.isNoOp(detail.invoice.status, 'VOID')) return detail.invoice;
    InvoiceStateMachine.assertTransition(detail.invoice.status, 'VOID');
    return this.invoices.updateStatus(invoiceId, 'VOID', { voidedAt: new Date() });
  }
}
