import {
  asReturnRequestId,
  asReturnSettlementId,
  type ReturnRequestId,
  type ReturnSettlementId,
  type ReturnSettlementStatus,
} from '@iecp/types';

/** ADR-013 — the durable settlement-execution record for one
 * `ReturnRequest`. See `ReturnSettlementStateMachine` for the status
 * graph and `attempts`/`lastError`/`lastAttemptAt`'s role in the
 * retryable-vs-terminal distinction. `refundRecordedAt` guards
 * `OrderService.recordReturnRefund()` — set at most once per
 * settlement, never re-fired on a retry. */
export class ReturnSettlement {
  private constructor(
    public readonly id: ReturnSettlementId,
    public readonly returnRequestId: ReturnRequestId,
    public readonly status: ReturnSettlementStatus,
    public readonly restockCompletedAt: Date | null,
    public readonly refundRequestedAt: Date | null,
    public readonly refundRecordedAt: Date | null,
    public readonly settledAt: Date | null,
    public readonly completedAt: Date | null,
    public readonly attempts: number,
    public readonly lastError: string | null,
    public readonly lastAttemptAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    returnRequestId: string;
    status: ReturnSettlementStatus;
    restockCompletedAt?: Date | null;
    refundRequestedAt?: Date | null;
    refundRecordedAt?: Date | null;
    settledAt?: Date | null;
    completedAt?: Date | null;
    attempts: number;
    lastError?: string | null;
    lastAttemptAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): ReturnSettlement {
    return new ReturnSettlement(
      asReturnSettlementId(props.id),
      asReturnRequestId(props.returnRequestId),
      props.status,
      props.restockCompletedAt ?? null,
      props.refundRequestedAt ?? null,
      props.refundRecordedAt ?? null,
      props.settledAt ?? null,
      props.completedAt ?? null,
      props.attempts,
      props.lastError ?? null,
      props.lastAttemptAt ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }
}
