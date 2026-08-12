import { asProductSkuId, type ProductSkuId } from '@iecp/types';

/** blueprint §12 — pricing is its own domain, not a bare column on the SKU.
 * `validFrom`/`validTo` describe this row's own effective window (Phase 005
 * scheduled pricing) — see ADR-005 decision 2. */
export class ProductPrice {
  private constructor(
    public readonly id: string,
    public readonly productSkuId: ProductSkuId,
    public readonly basePrice: bigint,
    public readonly compareAtPrice: bigint | null,
    public readonly costPrice: bigint | null,
    public readonly currency: string,
    public readonly validFrom: Date | null,
    public readonly validTo: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    productSkuId: string;
    basePrice: bigint;
    compareAtPrice?: bigint | null;
    costPrice?: bigint | null;
    currency?: string;
    validFrom?: Date | null;
    validTo?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): ProductPrice {
    return new ProductPrice(
      props.id,
      asProductSkuId(props.productSkuId),
      props.basePrice,
      props.compareAtPrice ?? null,
      props.costPrice ?? null,
      props.currency ?? 'IRR',
      props.validFrom ?? null,
      props.validTo ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }

  /** Whether this price row is the one that should apply right now. */
  isEffectiveAt(now: Date): boolean {
    if (this.validFrom && now < this.validFrom) return false;
    if (this.validTo && now > this.validTo) return false;
    return true;
  }
}
