import { prisma, type Supplier as PrismaSupplier } from '@iecp/database';
import type { SupplierId, SupplierStatus } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { Supplier } from '../../domain/entities/supplier.entity';
import type {
  ListSuppliersFilter,
  SupplierRepositoryPort,
} from '../../domain/ports/supplier.repository.port';
import { decodeCursor, encodeCursor, splitPage } from '../pagination.util';

@Injectable()
export class PrismaSupplierRepository implements SupplierRepositoryPort {
  async findById(id: SupplierId): Promise<Supplier | null> {
    const row = await prisma.supplier.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByCode(code: string): Promise<Supplier | null> {
    const row = await prisma.supplier.findUnique({ where: { code } });
    return row ? toDomain(row) : null;
  }

  async list(
    filter: ListSuppliersFilter,
  ): Promise<{ items: Supplier[]; nextCursor: string | null }> {
    const cursorClause = filter.cursor ? decodeCursor(filter.cursor) : null;
    const where = {
      ...(filter.status !== undefined && { status: filter.status }),
      deletedAt: null,
    };

    const rows = await prisma.supplier.findMany({
      where: cursorClause
        ? {
            ...where,
            OR: [
              { createdAt: { lt: new Date(cursorClause.sortValue) } },
              { createdAt: new Date(cursorClause.sortValue), id: { lt: cursorClause.id } },
            ],
          }
        : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });

    const { page, hasMore } = splitPage(rows, filter.limit);
    const last = page.at(-1);
    return {
      items: page.map(toDomain),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
    };
  }

  async create(props: {
    code: string;
    name: string;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    address?: string | null;
  }): Promise<Supplier> {
    const row = await prisma.supplier.create({
      data: {
        code: props.code,
        name: props.name,
        contactName: props.contactName ?? null,
        contactEmail: props.contactEmail ?? null,
        contactPhone: props.contactPhone ?? null,
        address: props.address ?? null,
      },
    });
    return toDomain(row);
  }

  async update(
    id: SupplierId,
    props: Partial<{
      name: string;
      contactName: string | null;
      contactEmail: string | null;
      contactPhone: string | null;
      address: string | null;
      status: SupplierStatus;
    }>,
  ): Promise<Supplier> {
    const row = await prisma.supplier.update({
      where: { id },
      data: {
        ...(props.name !== undefined && { name: props.name }),
        ...(props.contactName !== undefined && { contactName: props.contactName }),
        ...(props.contactEmail !== undefined && { contactEmail: props.contactEmail }),
        ...(props.contactPhone !== undefined && { contactPhone: props.contactPhone }),
        ...(props.address !== undefined && { address: props.address }),
        ...(props.status !== undefined && { status: props.status }),
      },
    });
    return toDomain(row);
  }
}

function toDomain(row: PrismaSupplier): Supplier {
  return Supplier.create({
    id: row.id,
    code: row.code,
    name: row.name,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    address: row.address,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}
