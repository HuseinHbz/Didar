import {
  asCategoryId,
  type CategoryId,
  type CatalogStatus,
  type LocalizedText,
  type SeoMetadata,
} from '@iecp/types';

/** blueprint §10 — self-referencing tree, unlimited depth. `status` is the
 * active/inactive switch; `publishedAt` is the separate storefront-visible
 * gate (see ADR-005). */
export class Category {
  private constructor(
    public readonly id: CategoryId,
    public readonly parentId: CategoryId | null,
    public readonly name: string,
    public readonly slug: string,
    public readonly localizedName: LocalizedText | null,
    public readonly description: string | null,
    public readonly imageMediaId: string | null,
    public readonly sortOrder: number,
    public readonly status: CatalogStatus,
    public readonly publishedAt: Date | null,
    public readonly seo: SeoMetadata | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly deletedAt: Date | null,
  ) {}

  static create(props: {
    id: string;
    parentId?: string | null;
    name: string;
    slug: string;
    localizedName?: LocalizedText | null;
    description?: string | null;
    imageMediaId?: string | null;
    sortOrder?: number;
    status?: CatalogStatus;
    publishedAt?: Date | null;
    seo?: SeoMetadata | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  }): Category {
    return new Category(
      asCategoryId(props.id),
      props.parentId ? asCategoryId(props.parentId) : null,
      props.name,
      props.slug,
      props.localizedName ?? null,
      props.description ?? null,
      props.imageMediaId ?? null,
      props.sortOrder ?? 0,
      props.status ?? 'ACTIVE',
      props.publishedAt ?? null,
      props.seo ?? null,
      props.createdAt,
      props.updatedAt,
      props.deletedAt ?? null,
    );
  }

  get isPublished(): boolean {
    return this.publishedAt !== null;
  }
}
