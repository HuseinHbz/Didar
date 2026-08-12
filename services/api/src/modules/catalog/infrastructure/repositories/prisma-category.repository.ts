import { prisma, type Category as PrismaCategory, type Prisma } from '@iecp/database';
import type { CategoryId, LocalizedText, SeoMetadata } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { Category } from '../../domain/entities/category.entity';
import type {
  CategoryRepositoryPort,
  ListCategoriesFilter,
} from '../../domain/ports/category.repository.port';
import type { CategoryNode } from '../../domain/services/category-hierarchy';
import { fromJson, toJson } from '../json.util';
import { decodeCursor, encodeCursor, splitPage } from '../pagination.util';

@Injectable()
export class PrismaCategoryRepository implements CategoryRepositoryPort {
  async findById(id: CategoryId): Promise<Category | null> {
    const row = await prisma.category.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findBySlug(slug: string): Promise<Category | null> {
    const row = await prisma.category.findUnique({ where: { slug } });
    return row ? toDomain(row) : null;
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const row = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
    return row !== null;
  }

  async list(
    filter: ListCategoriesFilter,
  ): Promise<{ items: Category[]; nextCursor: string | null }> {
    const where: Prisma.CategoryWhereInput = {
      deletedAt: null,
      ...(filter.parentId !== undefined && { parentId: filter.parentId }),
      ...(filter.status && { status: filter.status }),
    };
    if (filter.cursor) {
      const { sortValue, id } = decodeCursor(filter.cursor);
      where.OR = [
        { createdAt: { lt: new Date(sortValue) } },
        { createdAt: new Date(sortValue), id: { lt: id } },
      ];
    }

    const rows = await prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });
    const { page, hasMore } = splitPage(rows, filter.limit);
    const last = page.at(-1);

    return {
      items: page.map(toDomain),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
    };
  }

  async listAllNodes(): Promise<CategoryNode[]> {
    const rows = await prisma.category.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true },
    });
    return rows;
  }

  async create(props: {
    parentId?: string | null;
    name: string;
    slug: string;
    localizedName?: LocalizedText | null;
    description?: string | null;
    imageMediaId?: string | null;
    sortOrder?: number;
    seo?: SeoMetadata | null;
  }): Promise<Category> {
    const row = await prisma.category.create({
      data: {
        parentId: props.parentId ?? null,
        name: props.name,
        slug: props.slug,
        localizedName: toJson(props.localizedName ?? null),
        description: props.description ?? null,
        imageMediaId: props.imageMediaId ?? null,
        sortOrder: props.sortOrder ?? 0,
        seo: toJson(props.seo ?? null),
      },
    });
    return toDomain(row);
  }

  async update(
    id: CategoryId,
    props: Partial<{
      parentId: string | null;
      name: string;
      slug: string;
      localizedName: LocalizedText | null;
      description: string | null;
      imageMediaId: string | null;
      status: 'ACTIVE' | 'INACTIVE';
      publishedAt: Date | null;
      sortOrder: number;
      seo: SeoMetadata | null;
    }>,
  ): Promise<Category> {
    const row = await prisma.category.update({
      where: { id },
      data: {
        ...(props.parentId !== undefined && { parentId: props.parentId }),
        ...(props.name !== undefined && { name: props.name }),
        ...(props.slug !== undefined && { slug: props.slug }),
        ...(props.localizedName !== undefined && { localizedName: toJson(props.localizedName) }),
        ...(props.description !== undefined && { description: props.description }),
        ...(props.imageMediaId !== undefined && { imageMediaId: props.imageMediaId }),
        ...(props.status !== undefined && { status: props.status }),
        ...(props.publishedAt !== undefined && { publishedAt: props.publishedAt }),
        ...(props.sortOrder !== undefined && { sortOrder: props.sortOrder }),
        ...(props.seo !== undefined && { seo: toJson(props.seo) }),
      },
    });
    return toDomain(row);
  }

  async softDelete(id: CategoryId): Promise<void> {
    await prisma.category.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
  }

  async hasChildren(id: CategoryId): Promise<boolean> {
    const count = await prisma.category.count({ where: { parentId: id, deletedAt: null } });
    return count > 0;
  }

  async hasProducts(id: CategoryId): Promise<boolean> {
    const count = await prisma.product.count({ where: { categoryId: id, deletedAt: null } });
    return count > 0;
  }
}

function toDomain(row: PrismaCategory): Category {
  return Category.create({
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    slug: row.slug,
    localizedName: fromJson(row.localizedName),
    description: row.description,
    imageMediaId: row.imageMediaId,
    sortOrder: row.sortOrder,
    status: row.status,
    publishedAt: row.publishedAt,
    seo: fromJson(row.seo),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}
