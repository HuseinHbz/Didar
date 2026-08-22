import type { SupplierId, SupplierStatus, UserId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import type { Supplier } from '../domain/entities/supplier.entity';
import {
  SUPPLIER_REPOSITORY,
  type ListSuppliersFilter,
  type SupplierRepositoryPort,
} from '../domain/ports/supplier.repository.port';

/** Supplier master-data CRUD — create/update/deactivate, each audited
 * the same way `WarehousesService`'s own mutations are (master-data
 * changes are still real, actor-attributable events, even without a
 * state machine behind them). */
@Injectable()
export class SupplierService {
  constructor(
    @Inject(SUPPLIER_REPOSITORY) private readonly suppliers: SupplierRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
  ) {}

  async get(id: SupplierId): Promise<Supplier> {
    const supplier = await this.suppliers.findById(id);
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  list(filter: ListSuppliersFilter): Promise<{ items: Supplier[]; nextCursor: string | null }> {
    return this.suppliers.list(filter);
  }

  async create(
    input: {
      code: string;
      name: string;
      contactName?: string | null;
      contactEmail?: string | null;
      contactPhone?: string | null;
      address?: string | null;
    },
    actorId: UserId,
  ): Promise<Supplier> {
    const supplier = await this.suppliers.create(input);
    await this.auditLog.record({
      actorId,
      action: 'SUPPLIER_CREATED',
      entityType: 'Supplier',
      entityId: supplier.id,
      newValue: { code: supplier.code, name: supplier.name },
    });
    return supplier;
  }

  async update(
    id: SupplierId,
    input: Partial<{
      name: string;
      contactName: string | null;
      contactEmail: string | null;
      contactPhone: string | null;
      address: string | null;
      status: SupplierStatus;
    }>,
    actorId: UserId,
  ): Promise<Supplier> {
    const before = await this.get(id);
    const supplier = await this.suppliers.update(id, input);
    await this.auditLog.record({
      actorId,
      action: 'SUPPLIER_UPDATED',
      entityType: 'Supplier',
      entityId: id,
      oldValue: { status: before.status, name: before.name },
      newValue: { status: supplier.status, name: supplier.name },
    });
    return supplier;
  }
}
