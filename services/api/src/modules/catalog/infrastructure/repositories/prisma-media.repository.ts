import { prisma, type Media as PrismaMedia } from '@iecp/database';
import type { LocalizedText, MediaId, MediaKind, MediaProvider } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { Media } from '../../domain/entities/media.entity';
import type { MediaRepositoryPort } from '../../domain/ports/media.repository.port';
import { fromJson, toJson } from '../json.util';

@Injectable()
export class PrismaMediaRepository implements MediaRepositoryPort {
  async findById(id: MediaId): Promise<Media | null> {
    const row = await prisma.media.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findManyByIds(ids: MediaId[]): Promise<Media[]> {
    if (ids.length === 0) return [];
    const rows = await prisma.media.findMany({ where: { id: { in: ids } } });
    return rows.map(toDomain);
  }

  async create(props: {
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
    const row = await prisma.media.create({
      data: {
        provider: props.provider ?? 'LOCAL',
        storageKey: props.storageKey,
        url: props.url,
        kind: props.kind,
        mimeType: props.mimeType,
        width: props.width ?? null,
        height: props.height ?? null,
        durationMs: props.durationMs ?? null,
        checksum: props.checksum ?? null,
        altText: toJson(props.altText ?? null),
      },
    });
    return toDomain(row);
  }

  async update(
    id: MediaId,
    props: Partial<{ altText: LocalizedText | null; status: 'ACTIVE' | 'ARCHIVED' }>,
  ): Promise<Media> {
    const row = await prisma.media.update({
      where: { id },
      data: {
        ...(props.altText !== undefined && { altText: toJson(props.altText) }),
        ...(props.status !== undefined && { status: props.status }),
      },
    });
    return toDomain(row);
  }

  async isInUse(id: MediaId): Promise<boolean> {
    const [productMediaCount, brandCount, categoryCount, collectionCount, productArModelCount] =
      await Promise.all([
        prisma.productMedia.count({ where: { mediaId: id } }),
        prisma.brand.count({ where: { logoMediaId: id, deletedAt: null } }),
        prisma.category.count({ where: { imageMediaId: id, deletedAt: null } }),
        prisma.collection.count({ where: { imageMediaId: id, deletedAt: null } }),
        prisma.product.count({ where: { arModelMediaId: id, deletedAt: null } }),
      ]);
    return (
      productMediaCount + brandCount + categoryCount + collectionCount + productArModelCount > 0
    );
  }

  async softDelete(id: MediaId): Promise<void> {
    await prisma.media.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });
  }
}

function toDomain(row: PrismaMedia): Media {
  return Media.create({
    id: row.id,
    provider: row.provider,
    storageKey: row.storageKey,
    url: row.url,
    kind: row.kind,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    checksum: row.checksum,
    altText: fromJson(row.altText),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}
