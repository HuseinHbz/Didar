import {
  asPurchaseOrderId,
  asSupplierId,
  asUserId,
  asWarehouseId,
  type PurchaseOrderId,
  type PurchaseOrderStatus,
  type SupplierId,
  type UserId,
  type WarehouseId,
} from '@iecp/types';

/** A restocking order placed with a `Supplier`, received into one
 * `Warehouse` — a real 6-state machine
 * (`PurchaseOrderStateMachine`, this same domain layer). See
 * `docs/adr/ADR-021-procurement.md`. */
export class PurchaseOrder {
  private constructor(
    public readonly id: PurchaseOrderId,
    public readonly poNumber: string,
    public readonly supplierId: SupplierId,
    public readonly warehouseId: WarehouseId,
    public readonly status: PurchaseOrderStatus,
    public readonly createdBy: UserId | null,
    public readonly approvedBy: UserId | null,
    public readonly approvedAt: Date | null,
    public readonly cancelledAt: Date | null,
    public readonly receivedAt: Date | null,
    public readonly notes: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    poNumber: string;
    supplierId: string;
    warehouseId: string;
    status?: PurchaseOrderStatus;
    createdBy?: string | null;
    approvedBy?: string | null;
    approvedAt?: Date | null;
    cancelledAt?: Date | null;
    receivedAt?: Date | null;
    notes?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): PurchaseOrder {
    return new PurchaseOrder(
      asPurchaseOrderId(props.id),
      props.poNumber,
      asSupplierId(props.supplierId),
      asWarehouseId(props.warehouseId),
      props.status ?? 'SUBMITTED',
      props.createdBy ? asUserId(props.createdBy) : null,
      props.approvedBy ? asUserId(props.approvedBy) : null,
      props.approvedAt ?? null,
      props.cancelledAt ?? null,
      props.receivedAt ?? null,
      props.notes ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }
}
