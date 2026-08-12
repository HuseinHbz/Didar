import {
  asMediaId,
  asProductId,
  asProductVariantId,
  type LocalizedText,
  type MediaId,
  type MediaRole,
  type ProductId,
  type ProductVariantId,
} from '@iecp/types';

/** Attaches a Media asset to a product (`variantId = null`) or one specific
 * variant. See Media's own doc comment for the RESTRICT-on-delete rationale. */
export class ProductMedia {
  private constructor(
    public readonly id: string,
    public readonly productId: ProductId,
    public readonly variantId: ProductVariantId | null,
    public readonly mediaId: MediaId,
    public readonly role: MediaRole,
    public readonly sortOrder: number,
    public readonly altTextOverride: LocalizedText | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    productId: string;
    variantId?: string | null;
    mediaId: string;
    role?: MediaRole;
    sortOrder?: number;
    altTextOverride?: LocalizedText | null;
    createdAt: Date;
  }): ProductMedia {
    return new ProductMedia(
      props.id,
      asProductId(props.productId),
      props.variantId ? asProductVariantId(props.variantId) : null,
      asMediaId(props.mediaId),
      props.role ?? 'GALLERY',
      props.sortOrder ?? 0,
      props.altTextOverride ?? null,
      props.createdAt,
    );
  }
}
