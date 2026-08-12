import type { LocalizedText } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

import type { ProductAttributeValue } from '../../domain/entities/product-attribute-value.entity';
import type { ProductAttribute } from '../../domain/entities/product-attribute.entity';

export class AttributeResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: Object }) localizedName!: LocalizedText | null;
  @ApiProperty() isFilterable!: boolean;

  static fromDomain(attribute: ProductAttribute): AttributeResponseDto {
    const dto = new AttributeResponseDto();
    dto.id = attribute.id;
    dto.key = attribute.key;
    dto.name = attribute.name;
    dto.localizedName = attribute.localizedName;
    dto.isFilterable = attribute.isFilterable;
    return dto;
  }
}

export class AttributeValueResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) attributeId!: string;
  @ApiProperty() value!: string;
  @ApiProperty({ nullable: true, type: Object }) localizedValue!: LocalizedText | null;
  @ApiProperty() sortOrder!: number;

  static fromDomain(value: ProductAttributeValue): AttributeValueResponseDto {
    const dto = new AttributeValueResponseDto();
    dto.id = value.id;
    dto.attributeId = value.attributeId;
    dto.value = value.value;
    dto.localizedValue = value.localizedValue;
    dto.sortOrder = value.sortOrder;
    return dto;
  }
}

export class CreateAttributeDto {
  @ApiProperty() @IsString() @MinLength(1) key!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  localizedName?: LocalizedText | null;

  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isFilterable?: boolean;
}

export class CreateAttributeValueDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() attributeId!: string;
  @ApiProperty() @IsString() @MinLength(1) value!: string;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  localizedValue?: LocalizedText | null;

  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
