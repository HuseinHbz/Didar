import type {
  LocalizedText,
  ProductAttributeId,
  ProductAttributeValueId,
  ProductVariantId,
} from '@iecp/types';

import type { ProductAttributeValue } from '../entities/product-attribute-value.entity';
import type { ProductAttribute } from '../entities/product-attribute.entity';

export const ATTRIBUTE_REPOSITORY = Symbol('ATTRIBUTE_REPOSITORY');

export interface AttributeRepositoryPort {
  listAttributes(filterableOnly?: boolean): Promise<ProductAttribute[]>;
  findAttributeById(id: ProductAttributeId): Promise<ProductAttribute | null>;
  findAttributeByKey(key: string): Promise<ProductAttribute | null>;
  createAttribute(props: {
    key: string;
    name: string;
    localizedName?: LocalizedText | null;
    isFilterable?: boolean;
  }): Promise<ProductAttribute>;

  listValues(attributeId: ProductAttributeId): Promise<ProductAttributeValue[]>;
  findValueById(id: ProductAttributeValueId): Promise<ProductAttributeValue | null>;
  createValue(props: {
    attributeId: string;
    value: string;
    localizedValue?: LocalizedText | null;
    sortOrder?: number;
  }): Promise<ProductAttributeValue>;

  /** `{attributeId, value}` pairs currently assigned to a variant. */
  listVariantAssignments(
    variantId: ProductVariantId,
  ): Promise<{ attributeId: string; attributeValueId: string }[]>;
  assignToVariant(
    variantId: ProductVariantId,
    attributeValueId: ProductAttributeValueId,
  ): Promise<void>;
  unassignFromVariant(
    variantId: ProductVariantId,
    attributeValueId: ProductAttributeValueId,
  ): Promise<void>;
}
