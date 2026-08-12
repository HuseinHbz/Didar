import type {
  LocalizedText,
  ProductAttributeId,
  ProductAttributeValueId,
  ProductVariantId,
} from '@iecp/types';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ProductAttributeValue } from '../domain/entities/product-attribute-value.entity';
import { ProductAttribute } from '../domain/entities/product-attribute.entity';
import {
  ATTRIBUTE_REPOSITORY,
  type AttributeRepositoryPort,
} from '../domain/ports/attribute.repository.port';
import { AttributeValueValidator } from '../domain/services/attribute-value-validator';

@Injectable()
export class AttributesService {
  constructor(@Inject(ATTRIBUTE_REPOSITORY) private readonly attributes: AttributeRepositoryPort) {}

  listAttributes(filterableOnly?: boolean): Promise<ProductAttribute[]> {
    return this.attributes.listAttributes(filterableOnly);
  }

  listValues(attributeId: ProductAttributeId): Promise<ProductAttributeValue[]> {
    return this.attributes.listValues(attributeId);
  }

  async createAttribute(input: {
    key: string;
    name: string;
    localizedName?: LocalizedText | null;
    isFilterable?: boolean;
  }): Promise<ProductAttribute> {
    if (await this.attributes.findAttributeByKey(input.key)) {
      throw new ConflictException(`Attribute key "${input.key}" already exists`);
    }
    return this.attributes.createAttribute(input);
  }

  async createValue(input: {
    attributeId: string;
    value: string;
    localizedValue?: LocalizedText | null;
    sortOrder?: number;
  }): Promise<ProductAttributeValue> {
    const attribute = await this.attributes.findAttributeById(
      input.attributeId as ProductAttributeId,
    );
    if (!attribute) throw new NotFoundException('Attribute not found');
    return this.attributes.createValue(input);
  }

  async assignToVariant(
    variantId: ProductVariantId,
    attributeValueId: ProductAttributeValueId,
  ): Promise<void> {
    const value = await this.attributes.findValueById(attributeValueId);
    if (!value) throw new NotFoundException('Attribute value not found');

    const current = await this.attributes.listVariantAssignments(variantId);
    AttributeValueValidator.assertNoDuplicateAttributes([
      ...current.filter((a) => a.attributeId !== value.attributeId),
      { attributeId: value.attributeId },
    ]);

    await this.attributes.assignToVariant(variantId, attributeValueId);
  }

  async unassignFromVariant(
    variantId: ProductVariantId,
    attributeValueId: ProductAttributeValueId,
  ): Promise<void> {
    await this.attributes.unassignFromVariant(variantId, attributeValueId);
  }

  listVariantAssignments(
    variantId: ProductVariantId,
  ): Promise<{ attributeId: string; attributeValueId: string }[]> {
    return this.attributes.listVariantAssignments(variantId);
  }
}
