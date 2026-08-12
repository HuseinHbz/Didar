import type { LocalizedText, ProductId, ProductType, SeoMetadata, UserId } from '@iecp/types';
import { slugSchema } from '@iecp/validation';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import { Product } from '../domain/entities/product.entity';
import {
  PRODUCT_REPOSITORY,
  type ListProductsFilter,
  type ProductRepositoryPort,
} from '../domain/ports/product.repository.port';
import { ProductLifecycleStateMachine } from '../domain/services/product-lifecycle-state-machine';
import { SlugGenerator } from '../domain/services/slug-generator';

export interface BulkOperationResult {
  succeeded: string[];
  failed: { id: string; reason: string }[];
}

/**
 * Product admin CRUD + the publication lifecycle (Phase 005
 * `admin_workflows.product_creation` / `.sensitive_operations`). Every
 * status transition goes through ProductLifecycleStateMachine before it
 * ever reaches the repository, and every transition that changes what's
 * publicly visible writes a `system.AuditLog` row — the first real writer
 * of that table (Phase 004 built the read side; see this module's README).
 */
@Injectable()
export class ProductsService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
  ) {}

  async get(id: ProductId): Promise<Product> {
    const product = await this.products.findById(id);
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async getBySlug(slug: string): Promise<Product> {
    const product = await this.products.findBySlug(slug);
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  list(filter: ListProductsFilter): Promise<{ items: Product[]; nextCursor: string | null }> {
    return this.products.list(filter);
  }

  async create(input: {
    productType: ProductType;
    brandId: string;
    categoryId: string;
    name: string;
    slug?: string;
    localizedName?: LocalizedText | null;
    shortDescription?: string | null;
    longDescription?: string | null;
    specifications?: Record<string, unknown> | null;
    tags?: string[];
    arModelMediaId?: string | null;
    faceTryOnMetadata?: Record<string, unknown> | null;
    seo?: SeoMetadata | null;
  }): Promise<Product> {
    const slug = await this.resolveSlug(input.slug ?? input.name);
    return this.products.create({ ...input, slug });
  }

  async update(
    id: ProductId,
    input: Partial<{
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
    await this.get(id);
    if (input.slug !== undefined) {
      slugSchema.parse(input.slug);
      const existing = await this.products.findBySlug(input.slug);
      if (existing && existing.id !== id) {
        throw new ConflictException(`Slug "${input.slug}" is already in use`);
      }
    }
    return this.products.update(id, input);
  }

  async delete(id: ProductId, actorId: UserId): Promise<void> {
    const product = await this.get(id);
    if (product.status !== 'DRAFT' && product.status !== 'ARCHIVED') {
      throw new ConflictException(
        'Only a DRAFT or ARCHIVED product can be deleted — archive it first',
      );
    }
    await this.products.softDelete(id);
    await this.auditLog.record({
      actorId,
      action: 'PRODUCT_DELETED',
      entityType: 'Product',
      entityId: id,
    });
  }

  async submitForReview(id: ProductId, actorId: UserId): Promise<Product> {
    return this.transition(id, 'IN_REVIEW', actorId, { reviewedBy: actorId });
  }

  async approve(id: ProductId, actorId: UserId): Promise<Product> {
    return this.transition(id, 'APPROVED', actorId, {
      approvedBy: actorId,
      approvedAt: new Date(),
    });
  }

  async rejectToDraft(id: ProductId, actorId: UserId): Promise<Product> {
    return this.transition(id, 'DRAFT', actorId, {});
  }

  async publish(id: ProductId, actorId: UserId): Promise<Product> {
    return this.transition(
      id,
      'PUBLISHED',
      actorId,
      { publishedAt: new Date() },
      'PRODUCT_PUBLISHED',
    );
  }

  async unpublish(id: ProductId, actorId: UserId): Promise<Product> {
    return this.transition(
      id,
      'UNPUBLISHED',
      actorId,
      { unpublishedAt: new Date() },
      'PRODUCT_UNPUBLISHED',
    );
  }

  async archive(id: ProductId, actorId: UserId): Promise<Product> {
    return this.transition(id, 'ARCHIVED', actorId, { archivedAt: new Date() }, 'PRODUCT_ARCHIVED');
  }

  async bulkPublish(ids: ProductId[], actorId: UserId): Promise<BulkOperationResult> {
    return this.bulk(ids, (id) => this.publish(id, actorId));
  }

  async bulkArchive(ids: ProductId[], actorId: UserId): Promise<BulkOperationResult> {
    return this.bulk(ids, (id) => this.archive(id, actorId));
  }

  private async bulk(
    ids: ProductId[],
    op: (id: ProductId) => Promise<unknown>,
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = { succeeded: [], failed: [] };
    // Sequential, not Promise.all — a bulk operation is expected to report
    // which individual items failed and why, not abort the whole batch on
    // the first error (blueprint's bulk-operations requirement).
    for (const id of ids) {
      try {
        await op(id);
        result.succeeded.push(id);
      } catch (error) {
        result.failed.push({
          id,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    return result;
  }

  private async transition(
    id: ProductId,
    to: Product['status'],
    actorId: UserId,
    extra: Partial<{
      reviewedBy: string | null;
      approvedBy: string | null;
      approvedAt: Date | null;
      publishedAt: Date | null;
      unpublishedAt: Date | null;
      archivedAt: Date | null;
    }>,
    auditAction?: string,
  ): Promise<Product> {
    const product = await this.get(id);
    ProductLifecycleStateMachine.assertTransition(product.status, to);

    const updated = await this.products.updateStatus(id, { status: to, ...extra });

    if (auditAction) {
      await this.auditLog.record({
        actorId,
        action: auditAction,
        entityType: 'Product',
        entityId: id,
        oldValue: { status: product.status },
        newValue: { status: to },
      });
    }

    return updated;
  }

  private async resolveSlug(seed: string): Promise<string> {
    const base = slugSchema.safeParse(seed).success ? seed : SlugGenerator.base(seed);
    for (let attempt = 1; attempt <= 20; attempt++) {
      const candidate = SlugGenerator.withSuffix(base, attempt);
      if (!(await this.products.existsBySlug(candidate))) {
        return candidate;
      }
    }
    throw new ConflictException('Could not derive a unique slug — please provide one explicitly');
  }
}

// Re-exported so DTOs/controllers can validate against the same "only
// DRAFT/ARCHIVED products are deletable" rule without importing the domain
// state machine module directly.
export const isDeletableStatus = (status: Product['status']): boolean =>
  status === 'DRAFT' || status === 'ARCHIVED';
