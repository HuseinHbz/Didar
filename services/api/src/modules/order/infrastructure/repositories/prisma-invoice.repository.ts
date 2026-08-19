import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@iecp/database';
import type { InvoiceStatus } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { Invoice } from '../../domain/entities/invoice.entity';
import type {
  InvoiceRepositoryPort,
  InvoiceWithItems,
} from '../../domain/ports/invoice.repository.port';
import { invoiceItemToDomain, invoiceToDomain } from '../order.mapper';

function isUniqueViolationOn(error: unknown, column: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (error.meta?.['target'] as string[] | undefined)?.includes(column) === true
  );
}

/** `INV-YYYYMMDD-NNNNNN` — same technique `formatOrderNumber` uses
 * (ADR-009 decision 6), applied to `finance.invoice_number_seq`. */
function formatInvoiceNumber(seq: bigint, drawnAt: Date): string {
  const y = drawnAt.getUTCFullYear();
  const m = String(drawnAt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(drawnAt.getUTCDate()).padStart(2, '0');
  return `INV-${y}${m}${d}-${seq.toString().padStart(6, '0')}`;
}

@Injectable()
export class PrismaInvoiceRepository implements InvoiceRepositoryPort {
  async findById(id: string): Promise<InvoiceWithItems | null> {
    const row = await prisma.invoice.findUnique({ where: { id }, include: { items: true } });
    if (!row) return null;
    return { invoice: invoiceToDomain(row), items: row.items.map(invoiceItemToDomain) };
  }

  async findByOrderId(orderId: string): Promise<InvoiceWithItems | null> {
    const row = await prisma.invoice.findUnique({ where: { orderId }, include: { items: true } });
    if (!row) return null;
    return { invoice: invoiceToDomain(row), items: row.items.map(invoiceItemToDomain) };
  }

  async findByInvoiceNumber(invoiceNumber: string): Promise<Invoice | null> {
    const row = await prisma.invoice.findUnique({ where: { invoiceNumber } });
    return row ? invoiceToDomain(row) : null;
  }

  /** Idempotent on `orderId` (`@unique`, one invoice per order) — same
   * P2002-catch-and-reread race-safety pattern `PrismaOrderRepository
   * .create()` uses. */
  async create(props: {
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
    try {
      const row = await prisma.$transaction(async (tx) => {
        const seqRows = await tx.$queryRaw<{ nextval: bigint }[]>(
          Prisma.sql`SELECT nextval('finance.invoice_number_seq') AS nextval`,
        );
        const nextval = seqRows[0]?.nextval;
        if (nextval === undefined) throw new Error('invoice_number_seq.nextval() returned no row');
        const invoiceNumber = formatInvoiceNumber(nextval, new Date());
        return tx.invoice.create({
          data: {
            id: randomUUID(),
            invoiceNumber,
            orderId: props.orderId,
            customerId: props.customerId ?? null,
            currency: props.currency,
            subtotal: props.subtotal,
            discountTotal: props.discountTotal,
            taxTotal: props.taxTotal,
            shippingTotal: props.shippingTotal,
            grandTotal: props.grandTotal,
            items: {
              create: props.items.map((item) => ({
                id: randomUUID(),
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineTotal: item.lineTotal,
              })),
            },
          },
        });
      });
      return invoiceToDomain(row);
    } catch (error) {
      if (isUniqueViolationOn(error, 'order_id')) {
        const existing = await prisma.invoice.findUnique({ where: { orderId: props.orderId } });
        if (existing) return invoiceToDomain(existing);
      }
      throw error;
    }
  }

  async updateStatus(
    id: string,
    status: InvoiceStatus,
    extra?: { issuedAt?: Date; voidedAt?: Date },
  ): Promise<Invoice> {
    const row = await prisma.invoice.update({
      where: { id },
      data: { status, issuedAt: extra?.issuedAt, voidedAt: extra?.voidedAt },
    });
    return invoiceToDomain(row);
  }
}
