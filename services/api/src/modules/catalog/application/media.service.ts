import type {
  LocalizedText,
  MediaId,
  MediaKind,
  MediaProvider,
  MediaRole,
  ProductId,
  ProductVariantId,
} from '@iecp/types';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { Media } from '../domain/entities/media.entity';
import { ProductMedia } from '../domain/entities/product-media.entity';
import { MEDIA_REPOSITORY, type MediaRepositoryPort } from '../domain/ports/media.repository.port';
import {
  PRODUCT_MEDIA_REPOSITORY,
  type ProductMediaRepositoryPort,
} from '../domain/ports/product-media.repository.port';

/**
 * Media registration + product attachment. No upload endpoint this pass
 * (ADR-005 decision 3/"Deferred") — `register` takes an already-hosted
 * `storageKey`/`url`, the same shape Phase 003's `ProductImage.url` had.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(MEDIA_REPOSITORY) private readonly media: MediaRepositoryPort,
    @Inject(PRODUCT_MEDIA_REPOSITORY) private readonly productMedia: ProductMediaRepositoryPort,
  ) {}

  async get(id: MediaId): Promise<Media> {
    const asset = await this.media.findById(id);
    if (!asset) throw new NotFoundException('Media not found');
    return asset;
  }

  async register(input: {
    provider?: MediaProvider;
    storageKey: string;
    url: string;
    kind: MediaKind;
    mimeType: string;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
    checksum?: string | null;
    altText?: LocalizedText | null;
  }): Promise<Media> {
    return this.media.create(input);
  }

  async delete(id: MediaId): Promise<void> {
    await this.get(id);
    if (await this.media.isInUse(id)) {
      throw new ConflictException('This media asset is still attached somewhere — detach it first');
    }
    await this.media.softDelete(id);
  }

  listForProduct(productId: ProductId): Promise<ProductMedia[]> {
    return this.productMedia.listByProduct(productId);
  }

  async attach(input: {
    productId: string;
    variantId?: string | null;
    mediaId: string;
    role?: MediaRole;
    sortOrder?: number;
    altTextOverride?: LocalizedText | null;
  }): Promise<ProductMedia> {
    await this.get(input.mediaId as MediaId);
    if (input.role === 'PRIMARY') {
      // Enforced here, not a DB constraint — see ProductMediaRepositoryPort's
      // own doc comment for why (no partial unique index in this pass).
      await this.productMedia.clearPrimary(
        input.productId as ProductId,
        (input.variantId ?? null) as ProductVariantId | null,
      );
    }
    return this.productMedia.attach(input);
  }

  async detach(id: string): Promise<void> {
    await this.productMedia.detach(id);
  }

  async reorder(productId: ProductId, orderedIds: string[]): Promise<void> {
    await this.productMedia.reorder(productId, orderedIds);
  }
}
