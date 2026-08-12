import { prisma, type Collection as PrismaCollection, type Prisma } from '@iecp/database';
import type {
  CollectionId,
  CollectionRules,
  CollectionType,
  LocalizedText,
  SeoMetadata,
} from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { Collection } from '../../domain/entities/collection.entity';
import type {
  CollectionRepositoryPort,
  ListCollectionsFilter,
} from '../../domain/ports/collection.repository.port';
import { fromJson, toJson } from '../json.util';
import { decodeCursor, encodeCursor, splitPage } from '../pagination.util';

/** Translates the fixed CollectionRules shape (ADR-005 decision 4) into a
 * Prisma `where` clause — must agree with CollectionRuleEvaluator's
 * (domain-layer, pure) semantics; see that class's own doc comment. */
function rulesToWhere(rules: CollectionRules): Prisma.ProductWhereInput {
  return {
    ...(rules.brandId && { brandId: rules.brandId }),
    ...(rules.categoryId && { categoryId: rules.categoryId }),
    ...(rules.productType && {
      productType: rules.productType as Prisma.ProductWhereInput['productType'],
    }),
    ...(rules.tags && rules.tags.length > 0 && { tags: { hasSome: rules.tags } }),
    ...(rules.gender && {
      variants: { some: { gender: rules.gender as Prisma.ProductVariantWhereInput['gender'] } },
    }),
  };
}

@Injectable()
export class PrismaCollectionRepository implements CollectionRepositoryPort {
  async findById(id: CollectionId): Promise<Collection | null> {
    const row = await prisma.collection.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findBySlug(slug: string): Promise<Collection | null> {
    const row = await prisma.collection.findUnique({ where: { slug } });
    return row ? toDomain(row) : null;
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const row = await prisma.collection.findUnique({ where: { slug }, select: { id: true } });
    return row !== null;
  }

  async list(
    filter: ListCollectionsFilter,
  ): Promise<{ items: Collection[]; nextCursor: string | null }> {
    const where: Prisma.CollectionWhereInput = {
      deletedAt: null,
      ...(filter.status && { status: filter.status }),
      ...(filter.type && { type: filter.type }),
    };
    if (filter.cursor) {
      const { sortValue, id } = decodeCursor(filter.cursor);
      where.OR = [
        { priority: { lt: Number(sortValue) } },
        { priority: Number(sortValue), id: { lt: id } },
      ];
    }

    const rows = await prisma.collection.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });
    const { page, hasMore } = splitPage(rows, filter.limit);
    const last = page.at(-1);

    return {
      items: page.map(toDomain),
      nextCursor: hasMore && last ? encodeCursor(String(last.priority), last.id) : null,
    };
  }

  async create(props: {
    name: string;
    slug: string;
    localizedName?: LocalizedText | null;
    description?: string | null;
    type?: CollectionType;
    rules?: CollectionRules | null;
    priority?: number;
    startAt?: Date | null;
    endAt?: Date | null;
    imageMediaId?: string | null;
    seo?: SeoMetadata | null;
  }): Promise<Collection> {
    const row = await prisma.collection.create({
      data: {
        name: props.name,
        slug: props.slug,
        localizedName: toJson(props.localizedName ?? null),
        description: props.description ?? null,
        type: props.type ?? 'MANUAL',
        rules: toJson(props.rules ?? null),
        priority: props.priority ?? 0,
        startAt: props.startAt ?? null,
        endAt: props.endAt ?? null,
        imageMediaId: props.imageMediaId ?? null,
        seo: toJson(props.seo ?? null),
      },
    });
    return toDomain(row);
  }

  async update(
    id: CollectionId,
    props: Partial<{
      name: string;
      slug: string;
      localizedName: LocalizedText | null;
      description: string | null;
      type: CollectionType;
      rules: CollectionRules | null;
      priority: number;
      startAt: Date | null;
      endAt: Date | null;
      status: 'ACTIVE' | 'INACTIVE';
      publishedAt: Date | null;
      imageMediaId: string | null;
      seo: SeoMetadata | null;
    }>,
  ): Promise<Collection> {
    const row = await prisma.collection.update({
      where: { id },
      data: {
        ...(props.name !== undefined && { name: props.name }),
        ...(props.slug !== undefined && { slug: props.slug }),
        ...(props.localizedName !== undefined && { localizedName: toJson(props.localizedName) }),
        ...(props.description !== undefined && { description: props.description }),
        ...(props.type !== undefined && { type: props.type }),
        ...(props.rules !== undefined && { rules: toJson(props.rules) }),
        ...(props.priority !== undefined && { priority: props.priority }),
        ...(props.startAt !== undefined && { startAt: props.startAt }),
        ...(props.endAt !== undefined && { endAt: props.endAt }),
        ...(props.status !== undefined && { status: props.status }),
        ...(props.publishedAt !== undefined && { publishedAt: props.publishedAt }),
        ...(props.imageMediaId !== undefined && { imageMediaId: props.imageMediaId }),
        ...(props.seo !== undefined && { seo: toJson(props.seo) }),
      },
    });
    return toDomain(row);
  }

  async softDelete(id: CollectionId): Promise<void> {
    await prisma.collection.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
  }

  async listProductIds(id: CollectionId): Promise<string[]> {
    const rows = await prisma.collectionProduct.findMany({
      where: { collectionId: id },
      orderBy: { sortOrder: 'asc' },
      select: { productId: true },
    });
    return rows.map((r) => r.productId);
  }

  async addProduct(id: CollectionId, productId: string, sortOrder = 0): Promise<void> {
    await prisma.collectionProduct.upsert({
      where: { collectionId_productId: { collectionId: id, productId } },
      update: { sortOrder },
      create: { collectionId: id, productId, sortOrder },
    });
  }

  async removeProduct(id: CollectionId, productId: string): Promise<void> {
    await prisma.collectionProduct.deleteMany({ where: { collectionId: id, productId } });
  }

  async reorderProducts(id: CollectionId, orderedProductIds: string[]): Promise<void> {
    await prisma.$transaction(
      orderedProductIds.map((productId, index) =>
        prisma.collectionProduct.update({
          where: { collectionId_productId: { collectionId: id, productId } },
          data: { sortOrder: index },
        }),
      ),
    );
  }

  async listDynamicMemberProductIds(
    rules: CollectionRules,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: string[]; nextCursor: string | null }> {
    const where: Prisma.ProductWhereInput = {
      ...rulesToWhere(rules),
      status: 'PUBLISHED',
      deletedAt: null,
    };
    if (pagination.cursor) {
      const { sortValue, id } = decodeCursor(pagination.cursor);
      where.OR = [
        { createdAt: { lt: new Date(sortValue) } },
        { createdAt: new Date(sortValue), id: { lt: id } },
      ];
    }

    const rows = await prisma.product.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
      select: { id: true, createdAt: true },
    });
    const { page, hasMore } = splitPage(rows, pagination.limit);
    const last = page.at(-1);

    return {
      items: page.map((r) => r.id),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
    };
  }
}

function toDomain(row: PrismaCollection): Collection {
  return Collection.create({
    id: row.id,
    name: row.name,
    slug: row.slug,
    localizedName: fromJson(row.localizedName),
    description: row.description,
    type: row.type,
    rules: fromJson(row.rules),
    priority: row.priority,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
    publishedAt: row.publishedAt,
    imageMediaId: row.imageMediaId,
    seo: fromJson(row.seo),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}
