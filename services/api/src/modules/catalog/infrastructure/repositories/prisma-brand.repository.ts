import { prisma, type Brand as PrismaBrand, type Prisma } from '@iecp/database';
import type { BrandId, LocalizedText, SeoMetadata } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { Brand } from '../../domain/entities/brand.entity';
import type {
  BrandRepositoryPort,
  ListBrandsFilter,
} from '../../domain/ports/brand.repository.port';
import { fromJson, toJson } from '../json.util';
import { decodeCursor, encodeCursor, splitPage } from '../pagination.util';

@Injectable()
export class PrismaBrandRepository implements BrandRepositoryPort {
  async findById(id: BrandId): Promise<Brand | null> {
    const row = await prisma.brand.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findBySlug(slug: string): Promise<Brand | null> {
    const row = await prisma.brand.findUnique({ where: { slug } });
    return row ? toDomain(row) : null;
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const row = await prisma.brand.findUnique({ where: { slug }, select: { id: true } });
    return row !== null;
  }

  async list(filter: ListBrandsFilter): Promise<{ items: Brand[]; nextCursor: string | null }> {
    const where: Prisma.BrandWhereInput = {
      deletedAt: null,
      ...(filter.status && { status: filter.status }),
      ...(filter.search && { name: { contains: filter.search, mode: 'insensitive' } }),
    };
    if (filter.cursor) {
      const { sortValue, id } = decodeCursor(filter.cursor);
      where.OR = [
        { createdAt: { lt: new Date(sortValue) } },
        { createdAt: new Date(sortValue), id: { lt: id } },
      ];
    }

    const rows = await prisma.brand.findMany({
      where,
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
    name: string;
    slug: string;
    localizedName?: LocalizedText | null;
    description?: string | null;
    logoMediaId?: string | null;
    sortOrder?: number;
    seo?: SeoMetadata | null;
  }): Promise<Brand> {
    const row = await prisma.brand.create({
      data: {
        name: props.name,
        slug: props.slug,
        localizedName: toJson(props.localizedName ?? null),
        description: props.description ?? null,
        logoMediaId: props.logoMediaId ?? null,
        sortOrder: props.sortOrder ?? 0,
        seo: toJson(props.seo ?? null),
      },
    });
    return toDomain(row);
  }

  async update(
    id: BrandId,
    props: Partial<{
      name: string;
      slug: string;
      localizedName: LocalizedText | null;
      description: string | null;
      logoMediaId: string | null;
      status: 'ACTIVE' | 'INACTIVE';
      sortOrder: number;
      seo: SeoMetadata | null;
    }>,
  ): Promise<Brand> {
    const row = await prisma.brand.update({
      where: { id },
      data: {
        ...(props.name !== undefined && { name: props.name }),
        ...(props.slug !== undefined && { slug: props.slug }),
        ...(props.localizedName !== undefined && { localizedName: toJson(props.localizedName) }),
        ...(props.description !== undefined && { description: props.description }),
        ...(props.logoMediaId !== undefined && { logoMediaId: props.logoMediaId }),
        ...(props.status !== undefined && { status: props.status }),
        ...(props.sortOrder !== undefined && { sortOrder: props.sortOrder }),
        ...(props.seo !== undefined && { seo: toJson(props.seo) }),
      },
    });
    return toDomain(row);
  }

  async softDelete(id: BrandId): Promise<void> {
    await prisma.brand.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
  }

  async hasProducts(id: BrandId): Promise<boolean> {
    const count = await prisma.product.count({ where: { brandId: id, deletedAt: null } });
    return count > 0;
  }
}

function toDomain(row: PrismaBrand): Brand {
  return Brand.create({
    id: row.id,
    name: row.name,
    slug: row.slug,
    localizedName: fromJson(row.localizedName),
    description: row.description,
    logoMediaId: row.logoMediaId,
    status: row.status,
    sortOrder: row.sortOrder,
    seo: fromJson(row.seo),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}
