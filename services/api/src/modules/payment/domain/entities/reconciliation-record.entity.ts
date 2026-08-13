import {
  asPaymentProviderId,
  asPaymentTransactionId,
  asReconciliationRecordId,
  type PaymentProviderId,
  type PaymentTransactionId,
  type ReconciliationRecordId,
  type ReconciliationStatus,
} from '@iecp/types';

/** One comparison outcome between a local `PaymentTransaction` and the
 * provider's own settlement report for the same window (ADR-008 decision
 * 7) — records a finding, never silently corrects local state.
 * `paymentTransactionId` is nullable: a `MISSING_LOCAL` finding (the
 * provider has it, this system doesn't) has nothing local to point at. */
export class ReconciliationRecord {
  private constructor(
    public readonly id: ReconciliationRecordId,
    public readonly providerId: PaymentProviderId,
    public readonly transactionDate: Date,
    public readonly paymentTransactionId: PaymentTransactionId | null,
    public readonly providerReference: string,
    public readonly localAmount: bigint | null,
    public readonly remoteAmount: bigint | null,
    public readonly status: ReconciliationStatus,
    public readonly resolvedAt: Date | null,
    public readonly resolutionNote: string | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    providerId: string;
    transactionDate: Date;
    paymentTransactionId?: string | null;
    providerReference: string;
    localAmount?: bigint | null;
    remoteAmount?: bigint | null;
    status: ReconciliationStatus;
    resolvedAt?: Date | null;
    resolutionNote?: string | null;
    createdAt: Date;
  }): ReconciliationRecord {
    return new ReconciliationRecord(
      asReconciliationRecordId(props.id),
      asPaymentProviderId(props.providerId),
      props.transactionDate,
      props.paymentTransactionId ? asPaymentTransactionId(props.paymentTransactionId) : null,
      props.providerReference,
      props.localAmount ?? null,
      props.remoteAmount ?? null,
      props.status,
      props.resolvedAt ?? null,
      props.resolutionNote ?? null,
      props.createdAt,
    );
  }

  get isResolved(): boolean {
    return this.resolvedAt !== null;
  }

  get needsResolution(): boolean {
    return this.status !== 'MATCHED' && !this.isResolved;
  }
}
