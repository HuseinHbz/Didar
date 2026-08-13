import {
  asShippingMethodId,
  asWarehouseId,
  type ShippingMethodId,
  type ShippingMethodType,
  type WarehouseId,
} from '@iecp/types';

export interface ShippingZoneMatch {
  provinces?: string[];
  cities?: string[];
}

/** Database-driven shipping method (ADR-007 decision 7) — never hardcoded.
 * `zoneMatch: null` means available nationwide; a set value is a simple
 * province/city allow-list, deliberately not a full zone graph. */
export class ShippingMethod {
  private constructor(
    public readonly id: ShippingMethodId,
    public readonly code: string,
    public readonly name: string,
    public readonly type: ShippingMethodType,
    public readonly baseCost: bigint,
    public readonly freeAboveAmount: bigint | null,
    public readonly warehouseId: WarehouseId | null,
    public readonly zoneMatch: ShippingZoneMatch | null,
    public readonly isActive: boolean,
    public readonly sortOrder: number,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    code: string;
    name: string;
    type: ShippingMethodType;
    baseCost: bigint;
    freeAboveAmount?: bigint | null;
    warehouseId?: string | null;
    zoneMatch?: ShippingZoneMatch | null;
    isActive?: boolean;
    sortOrder?: number;
    createdAt: Date;
    updatedAt: Date;
  }): ShippingMethod {
    return new ShippingMethod(
      asShippingMethodId(props.id),
      props.code,
      props.name,
      props.type,
      props.baseCost,
      props.freeAboveAmount ?? null,
      props.warehouseId ? asWarehouseId(props.warehouseId) : null,
      props.zoneMatch ?? null,
      props.isActive ?? true,
      props.sortOrder ?? 0,
      props.createdAt,
      props.updatedAt,
    );
  }

  /** `null` zoneMatch = nationwide; otherwise province OR city must match. */
  isAvailableFor(province: string, city: string): boolean {
    if (!this.zoneMatch) return true;
    const { provinces, cities } = this.zoneMatch;
    if (provinces?.includes(province)) return true;
    if (cities?.includes(city)) return true;
    return !provinces && !cities;
  }

  costFor(subtotal: bigint): bigint {
    if (this.freeAboveAmount !== null && subtotal >= this.freeAboveAmount) return 0n;
    return this.baseCost;
  }
}
