import { prisma, type Product as PrismaProduct, type Prisma } from '@iecp/database';
import type {
  LocalizedText,
  ProductId,
  ProductLifecycleStatus,
  ProductType,
  SeoMetadata,
} from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { Product } from '../../domain/entities/product.entity';
import type {
  ListProductsFilter,
  ProductRepositoryPort,
} from '../../domain/ports/product.repository.port';
import { fromJson, toJson } from '../json.util';
import { decodeCursor, encodeCursor, splitPage } from '../pagination.util';

function sortColumn(field: ListProductsFilter['sortField']): 'createdAt' | 'publishedAt' | 'name' {
  return field ?? 'createdAt';
}

@Injectable()
export class PrismaProductRepository implements ProductRepositoryPort {
  async findById(id: ProductId): Promise<Product | null> {
    const row = await prisma.product.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findBySlug(slug: string): Promise<Product | null> {
    const row = await prisma.product.findUnique({ where: { slug } });
    return row ? toDomain(row) : null;
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const row = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    return row !== null;
  }

  async list(filter: ListProductsFilter): Promise<{ items: Product[]; nextCursor: string | null }> {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(filter.brandId && { brandId: filter.brandId }),
      ...(filter.categoryId && { categoryId: filter.categoryId }),
      ...(filter.status && { status: filter.status }),
      ...(filter.productType && { productType: filter.productType }),
      ...(filter.tags && filter.tags.length > 0 && { tags: { hasSome: filter.tags } }),
      ...(filter.search && {
        OR: [
          { name: { contains: filter.search, mode: 'insensitive' } },
          { slug: { contains: filter.search, mode: 'insensitive' } },
        ],
      }),
      ...(filter.collectionId && { collections: { some: { collectionId: filter.collectionId } } }),
    };

    const field = sortColumn(filter.sortField);
    const dir = filter.sortDir ?? 'desc';

    if (filter.cursor) {
      const { sortValue, id } = decodeCursor(filter.cursor);
      const cursorValue: Date | string = field === 'name' ? sortValue : new Date(sortValue);
      const cmp = dir === 'desc' ? 'lt' : 'gt';
      const andClauses: Prisma.ProductWhereInput[] = [
        { AND: [where, { [field]: { [cmp]: cursorValue } }] },
        { AND: [where, { [field]: cursorValue, id: { [cmp]: id } }] },
      ];
      // OR-ing the tie-break clause with the base filter (rather than
      // bolting `where.OR` on directly) keeps every original filter field
      // intact even though a cursor also needs an OR for its own tie-break.
      const rows = await prisma.product.findMany({
        where: { OR: andClauses },
        orderBy: [{ [field]: dir }, { id: dir }],
        take: filter.limit + 1,
      });
      return this.toPage(rows, filter.limit, field);
    }

    const rows = await prisma.product.findMany({
      where,
      orderBy: [{ [field]: dir }, { id: dir }],
      take: filter.limit + 1,
    });
    return this.toPage(rows, filter.limit, field);
  }

  private toPage(
    rows: PrismaProduct[],
    limit: number,
    field: 'createdAt' | 'publishedAt' | 'name',
  ): { items: Product[]; nextCursor: string | null } {
    const { page, hasMore } = splitPage(rows, limit);
    const last = page.at(-1);
    const sortValue = last
      ? field === 'name'
        ? last.name
        : (last[field]?.toISOString() ?? '')
      : '';

    return {
      items: page.map(toDomain),
      nextCursor: hasMore && last ? encodeCursor(sortValue, last.id) : null,
    };
  }

