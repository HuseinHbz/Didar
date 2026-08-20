import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@iecp/database';
import type { CreditNoteStatus } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { CreditNote } from '../../domain/entities/credit-note.entity';
import type {
  CreditNoteRepositoryPort,
  CreditNoteWithLines,
} from '../../domain/ports/credit-note.repository.port';
import { CreditNoteStateMachine } from '../../domain/services/credit-note-state-machine';
import { creditNoteLineToDomain, creditNoteToDomain } from '../return.mapper';

/** `CN-YYYYMMDD-NNNNNN` — same shape `formatOrderNumber`/
 * `formatReturnNumber` already established. */
function formatCreditNoteNumber(seq: bigint, drawnAt: Date): string {
  const y = drawnAt.getUTCFullYear();
  const m = String(drawnAt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(drawnAt.getUTCDate()).padStart(2, '0');
  return `CN-${y}${m}${d}-${seq.toString().padStart(6, '0')}`;
}

@Injectable()
export class PrismaCreditNoteRepository implements CreditNoteRepositoryPort {
  async findById(id: string): Promise<CreditNoteWithLines | null> {
    const row = await prisma.creditNote.findUnique({ where: { id }, include: { items: true } });
    if (!row) return null;
    return { creditNote: creditNoteToDomain(row), lines: row.items.map(creditNoteLineToDomain) };
  }

  async findByCreditNoteNumber(creditNoteNumber: string): Promise<CreditNote | null> {
    const row = await prisma.creditNote.findUnique({ where: { creditNoteNumber } });
    return row ? creditNoteToDomain(row) : null;
  }

  async listByOrderId(orderId: string): Promise<CreditNote[]> {
    const rows = await prisma.creditNote.findMany({ where: { orderId } });
    return rows.map(creditNoteToDomain);
  }

  async listByReturnRequestId(returnRequestId: string): Promise<CreditNote[]> {
    const rows = await prisma.creditNote.findMany({ where: { returnRequestId } });
    return rows.map(creditNoteToDomain);
  }

  /** Draws `finance.credit_note_number_seq` inside the same transaction
   * as the insert (ADR-012 decision 7/9) — same technique
   * `PrismaOrderRepository.create()`/`PrismaReturnRepository.create()`
   * already use for their own number sequences. No idempotency-key
   * handling here: see this port's own doc comment for why a duplicate
   * call would mean the caller's own row lock was bypassed. */
  async create(props: {
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
  }): Promise<CreditNote> {
    const row = await prisma.$transaction(async (tx) => {
      const seqRows = await tx.$queryRaw<{ nextval: bigint }[]>(
        Prisma.sql`SELECT nextval('finance.credit_note_number_seq') AS nextval`,
      );
      const nextval = seqRows[0]?.nextval;
      if (nextval === undefined) {
        throw new Error('credit_note_number_seq.nextval() returned no row');
      }
      const creditNoteNumber = formatCreditNoteNumber(nextval, new Date());

      return tx.creditNote.create({
        data: {
          id: randomUUID(),
          creditNoteNumber,
          orderId: props.orderId,
          returnRequestId: props.returnRequestId ?? null,
          invoiceId: props.invoiceId ?? null,
          customerId: props.customerId ?? null,
          currency: props.currency ?? 'IRR',
          subtotal: props.subtotal,
          discountTotal: props.discountTotal ?? 0n,
          taxTotal: props.taxTotal ?? 0n,
          grandTotal: props.grandTotal,
          items: {
            create: props.lines.map((line) => ({
              id: randomUUID(),
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
            })),
          },
        },
      });
    });
    return creditNoteToDomain(row);
  }

  /** Same row-lock + re-check technique every other status-bearing
   * aggregate in this repo already proved, applied to
   * `finance.credit_notes` (ADR-012 decision 7). */
  async updateStatus(
    id: string,
    status: CreditNoteStatus,
    extra?: { issuedAt?: Date; appliedAt?: Date; voidedAt?: Date },
  ): Promise<{ entity: CreditNote; transitioned: boolean }> {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: CreditNoteStatus }[]>(
        Prisma.sql`SELECT status FROM finance.credit_notes WHERE id = ${id}::uuid FOR UPDATE`,
      );
      const currentStatus = locked[0]?.status;
      if (currentStatus === undefined) throw new Error(`CreditNote ${id} not found`);

      if (CreditNoteStateMachine.isNoOp(currentStatus, status)) {
        const unchanged = await tx.creditNote.findUniqueOrThrow({ where: { id } });
        return { row: unchanged, transitioned: false };
      }
      CreditNoteStateMachine.assertTransition(currentStatus, status);

      const updated = await tx.creditNote.update({
        where: { id },
        data: {
          status,
          issuedAt: extra?.issuedAt,
          appliedAt: extra?.appliedAt,
          voidedAt: extra?.voidedAt,
        },
      });
      return { row: updated, transitioned: true };
    });
    return { entity: creditNoteToDomain(result.row), transitioned: result.transitioned };
  }
}
