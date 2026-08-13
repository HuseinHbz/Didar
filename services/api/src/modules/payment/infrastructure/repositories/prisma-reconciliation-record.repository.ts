import { randomUUID } from 'node:crypto';

import { prisma } from '@iecp/database';
import type { ReconciliationStatus } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { ReconciliationRecord } from '../../domain/entities/reconciliation-record.entity';
import type { ReconciliationRecordRepositoryPort } from '../../domain/ports/reconciliation-record.repository.port';
import { reconciliationRecordToDomain } from '../payment.mapper';

@Injectable()
export class PrismaReconciliationRecordRepository implements ReconciliationRecordRepositoryPort {
  async findById(id: string): Promise<ReconciliationRecord | null> {
    const row = await prisma.reconciliationRecord.findUnique({ where: { id } });
    return row ? reconciliationRecordToDomain(row) : null;
  }

  async listUnresolved(): Promise<ReconciliationRecord[]> {
    const rows = await prisma.reconciliationRecord.findMany({
      where: { status: { not: 'MATCHED' }, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(reconciliationRecordToDomain);
  }

  async listByProviderAndDate(
    providerId: string,
    transactionDate: Date,
  ): Promise<ReconciliationRecord[]> {
    const rows = await prisma.reconciliationRecord.findMany({
      where: { providerId, transactionDate },
    });
    return rows.map(reconciliationRecordToDomain);
  }

  async create(props: {
    providerId: string;
    transactionDate: Date;
    paymentTransactionId?: string | null;
    providerReference: string;
    localAmount?: bigint | null;
    remoteAmount?: bigint | null;
    status: ReconciliationStatus;
  }): Promise<ReconciliationRecord> {
    const row = await prisma.reconciliationRecord.create({
      data: {
        id: randomUUID(),
        providerId: props.providerId,
        transactionDate: props.transactionDate,
        paymentTransactionId: props.paymentTransactionId ?? null,
        providerReference: props.providerReference,
        localAmount: props.localAmount ?? null,
        remoteAmount: props.remoteAmount ?? null,
        status: props.status,
      },
    });
    return reconciliationRecordToDomain(row);
  }

  async resolve(id: string, resolutionNote: string): Promise<ReconciliationRecord> {
    const row = await prisma.reconciliationRecord.update({
      where: { id },
      data: { resolvedAt: new Date(), resolutionNote },
    });
    return reconciliationRecordToDomain(row);
  }
}
