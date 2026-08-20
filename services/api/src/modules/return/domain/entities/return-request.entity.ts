import {
  asCustomerId,
  asOrderId,
  asReturnRequestId,
  asWarehouseId,
  asWarehouseLocationId,
  type CustomerId,
  type OrderId,
  type ReturnReason,
  type ReturnRequestId,
  type ReturnResolution,
  type ReturnStatus,
  type WarehouseId,
  type WarehouseLocationId,
} from '@iecp/types';

/** `orderId`/`customerId`/`guestToken` mirror `Order`'s own ownership
 * fields exactly (same actor-resolution shape `OrderService
 * .assertOwnership()` already uses). `warehouseId`/`locationId` are set
 * at the `RECEIVED` step — the real, present-tense physical receiving
 * location (ADR-012 decision 6), never a guess. `returnNumber` is
 * server-generated from `commerce.return_number_seq`, never client-
 * supplied. */
export class ReturnRequest {
  private constructor(
    public readonly id: ReturnRequestId,
    public readonly returnNumber: string,
    public readonly orderId: OrderId,
    public readonly customerId: CustomerId | null,
    public readonly guestToken: string | null,
    public readonly status: ReturnStatus,
    public readonly reason: ReturnReason,
    public readonly reasonNote: string | null,
    public readonly resolution: ReturnResolution,
    public readonly warehouseId: WarehouseId | null,
    public readonly locationId: WarehouseLocationId | null,
    public readonly rejectionReason: string | null,
    public readonly idempotencyKey: string | null,
    public readonly requestedAt: Date,
    public readonly approvedAt: Date | null,
    public readonly receivedAt: Date | null,
    public readonly inspectedAt: Date | null,
    public readonly refundedAt: Date | null,
    public readonly completedAt: Date | null,
    public readonly rejectedAt: Date | null,
    public readonly cancelledAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    returnNumber: string;
    orderId: string;
    customerId?: string | null;
    guestToken?: string | null;
    status?: ReturnStatus;
    reason: ReturnReason;
    reasonNote?: string | null;
    resolution?: ReturnResolution;
    warehouseId?: string | null;
    locationId?: string | null;
    rejectionReason?: string | null;
    idempotencyKey?: string | null;
    requestedAt: Date;
    approvedAt?: Date | null;
    receivedAt?: Date | null;
    inspectedAt?: Date | null;
    refundedAt?: Date | null;
    completedAt?: Date | null;
    rejectedAt?: Date | null;
    cancelledAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): ReturnRequest {
    return new ReturnRequest(
      asReturnRequestId(props.id),
      props.returnNumber,
      asOrderId(props.orderId),
      props.customerId ? asCustomerId(props.customerId) : null,
      props.guestToken ?? null,
      props.status ?? 'REQUESTED',
      props.reason,
      props.reasonNote ?? null,
      props.resolution ?? 'REFUND',
      props.warehouseId ? asWarehouseId(props.warehouseId) : null,
      props.locationId ? asWarehouseLocationId(props.locationId) : null,
      props.rejectionReason ?? null,
      props.idempotencyKey ?? null,
      props.requestedAt,
      props.approvedAt ?? null,
      props.receivedAt ?? null,
      props.inspectedAt ?? null,
      props.refundedAt ?? null,
      props.completedAt ?? null,
      props.rejectedAt ?? null,
      props.cancelledAt ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }
}
