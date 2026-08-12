import type { LocalizedText, MediaId, MediaKind, MediaProvider } from '@iecp/types';

import type { Media } from '../entities/media.entity';

export const MEDIA_REPOSITORY = Symbol('MEDIA_REPOSITORY');

export interface MediaRepositoryPort {
  findById(id: MediaId): Promise<Media | null>;
  findManyByIds(ids: MediaId[]): Promise<Media[]>;
  create(props: {
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
  }): Promise<Media>;
  update(
    id: MediaId,
    props: Partial<{ altText: LocalizedText | null; status: 'ACTIVE' | 'ARCHIVED' }>,
  ): Promise<Media>;
  /** True if any `ProductMedia` row still references this asset — the
   * RESTRICT FK backs this at the DB level too; this lets the use case
   * return a clean 409 instead of surfacing a raw constraint violation. */
  isInUse(id: MediaId): Promise<boolean>;
  softDelete(id: MediaId): Promise<void>;
}
