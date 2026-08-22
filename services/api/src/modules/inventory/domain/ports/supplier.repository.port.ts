import type { SupplierId, SupplierStatus } from '@iecp/types';

import type { Supplier } from '../entities/supplier.entity';

export const SUPPLIER_REPOSITORY = Symbol('SUPPLIER_REPOSITORY');

export interface ListSuppliersFilter {
  status?: SupplierStatus;
  cursor?: string;
  limit: number;
}

export interface SupplierRepositoryPort {
  findById(id: SupplierId): Promise<Supplier | null>;
  findByCode(code: string): Promise<Supplier | null>;
  list(filter: ListSuppliersFilter): Promise<{ items: Supplier[]; nextCursor: string | null }>;
  create(props: {
    code: string;
    name: string;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    address?: string | null;
  }): Promise<Supplier>;
  update(
    id: SupplierId,
    props: Partial<{
      name: string;
      contactName: string | null;
      contactEmail: string | null;
      contactPhone: string | null;
      address: string | null;
      status: SupplierStatus;
    }>,
  ): Promise<Supplier>;
}
