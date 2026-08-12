import {
  asStockTransferId,
  asUserId,
  asWarehouseId,
  type StockTransferId,
  type StockTransferStatus,
  type UserId,
  type WarehouseId,
} from '@iecp/types';

/** Warehouse-to-warehouse (or store) stock movement — a real 9-state
 * machine (`TransferStateMachine`, this same domain layer). */
export class StockTransfer {
  private constructor(
    public readonly id: StockTransferId,
    public readonly referenceNumber: string,
    public readonly sourceWarehouseId: WarehouseId,
    public readonly destinationWarehouseId: WarehouseId,
    public readonly status: StockTransferStatus,
    public readonly requestedBy: UserId | null,
    public readonly approvedBy: UserId | null,
    public readonly dispatchedAt: Date | null,
    public readonly receivedAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    referenceNumber: string;
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    status?: StockTransferStatus;
    requestedBy?: string | null;
    approvedBy?: string | null;
    dispatchedAt?: Date | null;
    receivedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): StockTransfer {
    return new StockTransfer(
      asStockTransferId(props.id),
      props.referenceNumber,
      asWarehouseId(props.sourceWarehouseId),
      asWarehouseId(props.destinationWarehouseId),
      props.status ?? 'DRAFT',
      props.requestedBy ? asUserId(props.requestedBy) : null,
      props.approvedBy ? asUserId(props.approvedBy) : null,
      props.dispatchedAt ?? null,
      props.receivedAt ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }
}
