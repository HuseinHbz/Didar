import {
  asMediaId,
  type LocalizedText,
  type MediaId,
  type MediaKind,
  type MediaProvider,
  type MediaStatus,
} from '@iecp/types';

/** Storage-agnostic media asset (ADR-005 decision 3) — `provider` +
 * `storageKey` are the abstraction seam; nothing here imports an S3/CDN SDK. */
export class Media {
  private constructor(
    public readonly id: MediaId,
    public readonly provider: MediaProvider,
    public readonly storageKey: string,
    public readonly url: string,
    public readonly kind: MediaKind,
    public readonly mimeType: string,
    public readonly width: number | null,
    public readonly height: number | null,
    public readonly durationMs: number | null,
    public readonly checksum: string | null,
    public readonly altText: LocalizedText | null,
    public readonly status: MediaStatus,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly deletedAt: Date | null,
  ) {}

  static create(props: {
    id: string;
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
    status?: MediaStatus;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  }): Media {
    return new Media(
      asMediaId(props.id),
      props.provider ?? 'LOCAL',
      props.storageKey,
      props.url,
      props.kind,
      props.mimeType,
      props.width ?? null,
      props.height ?? null,
      props.durationMs ?? null,
      props.checksum ?? null,
      props.altText ?? null,
      props.status ?? 'ACTIVE',
      props.createdAt,
      props.updatedAt,
      props.deletedAt ?? null,
    );
  }
}
