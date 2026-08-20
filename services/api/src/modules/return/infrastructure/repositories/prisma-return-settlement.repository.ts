import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@iecp/database';
import { RETURN_SETTLEMENT_STATUSES, type ReturnSettlementStatus } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { ReturnSettlement } from '../../domain/entities/return-settlement.entity';
import type { ReturnSettlementRepositoryPort } from '../../domain/ports/return-settlement.repository.port';
import type { StatusUpdateResult } from '../../domain/ports/return.repository.port';
import { ReturnSettlementStateMachine } from '../../domain/services/return-settlement-state-machine';
import { returnSettlementToDomain } from '../return.mapper';

function isUniqueViolationOn(error: unknown, column: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (error.meta?.['target'] as string[] | undefined)?.includes(column) === true
  );
}

/** Same "list every non-terminal row" query both the recovery sweep and
 * reconciliation share (ADR-013 decisions 8/9) — derived directly from
 * `ReturnSettlementStateMachine.isActive()`, the single source of
 * truth for "active", never a hand-duplicated `IN (...)` list. */
const ACTIVE_STATUSES: readonly ReturnSettlementStatus[] = RETURN_SETTLEMENT_STATUSES.filter(
  (status) => ReturnSettlementStateMachine.isActive(status),
);

@Injectable()
export class PrismaReturnSettlementRepository implements ReturnSettlementRepositoryPort {
  async findById(id: string): Promise<ReturnSettlement | null> {
    const row = await prisma.returnSettlement.findUnique({ where: { id } });
    return row ? returnSettlementToDomain(row) : null;
  }

  async findByReturnRequestId(returnRequestId: string): Promise<ReturnSettlement | null> {
    const row = await prisma.returnSettlement.findUnique({ where: { returnRequestId } });
    return row ? returnSettlementToDomain(row) : null;
  }

  async listActive(staleSince?: Date): Promise<ReturnSettlement[]> {
    const rows = await prisma.returnSettlement.findMany({
      where: {
        status: { in: [...ACTIVE_STATUSES] },
        ...(staleSince && { updatedAt: { lte: staleSince } }),
      },
      orderBy: { updatedAt: 'asc' },
    });
    return rows.map(returnSettlementToDomain);
  }

  async listManualReview(): Promise<ReturnSettlement[]> {
    const rows = await prisma.returnSettlement.findMany({
      where: { status: 'MANUAL_REVIEW' },
      orderBy: { updatedAt: 'asc' },
    });
    return rows.map(returnSettlementToDomain);
  }

  /** Idempotent via the real `@unique returnRequestId` FK — a retried
   * call re-reads and returns the original row rather than creating a
   * second, real duplicate. */
  async create(returnRequestId: string): Promise<ReturnSettlement> {
    try {
      const row = await prisma.returnSettlement.create({
        data: { id: randomUUID(), returnRequestId, status: 'PENDING_RESTOCK' },
      });
      return returnSettlementToDomain(row);
    } catch (error) {
      if (isUniqueViolationOn(error, 'return_request_id')) {
        const existing = await prisma.returnSettlement.findUnique({ where: { returnRequestId } });
        if (existing) return returnSettlementToDomain(existing);
      }
      throw error;
    }
  }

  /** ADR-013 decision 5 — row-locks the settlement, re-checks
   * `ReturnSettlementStateMachine` against the *locked* status before
   * writing. Same technique `PrismaReturnRepository.updateStatus()`
   * already proved. */
  async updateStatus(
    id: string,
    status: ReturnSettlementStatus,
    extra?: {
      restockCompletedAt?: Date;
      refundRequestedAt?: Date;
      refundRecordedAt?: Date;
      settledAt?: Date;
      completedAt?: Date;
      lastError?: string | null;
    },
  ): Promise<StatusUpdateResult<ReturnSettlement>> {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: ReturnSettlementStatus }[]>(
        Prisma.sql`SELECT status FROM commerce.return_settlements WHERE id = ${id}::uuid FOR UPDATE`,
      );
      const currentStatus = locked[0]?.status;
      if (currentStatus === undefined) throw new Error(`ReturnSettlement ${id} not found`);

      if (ReturnSettlementStateMachine.isNoOp(currentStatus, status)) {
        const unchanged = await tx.returnSettlement.findUniqueOrThrow({ where: { id } });
        return { row: unchanged, transitioned: false };
      }
      ReturnSettlementStateMachine.assertTransition(currentStatus, status);

      const updated = await tx.returnSettlement.update({
        where: { id },
        data: {
          status,
          restockCompletedAt: extra?.restockCompletedAt,
          refundRequestedAt: extra?.refundRequestedAt,
          refundRecordedAt: extra?.refundRecordedAt,
          settledAt: extra?.settledAt,
          completedAt: extra?.completedAt,
          lastError: extra?.lastError,
        },
      });
      return { row: updated, transitioned: true };
    });
    return { entity: returnSettlementToDomain(result.row), transitioned: result.transitioned };
  }

  async recordAttemptFailure(id: string, error: string): Promise<ReturnSettlement> {
    const row = await prisma.returnSettlement.update({
      where: { id },
      data: { attempts: { increment: 1 }, lastError: error, lastAttemptAt: new Date() },
    });
    return returnSettlementToDomain(row);
  }
}
