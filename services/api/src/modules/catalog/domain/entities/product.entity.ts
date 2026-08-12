import {
  asBrandId,
  asCategoryId,
  asProductId,
  asUserId,
  type BrandId,
  type CategoryId,
  type LocalizedText,
  type ProductId,
  type ProductLifecycleStatus,
  type ProductType,
  type SeoMetadata,
  type UserId,
} from '@iecp/types';

/** The merchandising aggregate root (ADR-005 decision 1) — not itself
 * sellable/priced/inventoried, see ProductVariant/ProductSku. `status` is
 * driven only through ProductLifecycleStateMachine. */
export class Product {
  private constructor(
    public readonly id: ProductId,
    public readonly productType: ProductType,
    public readonly brandId: BrandId,
    public readonly categoryId: CategoryId,
    public readonly name: string,
    public readonly slug: string,
    public readonly localizedName: LocalizedText | null,
    public readonly shortDescription: string | null,
    public readonly longDescription: string | null,
    public readonly specifications: Record<string, unknown> | null,
    public readonly tags: readonly string[],
    public readonly status: ProductLifecycleStatus,
    public readonly reviewedBy: UserId | null,
    public readonly approvedBy: UserId | null,
    public readonly approvedAt: Date | null,
    public readonly publishedAt: Date | null,
    public readonly unpublishedAt: Date | null,
    public readonly archivedAt: Date | null,
    public readonly arModelMediaId: string | null,
    public readonly faceTryOnMetadata: Record<string, unknown> | null,
    public readonly seo: SeoMetadata | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly deletedAt: Date | null,
  ) {}

  static create(props: {
    id: string;
    productType: ProductType;
    brandId: string;
    categoryId: string;
    name: string;
    slug: string;
    localizedName?: LocalizedText | null;
    shortDescription?: string | null;
    longDescription?: string | null;
    specifications?: Record<string, unknown> | null;
    tags?: readonly string[];
    status?: ProductLifecycleStatus;
    reviewedBy?: string | null;
    approvedBy?: string | null;
    approvedAt?: Date | null;
    publishedAt?: Date | null;
    unpublishedAt?: Date | null;
    archivedAt?: Date | null;
    arModelMediaId?: string | null;
    faceTryOnMetadata?: Record<string, unknown> | null;
    seo?: SeoMetadata | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  }): Product {
    return new Product(
      asProductId(props.id),
      props.productType,
      asBrandId(props.brandId),
      asCategoryId(props.categoryId),
      props.name,
      props.slug,
      props.localizedName ?? null,
      props.shortDescription ?? null,
      props.longDescription ?? null,
      props.specifications ?? null,
      props.tags ?? [],
      props.status ?? 'DRAFT',
      props.reviewedBy ? asUserId(props.reviewedBy) : null,
      props.approvedBy ? asUserId(props.approvedBy) : null,
      props.approvedAt ?? null,
      props.publishedAt ?? null,
      props.unpublishedAt ?? null,
      props.archivedAt ?? null,
      props.arModelMediaId ?? null,
      props.faceTryOnMetadata ?? null,
      props.seo ?? null,
      props.createdAt,
      props.updatedAt,
      props.deletedAt ?? null,
    );
  }

  get isPubliclyVisible(): boolean {
    return this.status === 'PUBLISHED' && this.deletedAt === null;
  }
}