  async create(props: {
    productType: ProductType;
    brandId: string;
    categoryId: string;
    name: string;
    slug: string;
    localizedName?: LocalizedText | null;
    shortDescription?: string | null;
    longDescription?: string | null;
    specifications?: Record<string, unknown> | null;
    tags?: string[];
    arModelMediaId?: string | null;
    faceTryOnMetadata?: Record<string, unknown> | null;
    seo?: SeoMetadata | null;
  }): Promise<Product> {
    const row = await prisma.product.create({
      data: {
        productType: props.productType,
        brandId: props.brandId,
        categoryId: props.categoryId,
        name: props.name,
        slug: props.slug,
        localizedName: toJson(props.localizedName ?? null),
        shortDescription: props.shortDescription ?? null,
        longDescription: props.longDescription ?? null,
        specifications: toJson(props.specifications ?? null),
        tags: props.tags ?? [],
        arModelMediaId: props.arModelMediaId ?? null,
        faceTryOnMetadata: toJson(props.faceTryOnMetadata ?? null),
        seo: toJson(props.seo ?? null),
      },
    });
    return toDomain(row);
  }

  async update(
    id: ProductId,
    props: Partial<{
      brandId: string;
      categoryId: string;
      name: string;
      slug: string;
      localizedName: LocalizedText | null;
      shortDescription: string | null;
      longDescription: string | null;
      specifications: Record<string, unknown> | null;
      tags: string[];
      arModelMediaId: string | null;
      faceTryOnMetadata: Record<string, unknown> | null;
      seo: SeoMetadata | null;
    }>,
  ): Promise<Product> {
    const row = await prisma.product.update({
      where: { id },
      data: {
        ...(props.brandId !== undefined && { brandId: props.brandId }),
        ...(props.categoryId !== undefined && { categoryId: props.categoryId }),
        ...(props.name !== undefined && { name: props.name }),
        ...(props.slug !== undefined && { slug: props.slug }),
        ...(props.localizedName !== undefined && { localizedName: toJson(props.localizedName) }),
        ...(props.shortDescription !== undefined && { shortDescription: props.shortDescription }),
        ...(props.longDescription !== undefined && { longDescription: props.longDescription }),
        ...(props.specifications !== undefined && { specifications: toJson(props.specifications) }),
        ...(props.tags !== undefined && { tags: props.tags }),
        ...(props.arModelMediaId !== undefined && { arModelMediaId: props.arModelMediaId }),
        ...(props.faceTryOnMetadata !== undefined && {
          faceTryOnMetadata: toJson(props.faceTryOnMetadata),
        }),
        ...(props.seo !== undefined && { seo: toJson(props.seo) }),
      },
    });
    return toDomain(row);
  }

  async updateStatus(
    id: ProductId,
    props: {
      status: ProductLifecycleStatus;
      reviewedBy?: string | null;
      approvedBy?: string | null;
      approvedAt?: Date | null;
      publishedAt?: Date | null;
      unpublishedAt?: Date | null;
      archivedAt?: Date | null;
    },
  ): Promise<Product> {
    const row = await prisma.product.update({
      where: { id },
      data: {
        status: props.status,
        ...(props.reviewedBy !== undefined && { reviewedBy: props.reviewedBy }),
        ...(props.approvedBy !== undefined && { approvedBy: props.approvedBy }),
        ...(props.approvedAt !== undefined && { approvedAt: props.approvedAt }),
        ...(props.publishedAt !== undefined && { publishedAt: props.publishedAt }),
        ...(props.unpublishedAt !== undefined && { unpublishedAt: props.unpublishedAt }),
        ...(props.archivedAt !== undefined && { archivedAt: props.archivedAt }),
      },
    });
    return toDomain(row);
  }

  async softDelete(id: ProductId): Promise<void> {
    await prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

function toDomain(row: PrismaProduct): Product {
  return Product.create({
    id: row.id,
    productType: row.productType,
    brandId: row.brandId,
    categoryId: row.categoryId,
    name: row.name,
    slug: row.slug,
    localizedName: fromJson(row.localizedName),
    shortDescription: row.shortDescription,
    longDescription: row.longDescription,
    specifications: fromJson(row.specifications),
    tags: row.tags,
    status: row.status,
    reviewedBy: row.reviewedBy,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    publishedAt: row.publishedAt,
    unpublishedAt: row.unpublishedAt,
    archivedAt: row.archivedAt,
    arModelMediaId: row.arModelMediaId,
    faceTryOnMetadata: fromJson(row.faceTryOnMetadata),
    seo: fromJson(row.seo),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}
