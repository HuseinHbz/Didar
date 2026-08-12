import { asProductAttributeId, type LocalizedText, type ProductAttributeId } from '@iecp/types';

/** Attribute *definition* (blueprint §9/§11: admin-defined, drives the
 * Dynamic Filter Engine) — for open-ended tags the fixed ProductVariant
 * columns don't cover. */
export class ProductAttribute {
  private constructor(
    public readonly id: ProductAttributeId,
    public readonly key: string,
    public readonly name: string,
    public readonly localizedName: LocalizedText | null,
    public readonly isFilterable: boolean,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    key: string;
    name: string;
    localizedName?: LocalizedText | null;
    isFilterable?: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ProductAttribute {
    return new ProductAttribute(
      asProductAttributeId(props.id),
      props.key,
      props.name,
      props.localizedName ?? null,
      props.isFilterable ?? true,
      props.createdAt,
      props.updatedAt,
    );
  }
}
