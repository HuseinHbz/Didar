import type { CatalogStatus, LocalizedText, SeoMetadata } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

import type { Category } from '../../domain/entities/category.entity';

import { PaginationQueryDto } from './pagination.dto';

export class CategoryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) parentId!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true, type: Object }) localizedName!: LocalizedText | null;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) imageMediaId!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: CatalogStatus;
  @ApiProperty({ nullable: true }) publishedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Object }) seo!: SeoMetadata | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(category: Category): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = category.id;
    dto.parentId = category.parentId;
    dto.name = category.name;
    dto.slug = category.slug;
    dto.localizedName = category.localizedName;
    dto.description = category.description;
    dto.imageMediaId = category.imageMediaId;
    dto.sortOrder = category.sortOrder;
    dto.status = category.status;
    dto.publishedAt = category.publishedAt;
    dto.seo = category.seo;
    dto.createdAt = category.createdAt;
    dto.updatedAt = category.updatedAt;
    return dto;
  }
}

export class CategoryPageResponseDto {
  @ApiProperty({ type: [CategoryResponseDto] }) items!: CategoryResponseDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;

  static fromResult(result: {
    items: Category[];
    nextCursor: string | null;
  }): CategoryPageResponseDto {
    const dto = new CategoryPageResponseDto();
    dto.items = result.items.map((item) => CategoryResponseDto.fromDomain(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}

export class CreateCategoryDto {
  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiProperty() @IsString() @MinLength(1) name!: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString() slug?: string;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  localizedName?: LocalizedText | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  imageMediaId?: string | null;

  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) sortOrder?: number;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  seo?: SeoMetadata | null;
}

export class UpdateCategoryDto {
  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MinLength(1) name?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString() slug?: string;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  localizedName?: LocalizedText | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  imageMediaId?: string | null;

  @ApiProperty({ required: false, enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: CatalogStatus;

  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) sortOrder?: number;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  seo?: SeoMetadata | null;
}

export class ListCategoriesQueryDto extends PaginationQueryDto {
  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiProperty({ required: false, enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: CatalogStatus;
}

export class PublishCategoryDto {
  @ApiProperty({
    description: 'true = publish (sets publishedAt to now), false = unpublish (clears it)',
  })
  @IsBoolean()
  published!: boolean;
}
