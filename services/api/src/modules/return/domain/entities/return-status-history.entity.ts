import {
  asReturnRequestId,
  asReturnStatusHistoryId,
  asUserId,
  type ReturnRequestId,
  type ReturnStatus,
  type ReturnStatusHistoryId,
  type UserId,
} from '@iecp/types';

/** Append-only — `changedBy = null` means a system-generated transition
 * (e.g. the `return_settlement_sync` sweep's own `REFUNDED ->
 * COMPLETED` step), same convention `OrderStatusHistory` already uses. */
export class ReturnStatusHistory {
  private constructor(
    public readonly id: ReturnStatusHistoryId,
    public readonly returnRequestId: ReturnRequestId,
    public readonly fromStatus: ReturnStatus | null,
    public readonly toStatus: ReturnStatus,
    public readonly changedBy: UserId | null,
    public readonly note: string | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    returnRequestId: string;
    fromStatus?: ReturnStatus | null;
    toStatus: ReturnStatus;
    changedBy?: string | null;
    note?: string | null;
    createdAt: Date;
  }): ReturnStatusHistory {
    return new ReturnStatusHistory(
      asReturnStatusHistoryId(props.id),
      asReturnRequestId(props.returnRequestId),
      props.fromStatus ?? null,
      props.toStatus,
      props.changedBy ? asUserId(props.changedBy) : null,
      props.note ?? null,
      props.createdAt,
    );
  }
}
