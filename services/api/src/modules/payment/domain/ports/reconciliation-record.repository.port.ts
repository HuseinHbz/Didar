import type { ReconciliationStatus } from '@iecp/types';

import type { ReconciliationRecord } from '../entities/reconciliation-record.entity';

export const RECONCILIATION_RECORD_REPOSITORY = Symbol('RECONCILIATION_RECORD_REPOSITORY');

export interface ReconciliationRecordRepositoryPort {
  findById(id: string): Promise<ReconciliationRecord | null>;
  listUnresolved(): Promise<ReconciliationRecord[]>;
  listByProviderAndDate(providerId: string, transactionDate: Date): Promise<ReconciliationRecord[]>;

  create(props: {
    providerId: string;
    transactionDate: Date;
    paymentTransactionId?: string | null;
    providerReference: string;
    localAmount?: bigint | null;
    remoteAmount?: bigint | null;
    status: ReconciliationStatus;
  }): Promise<ReconciliationRecord>;

  /** A mismatch is recorded, never auto-corrected (ADR-008 decision 7) —
   * this is the only mutator, and it only ever sets `resolvedAt`/
   * `resolutionNote`, never `status`/`localAmount`/`remoteAmount`. */
  resolve(id: string, resolutionNote: string): Promise<ReconciliationRecord>;
}
