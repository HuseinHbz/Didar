import type { ReconciliationStatus } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { ReconciliationRecord } from '../domain/entities/reconciliation-record.entity';
import {
  PAYMENT_INTENT_REPOSITORY,
  type PaymentIntentRepositoryPort,
} from '../domain/ports/payment-intent.repository.port';
import {
  PAYMENT_PROVIDER_ADAPTER_REGISTRY,
  type PaymentProviderAdapterRegistry,
} from '../domain/ports/payment-provider-adapter.port';
import {
  PAYMENT_PROVIDER_REPOSITORY,
  type PaymentProviderRepositoryPort,
} from '../domain/ports/payment-provider.repository.port';
import {
  RECONCILIATION_RECORD_REPOSITORY,
  type ReconciliationRecordRepositoryPort,
} from '../domain/ports/reconciliation-record.repository.port';

function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Compares one local `PaymentTransaction` against what the provider
 * itself reports right now via `queryPayment()` (ADR-008 decision 7) —
 * records a finding, never rewrites the local row. ZarinPal exposes no
 * bulk settlement-report feed this system can pull, so this is
 * per-transaction reconciliation (foundation only, matching ADR-008's
 * own scope): `MISSING_LOCAL`/`MISSING_REMOTE` findings — which require
 * comparing against a full provider-side report, not one known local
 * row — are outside what this method alone can produce; the
 * `reconciliation` BullMQ job (task #103) drives this across every
 * `VERIFIED` transaction in a window, which is as close to that as this
 * phase gets.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(RECONCILIATION_RECORD_REPOSITORY)
    private readonly records: ReconciliationRecordRepositoryPort,
    @Inject(PAYMENT_INTENT_REPOSITORY) private readonly intents: PaymentIntentRepositoryPort,
    @Inject(PAYMENT_PROVIDER_REPOSITORY) private readonly providers: PaymentProviderRepositoryPort,
    @Inject(PAYMENT_PROVIDER_ADAPTER_REGISTRY)
    private readonly adapters: PaymentProviderAdapterRegistry,
  ) {}

  async reconcileTransaction(paymentTransactionId: string): Promise<ReconciliationRecord> {
    const transaction = await this.intents.findTransactionById(paymentTransactionId);
    if (!transaction) throw new NotFoundException('Payment transaction not found');

    const intentDetail = await this.intents.findById(transaction.paymentIntentId);
    const attempt = intentDetail?.attempts.find((a) => a.id === transaction.paymentAttemptId);

    const provider = await this.providers.findById(transaction.providerId);
    if (!provider) throw new NotFoundException('Payment provider not found');
    const adapter = this.adapters.resolve(provider);

    const remote = attempt?.providerAuthority
      ? await adapter.queryPayment(attempt.providerAuthority)
      : {
          verified: false,
          providerReference: null,
          amount: '0',
          currency: transaction.currency,
          raw: {},
        };

    let status: ReconciliationStatus;
    if (remote.verified !== transaction.isVerified) {
      status = 'STATUS_MISMATCH';
    } else if (remote.verified && BigInt(remote.amount) !== transaction.amount) {
      status = 'AMOUNT_MISMATCH';
    } else {
      status = 'MATCHED';
    }

    return this.records.create({
      providerId: provider.id,
      transactionDate: dateOnly(transaction.createdAt),
      paymentTransactionId: transaction.id,
      providerReference: transaction.providerReference,
      localAmount: transaction.amount,
      remoteAmount: remote.verified ? BigInt(remote.amount) : null,
      status,
    });
  }

  /** Admin-only resolution — records the note, never rewrites
   * `status`/`localAmount`/`remoteAmount` (ADR-008 decision 7). */
  async resolve(id: string, resolutionNote: string): Promise<ReconciliationRecord> {
    return this.records.resolve(id, resolutionNote);
  }

  async listUnresolved(): Promise<ReconciliationRecord[]> {
    return this.records.listUnresolved();
  }
}
