import {
  asWarehouseId,
  type WarehouseId,
  type WarehouseStatus,
  type WarehouseType,
} from '@iecp/types';

/** A physical (or virtual/quarantine) stock-holding location — see ADR-006
 * for the location-granularity split (`WarehouseLocation` is the real
 * bin/shelf/dock, `Warehouse` is the site). */
export class Warehouse {
  private constructor(
    public readonly id: WarehouseId,
    public readonly code: string,
    public readonly name: string,
    public readonly type: WarehouseType,
    public readonly status: WarehouseStatus,
    public readonly address: string | null,
    public readonly timezone: string,
    public readonly capacity: number | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly deletedAt: Date | null,
  ) {}

  static create(props: {
    id: string;
    code: string;
    name: string;
    type?: WarehouseType;
    status?: WarehouseStatus;
    address?: string | null;
    timezone?: string;
    capacity?: number | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  }): Warehouse {
    return new Warehouse(
      asWarehouseId(props.id),
      props.code,
      props.name,
      props.type ?? 'CENTRAL',
      props.status ?? 'ACTIVE',
      props.address ?? null,
      props.timezone ?? 'Asia/Tehran',
      props.capacity ?? null,
      props.createdAt,
      props.updatedAt,
      props.deletedAt ?? null,
    );
  }

  get isUsable(): boolean {
    return this.status === 'ACTIVE' && this.deletedAt === null;
  }
}
