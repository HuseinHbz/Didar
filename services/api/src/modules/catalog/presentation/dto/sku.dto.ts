import type { SkuStatus } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

import type { ProductSku } from '../../domain/entities/product-sku.entity';

export class SkuResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty({ format: 'uuid' }) variantId!: string;
  @ApiProperty() skuCode!: string;
  @ApiProperty({ nullable: true }) barcode!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'DISCONTINUED'] }) status!: SkuStatus;
  @ApiProperty({ nullable: true }) weightGrams!: number | null;
  @ApiProperty({ nullable: true }) lengthMm!: number | null;
  @ApiProperty({ nullable: true }) widthMm!: number | null;
  @ApiProperty({ nullable: true }) heightMm!: number | null;
  @ApiProperty({ nullable: true }) taxRateBasisPoints!: number | null;
  @ApiProperty({ nullable: true }) supplierRef!: string | null;

  static fromDomain(sku: ProductSku): SkuResponseDto {
    const dto = new SkuResponseDto();
    dto.id = sku.id;
    dto.productId = sku.productId;
    dto.variantId = sku.variantId;
    dto.skuCode = sku.skuCode;
    dto.barcode = sku.barcode;
    dto.status = sku.status;
    dto.weightGrams = sku.weightGrams;
    dto.lengthMm = sku.lengthMm;
    dto.widthMm = sku.widthMm;
    dto.heightMm = sku.heightMm;
    dto.taxRateBasisPoints = sku.taxRateBasisPoints;
    dto.supplierRef = sku.supplierRef;
    return dto;
  }
}

export class CreateSkuDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() variantId!: string;
  @ApiProperty() @IsString() skuCode!: string;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() barcode?:
    string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  weightGrams?: number | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() lengthMm?: number | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() widthMm?: number | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() heightMm?: number | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  taxRateBasisPoints?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  supplierRef?: string | null;
}

export class UpdateSkuDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() skuCode?: string;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() barcode?:
    string | null;
  @ApiProperty({ required: false, enum: ['ACTIVE', 'INACTIVE', 'DISCONTINUED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'DISCONTINUED'])
  status?: SkuStatus;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  weightGrams?: number | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() lengthMm?: number | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() widthMm?: number | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() heightMm?: number | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  taxRateBasisPoints?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  supplierRef?: string | null;
}
