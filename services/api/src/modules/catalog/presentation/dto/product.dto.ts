import type { LocalizedText, ProductLifecycleStatus, ProductType, SeoMetadata } from '@iecp/types';
import { PRODUCT_TYPES } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

import type { Product } from '../../domain/entities/product.entity';

import { PaginationQueryDto } from './pagination.dto';

const LIFECYCLE_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
] as const;

export class ProductResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: PRODUCT_TYPES }) productType!: ProductType;
  @ApiProperty({ format: 'uuid' }) brandId!: string;
  @ApiProperty({ format: 'uuid' }) categoryId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true, type: Object }) localizedName!: LocalizedText | null;
  @ApiProperty({ nullable: true }) shortDescription!: string | null;
  @ApiProperty({ nullable: true }) longDescription!: string | null;
  @ApiProperty({ nullable: true, type: Object }) specifications!: Record<string, unknown> | null;
  @ApiProperty({ type: [String] }) tags!: readonly string[];
  @ApiProperty({ enum: LIFECYCLE_STATUSES }) status!: ProductLifecycleStatus;
  @ApiProperty({ nullable: true }) publishedAt!: Date | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) arModelMediaId!: string | null;
  @ApiProperty({ nullable: true, type: Object }) seo!: SeoMetadata | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(product: Product): ProductResponseDto {
    const dto = new ProductResponseDto();
    dto.id = product.id;
    dto.productType = product.productType;
    dto.brandId = product.brandId;
    dto.categoryId = product.categoryId;
    dto.name = product.name;
    dto.slug = product.slug;
    dto.localizedName = product.localizedName;
    dto.shortDescription = product.shortDescription;
    dto.longDescription = product.longDescription;
    dto.specifications = product.specifications;
    dto.tags = product.tags;
    dto.status = product.status;
    dto.publishedAt = product.publishedAt;
    dto.arModelMediaId = product.arModelMediaId;
    dto.seo = product.seo;
    dto.createdAt = product.createdAt;
    dto.updatedAt = product.updatedAt;
    return dto;
  }
}

export class ProductPageResponseDto {
  @ApiProperty({ type: [ProductResponseDto] }) items!: ProductResponseDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;

  static fromResult(result: {
    items: Product[];
    nextCursor: string | null;
  }): ProductPageResponseDto {
    const dto = new ProductPageResponseDto();
    dto.items = result.items.map((item) => ProductResponseDto.fromDomain(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}

export class CreateProductDto {
  @ApiProperty({ enum: PRODUCT_TYPES }) @IsIn(PRODUCT_TYPES) productType!: ProductType;
  @ApiProperty({ format: 'uuid' }) @IsUUID() brandId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() categoryId!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() slug?: string;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  localizedName?: LocalizedText | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  shortDescription?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  longDescription?: string | null;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  specifications?: Record<string, unknown> | null;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  arModelMediaId?: string | null;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  faceTryOnMetadata?: Record<string, unknown> | null;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  seo?: SeoMetadata | null;
}

export class UpdateProductDto {
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() brandId?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() categoryId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MinLength(1) name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() slug?: string;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  localizedName?: LocalizedText | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  shortDescription?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  longDescription?: string | null;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  specifications?: Record<string, unknown> | null;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  arModelMediaId?: string | null;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  faceTryOnMetadata?: Record<string, unknown> | null;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  seo?: SeoMetadata | null;
}

export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() brandId?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() categoryId?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() collectionId?: string;

  @ApiProperty({ required: false, enum: LIFECYCLE_STATUSES })
  @IsOptional()
  @IsIn(LIFECYCLE_STATUSES)
  status?: ProductLifecycleStatus;

  @ApiProperty({ required: false, enum: PRODUCT_TYPES })
  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  productType?: ProductType;

  @ApiProperty({ required: false }) @IsOptional() @IsString() search?: string;

  @ApiProperty({ required: false, enum: ['createdAt', 'publishedAt', 'name'] })
  @IsOptional()
  @IsIn(['createdAt', 'publishedAt', 'name'])
  sortField?: 'createdAt' | 'publishedAt' | 'name';

  @ApiProperty({ required: false, enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}

const BULK_OPERATIONS = ['publish', 'archive'] as const;
export type BulkProductOperation = (typeof BULK_OPERATIONS)[number];

/** `POST /admin/catalog/products/bulk` (Phase 005
 * `api_requirements.admin`) — one endpoint, dispatched by `operation`,
 * rather than a route per bulk action. */
export class BulkProductsDto {
  @ApiProperty({ enum: BULK_OPERATIONS })
  @IsIn(BULK_OPERATIONS)
  operation!: BulkProductOperation;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ids!: string[];
}

export class BulkOperationResultDto {
  @ApiProperty({ type: [String] }) succeeded!: string[];
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  failed!: { id: string; reason: string }[];
}
