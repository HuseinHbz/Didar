import {
  asProductId,
  asProductSkuId,
  asProductVariantId,
  type ProductId,
  type ProductSkuId,
  type ProductVariantId,
  type SkuStatus,
} from '@iecp/types';

/** The sellable/priced/inventoried unit (ADR-005 decision 1). Cost/price
 * live in finance.ProductPrice, not here — see that entity. */
export class ProductSku {
  private constructor(
    public readonly id: ProductSkuId,
    public readonly productId: ProductId,
    public readonly variantId: ProductVariantId,
    public readonly skuCode: string,
    public readonly barcode: string | null,
    public readonly status: SkuStatus,
    public readonly weightGrams: number | null,
    public readonly lengthMm: number | null,
    public readonly widthMm: number | null,
    public readonly heightMm: number | null,
    public readonly taxRateBasisPoints: number | null,
    public readonly supplierRef: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly deletedAt: Date | null,
  ) {}

  static create(props: {
    id: string;
    productId: string;
    variantId: string;
    skuCode: string;
    barcode?: string | null;
    status?: SkuStatus;
    weightGrams?: number | null;
    lengthMm?: number | null;
    widthMm?: number | null;
    heightMm?: number | null;
    taxRateBasisPoints?: number | null;
    supplierRef?: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  }): ProductSku {
    return new ProductSku(
      asProductSkuId(props.id),
      asProductId(props.productId),
      asProductVariantId(props.variantId),
      props.skuCode,
      props.barcode ?? null,
      props.status ?? 'ACTIVE',
      props.weightGrams ?? null,
      props.lengthMm ?? null,
      props.widthMm ?? null,
      props.heightMm ?? null,
      props.taxRateBasisPoints ?? null,
      props.supplierRef ?? null,
      props.createdAt,
      props.updatedAt,
      props.deletedAt ?? null,
    );
  }

  get isSellable(): boolean {
    return this.status === 'ACTIVE' && this.deletedAt === null;
  }
}
