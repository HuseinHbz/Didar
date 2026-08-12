import type { CatalogStatus, ProductGender } from '@iecp/types';
import { PRODUCT_GENDERS } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import type { ProductVariant } from '../../domain/entities/product-variant.entity';

export class VariantResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty({ nullable: true }) label!: string | null;
  @ApiProperty({ nullable: true }) color!: string | null;
  @ApiProperty({ nullable: true }) colorHex!: string | null;
  @ApiProperty({ nullable: true }) size!: string | null;
  @ApiProperty({ nullable: true }) frameShape!: string | null;
  @ApiProperty({ nullable: true }) frameMaterial!: string | null;
  @ApiProperty({ nullable: true }) frameWidthMm!: number | null;
  @ApiProperty({ nullable: true }) bridgeWidthMm!: number | null;
  @ApiProperty({ nullable: true }) templeLengthMm!: number | null;
  @ApiProperty({ nullable: true }) lensWidthMm!: number | null;
  @ApiProperty({ nullable: true }) fit!: string | null;
  @ApiProperty({ nullable: true, enum: PRODUCT_GENDERS }) gender!: ProductGender | null;
  @ApiProperty({ nullable: true }) style!: string | null;
  @ApiProperty({ type: [String] }) lensCompatibility!: readonly string[];
  @ApiProperty() isDefault!: boolean;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: CatalogStatus;
  @ApiProperty() sortOrder!: number;

  static fromDomain(variant: ProductVariant): VariantResponseDto {
    const dto = new VariantResponseDto();
    Object.assign(dto, {
      id: variant.id,
      productId: variant.productId,
      label: variant.label,
      color: variant.color,
      colorHex: variant.colorHex,
      size: variant.size,
      frameShape: variant.frameShape,
      frameMaterial: variant.frameMaterial,
      frameWidthMm: variant.frameWidthMm,
      bridgeWidthMm: variant.bridgeWidthMm,
      templeLengthMm: variant.templeLengthMm,
      lensWidthMm: variant.lensWidthMm,
      fit: variant.fit,
      gender: variant.gender,
      style: variant.style,
      lensCompatibility: variant.lensCompatibility,
      isDefault: variant.isDefault,
      status: variant.status,
      sortOrder: variant.sortOrder,
    });
    return dto;
  }
}

export class CreateVariantDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productId!: string;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() label?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() color?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  colorHex?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() size?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  frameShape?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  frameMaterial?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  frameWidthMm?: number | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  bridgeWidthMm?: number | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  templeLengthMm?: number | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  lensWidthMm?: number | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() fit?: string | null;
  @ApiProperty({ required: false, nullable: true, enum: PRODUCT_GENDERS })
  @IsOptional()
  @IsIn(PRODUCT_GENDERS)
  gender?: ProductGender | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() style?: string | null;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  lensCompatibility?: string[];

  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateVariantDto {
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() label?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() color?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  colorHex?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() size?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  frameShape?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  frameMaterial?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  frameWidthMm?: number | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  bridgeWidthMm?: number | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  templeLengthMm?: number | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  lensWidthMm?: number | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() fit?: string | null;
  @ApiProperty({ required: false, nullable: true, enum: PRODUCT_GENDERS })
  @IsOptional()
  @IsIn(PRODUCT_GENDERS)
  gender?: ProductGender | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() style?: string | null;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  lensCompatibility?: string[];

  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiProperty({ required: false, enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: CatalogStatus;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() sortOrder?: number;
}
