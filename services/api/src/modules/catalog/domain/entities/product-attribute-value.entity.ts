import {
  asProductAttributeId,
  asProductAttributeValueId,
  type LocalizedText,
  type ProductAttributeId,
  type ProductAttributeValueId,
} from '@iecp/types';

export class ProductAttributeValue {
  private constructor(
    public readonly id: ProductAttributeValueId,
    public readonly attributeId: ProductAttributeId,
    public readonly value: string,
    public readonly localizedValue: LocalizedText | null,
    public readonly sortOrder: number,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    attributeId: string;
    value: string;
    localizedValue?: LocalizedText | null;
    sortOrder?: number;
    createdAt: Date;
  }): ProductAttributeValue {
    return new ProductAttributeValue(
      asProductAttributeValueId(props.id),
      asProductAttributeId(props.attributeId),
      props.value,
      props.localizedValue ?? null,
      props.sortOrder ?? 0,
      props.createdAt,
    );
  }
}
