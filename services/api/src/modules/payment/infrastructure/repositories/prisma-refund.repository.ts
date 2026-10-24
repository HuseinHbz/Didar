import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@iecp/database';
import { Injectable } from '@nestjs/common';

import type { Refund } from '../../domain/entities/refund.entity';
import type {
  RefundOutcome,
  RefundRepositoryPort,
  RefundSearchFilter,
  RefundWithLines,
} from '../../domain/ports/refund.repository.port';
import { refundLineToDomain, refundToDomain } from '../payment.mapper';

@Injectable()
export class PrismaRefundRepository implements RefundRepositoryPort {
  async findById(id: string): Promise<Refund | null> {
    const row = await prisma.refund.findUnique({ where: { id } });
    return row ? refundToDomain(row) : null;
  }

  async findByIdWithLines(id: string): Promise<RefundWithLines | null> {
    const row = await prisma.refund.findUnique({ where: { id }, include: { lines: true } });
    if (!row) return null;
    return { refund: refundToDomain(row), lines: row.lines.map(refundLineToDomain) };
  }

  async findByIdempotencyKey(key: string): Promise<Refund | null> {
    const row = await prisma.refund.findUnique({ where: { idempotencyKey: key } });
    return row ? refundToDomain(row) : null;
  }

  async listByTransactionId(paymentTransactionId: string): Promise<Refund[]> {
    const rows = await prisma.refund.findMany({ where: { paymentTransactionId } });
    return rows.map(refundToDomain);
  }

  async listByReturnRequestId(returnRequestId: string): Promise<Refund[]> {
    const rows = await prisma.refund.findMany({ where: { returnRequestId } });
    return rows.map(refundToDomain);
  }

  async search(filter: RefundSearchFilter, limit: number): Promise<Refund[]> {
    const rows = await prisma.refund.findMany({
      where: {
        paymentTransactionId: filter.paymentTransactionId,
        returnRequestId: filter.returnRequestId,
        status: filter.status,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(refundToDomain);
  }

  async listStalePending(olderThan: Date): Promise<Refund[]> {
    const rows = await prisma.refund.findMany({
      where: { status: 'PENDING', createdAt: { lt: olderThan } },
    });
    return rows.map(refundToDomain);
  }

  /**
   * Idempotent on `idempotencyKey` under real concurrency (ADR-008
   * decision 9) — same `P2002`-catch-and-reread race-safety pattern as
   * `PrismaPaymentIntentRepository.create()`. `RefundValidator
   * .assertRefundable()` must run before this is called; a request that
   * fails that check never reaches here.
   *
   * `returnRequestId`/`lines` (ADR-012 decision 8) are written as a
   * nested create alongside the `Refund` row itself — Prisma only
   * executes the nested `lines` write on the branch that actually
   * inserts a new row, never on the no-op `update: {}` branch a
   * duplicate-key retry lands on, so a retried call never doubles the
   * `RefundLine` breakdown either.
   */
  async create(props: {
    paymentTransactionId: string;
    amount: bigint;
    reason?: string | null;
    requestedBy?: string | null;
    idempotencyKey: string;
    returnRequestId?: string | null;
    lines?: readonly { returnItemId: string; amount: bigint }[];
  }): Promise<Refund> {
    try {
      const row = await prisma.refund.upsert({
        where: { idempotencyKey: props.idempotencyKey },
        create: {
          id: randomUUID(),
          paymentTransactionId: props.paymentTransactionId,
          amount: props.amount,
          reason: props.reason ?? null,
          requestedBy: props.requestedBy ?? null,
          idempotencyKey: props.idempotencyKey,
          returnRequestId: props.returnRequestId ?? null,
          lines: props.lines?.length
            ? {
                createMany: {
                  data: props.lines.map((line) => ({
                    id: randomUUID(),
                    returnItemId: line.returnItemId,
                    amount: line.amount,
                  })),
                },
              }
            : undefined,
        },
        update: {},
      });
      return refundToDomain(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        (error.meta?.['target'] as string[] | undefined)?.includes('idempotency_key')
      ) {
        const existing = await prisma.refund.findUnique({
          where: { idempotencyKey: props.idempotencyKey },
        });
        if (existing) return refundToDomain(existing);
      }
      throw error;
    }
  }

  /**
   * `UPDATE ... WHERE id = $1 AND status = 'PENDING'`: under READ COMMITTED a
   * second concurrent UPDATE blocks on the row lock, then re-evaluates the WHERE
   * against the committed row, finds it already `PROCESSING` and matches nothing —
   * so exactly one caller sees `count === 1` (proven by the 20-way concurrent
   * `process` test in `payment-order-consistency.e2e-spec.ts`).
   */
  async claimForProcessing(id: string): Promise<boolean> {
    const { count } = await prisma.refund.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    return count === 1;
  }

  async settleProcessing(id: string, outcome: RefundOutcome): Promise<Refund | null> {
    const { count } = await prisma.refund.updateMany({
      where: { id, status: 'PROCESSING' },
      data: {
        status: outcome.status,
        providerRefundReference: outcome.providerRefundReference ?? null,
        failureReason: outcome.failureReason ?? null,
      },
    });
    if (count !== 1) return null;
    const row = await prisma.refund.findUniqueOrThrow({ where: { id } });
    return refundToDomain(row);
  }
}
