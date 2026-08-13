import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@iecp/database';
import type { RefundStatus } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { Refund } from '../../domain/entities/refund.entity';
import type { RefundRepositoryPort } from '../../domain/ports/refund.repository.port';
import { refundToDomain } from '../payment.mapper';

@Injectable()
export class PrismaRefundRepository implements RefundRepositoryPort {
  async findById(id: string): Promise<Refund | null> {
    const row = await prisma.refund.findUnique({ where: { id } });
    return row ? refundToDomain(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<Refund | null> {
    const row = await prisma.refund.findUnique({ where: { idempotencyKey: key } });
    return row ? refundToDomain(row) : null;
  }

  async listByTransactionId(paymentTransactionId: string): Promise<Refund[]> {
    const rows = await prisma.refund.findMany({ where: { paymentTransactionId } });
    return rows.map(refundToDomain);
  }

  /**
   * Idempotent on `idempotencyKey` under real concurrency (ADR-008
   * decision 9) — same `P2002`-catch-and-reread race-safety pattern as
   * `PrismaPaymentIntentRepository.create()`. `RefundValidator
   * .assertRefundable()` must run before this is called; a request that
   * fails that check never reaches here.
   */
  async create(props: {
    paymentTransactionId: string;
    amount: bigint;
    reason?: string | null;
    requestedBy?: string | null;
    idempotencyKey: string;
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

  async updateStatus(
    id: string,
    status: RefundStatus,
    extra?: { providerRefundReference?: string | null },
  ): Promise<Refund> {
    const row = await prisma.refund.update({
      where: { id },
      data: { status, providerRefundReference: extra?.providerRefundReference },
    });
    return refundToDomain(row);
  }
}
