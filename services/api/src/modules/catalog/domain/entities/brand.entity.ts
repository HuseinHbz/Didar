import {
  asBrandId,
  type BrandId,
  type CatalogStatus,
  type LocalizedText,
  type SeoMetadata,
} from '@iecp/types';

/** blueprint §7 — a brand entity, media-backed logo, SEO-ready. */
export class Brand {
  private constructor(
    public readonly id: BrandId,
    public readonly name: string,
    public readonly slug: string,
    public readonly localizedName: LocalizedText | null,
    public readonly description: string | null,
    public readonly logoMediaId: string | null,
    public readonly status: CatalogStatus,
    public readonly sortOrder: number,
    public readonly seo: SeoMetadata | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly deletedAt: Date | null,
  ) {}

  static create(props: {
    id: string;
    name: string;
    slug: string;
    localizedName?: LocalizedText | null;
    description?: string | null;
    logoMediaId?: string | null;
    status?: CatalogStatus;
    sortOrder?: number;
    seo?: SeoMetadata | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  }): Brand {
    return new Brand(
      asBrandId(props.id),
      props.name,
      props.slug,
      props.localizedName ?? null,
      props.description ?? null,
      props.logoMediaId ?? null,
      props.status ?? 'ACTIVE',
      props.sortOrder ?? 0,
      props.seo ?? null,
      props.createdAt,
      props.updatedAt,
      props.deletedAt ?? null,
    );
  }
}
