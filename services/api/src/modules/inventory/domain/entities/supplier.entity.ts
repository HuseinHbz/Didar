import { asSupplierId, type SupplierId, type SupplierStatus } from '@iecp/types';

/** Vendor master data a `PurchaseOrder` is placed against — see
 * `docs/adr/ADR-021-procurement.md`. Deliberately no financial/contract
 * fields (payment terms, currency, tax id): not in P021's canonical
 * scope. Soft-deletable the same way `Warehouse` is (`deletedAt`), since
 * a `PurchaseOrder` may still reference a since-deactivated supplier. */
export class Supplier {
  private constructor(
    public readonly id: SupplierId,
    public readonly code: string,
    public readonly name: string,
    public readonly contactName: string | null,
    public readonly contactEmail: string | null,
    public readonly contactPhone: string | null,
    public readonly address: string | null,
    public readonly status: SupplierStatus,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly deletedAt: Date | null,
  ) {}

  static create(props: {
    id: string;
    code: string;
    name: string;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    address?: string | null;
    status?: SupplierStatus;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  }): Supplier {
    return new Supplier(
      asSupplierId(props.id),
      props.code,
      props.name,
      props.contactName ?? null,
      props.contactEmail ?? null,
      props.contactPhone ?? null,
      props.address ?? null,
      props.status ?? 'ACTIVE',
      props.createdAt,
      props.updatedAt,
      props.deletedAt ?? null,
    );
  }

  get isUsable(): boolean {
    return this.status === 'ACTIVE' && this.deletedAt === null;
  }
}
