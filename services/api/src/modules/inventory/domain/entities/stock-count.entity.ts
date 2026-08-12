import {
  asStockCountId,
  asUserId,
  asWarehouseId,
  asWarehouseLocationId,
  type StockCountId,
  type StockCountStatus,
  type UserId,
  type WarehouseId,
  type WarehouseLocationId,
} from '@iecp/types';

export class StockCount {
  private constructor(
    public readonly id: StockCountId,
    public readonly warehouseId: WarehouseId,
    public readonly locationId: WarehouseLocationId | null,
    public readonly status: StockCountStatus,
    public readonly countedBy: UserId | null,
    public readonly approvedBy: UserId | null,
    public readonly startedAt: Date | null,
    public readonly completedAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    warehouseId: string;
    locationId?: string | null;
    status?: StockCountStatus;
    countedBy?: string | null;
    approvedBy?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): StockCount {
    return new StockCount(
      asStockCountId(props.id),
      asWarehouseId(props.warehouseId),
      props.locationId ? asWarehouseLocationId(props.locationId) : null,
      props.status ?? 'PLANNED',
      props.countedBy ? asUserId(props.countedBy) : null,
      props.approvedBy ? asUserId(props.approvedBy) : null,
      props.startedAt ?? null,
      props.completedAt ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }
}
