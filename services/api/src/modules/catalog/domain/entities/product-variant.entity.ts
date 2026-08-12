import {
  asProductId,
  asProductVariantId,
  type CatalogStatus,
  type ProductGender,
  type ProductId,
  type ProductVariantId,
} from '@iecp/types';

/** One merchandising configuration of a Product (color × size, etc — blueprint
 * §8). Carries optical measurement/merchandising attributes only — no
 * price/cost/barcode, see ProductSku and ADR-005 decision 1. */
export class ProductVariant {
  private constructor(
    public readonly id: ProductVariantId,
    public readonly productId: ProductId,
    public readonly label: string | null,
    public readonly color: string | null,
    public readonly colorHex: string | null,
    public readonly size: string | null,
    public readonly frameShape: string | null,
    public readonly frameMaterial: string | null,
    public readonly frameWidthMm: number | null,
    public readonly bridgeWidthMm: number | null,
    public readonly templeLengthMm: number | null,
    public readonly lensWidthMm: number | null,
    public readonly fit: string | null,
    public readonly gender: ProductGender | null,
    public readonly style: string | null,
    public readonly lensCompatibility: readonly string[],
    public readonly isDefault: boolean,
    public readonly status: CatalogStatus,
    public readonly sortOrder: number,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly deletedAt: Date | null,
  ) {}

  static create(props: {
    id: string;
    productId: string;
    label?: string | null;
    color?: string | null;
    colorHex?: string | null;
    size?: string | null;
    frameShape?: string | null;
    frameMaterial?: string | null;
    frameWidthMm?: number | null;
    bridgeWidthMm?: number | null;
    templeLengthMm?: number | null;
    lensWidthMm?: number | null;
    fit?: string | null;
    gender?: ProductGender | null;
    style?: string | null;
    lensCompatibility?: readonly string[];
    isDefault?: boolean;
    status?: CatalogStatus;
    sortOrder?: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  }): ProductVariant {
    return new ProductVariant(
      asProductVariantId(props.id),
      asProductId(props.productId),
      props.label ?? null,
      props.color ?? null,
      props.colorHex ?? null,
      props.size ?? null,
      props.frameShape ?? null,
      props.frameMaterial ?? null,
      props.frameWidthMm ?? null,
      props.bridgeWidthMm ?? null,
      props.templeLengthMm ?? null,
      props.lensWidthMm ?? null,
      props.fit ?? null,
      props.gender ?? null,
      props.style ?? null,
      props.lensCompatibility ?? [],
      props.isDefault ?? false,
      props.status ?? 'ACTIVE',
      props.sortOrder ?? 0,
      props.createdAt,
      props.updatedAt,
      props.deletedAt ?? null,
    );
  }
}
