import type {
  CatalogStatus,
  CollectionRules,
  CollectionType,
  LocalizedText,
  SeoMetadata,
} from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

import type { Collection } from '../../domain/entities/collection.entity';

import { PaginationQueryDto } from './pagination.dto';

export class CollectionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true, type: Object }) localizedName!: LocalizedText | null;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ enum: ['MANUAL', 'DYNAMIC'] }) type!: CollectionType;
  @ApiProperty({ nullable: true, type: Object }) rules!: CollectionRules | null;
  @ApiProperty() priority!: number;
  @ApiProperty({ nullable: true }) startAt!: Date | null;
  @ApiProperty({ nullable: true }) endAt!: Date | null;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: CatalogStatus;
  @ApiProperty({ nullable: true }) publishedAt!: Date | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) imageMediaId!: string | null;
  @ApiProperty({ nullable: true, type: Object }) seo!: SeoMetadata | null;

  static fromDomain(collection: Collection): CollectionResponseDto {
    const dto = new CollectionResponseDto();
    dto.id = collection.id;
    dto.name = collection.name;
    dto.slug = collection.slug;
    dto.localizedName = collection.localizedName;
    dto.description = collection.description;
    dto.type = collection.type;
    dto.rules = collection.rules;
    dto.priority = collection.priority;
    dto.startAt = collection.startAt;
    dto.endAt = collection.endAt;
    dto.status = collection.status;
    dto.publishedAt = collection.publishedAt;
    dto.imageMediaId = collection.imageMediaId;
    dto.seo = collection.seo;
    return dto;
  }
}

export class CollectionPageResponseDto {
  @ApiProperty({ type: [CollectionResponseDto] }) items!: CollectionResponseDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;

  static fromResult(result: {
    items: Collection[];
    nextCursor: string | null;
  }): CollectionPageResponseDto {
    const dto = new CollectionPageResponseDto();
    dto.items = result.items.map((item) => CollectionResponseDto.fromDomain(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}

export class CreateCollectionDto {
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

  @ApiProperty({ required: false, enum: ['MANUAL', 'DYNAMIC'] })
  @IsOptional()
  @IsIn(['MANUAL', 'DYNAMIC'])
  type?: CollectionType;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  rules?: CollectionRules | null;

  @ApiProperty({ required: false }) @IsOptional() @IsInt() priority?: number;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsDateString() startAt?:
    string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsDateString() endAt?:
    string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  imageMediaId?: string | null;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  seo?: SeoMetadata | null;
}

export class UpdateCollectionDto {
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

  @ApiProperty({ required: false, enum: ['MANUAL', 'DYNAMIC'] })
  @IsOptional()
  @IsIn(['MANUAL', 'DYNAMIC'])
  type?: CollectionType;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  rules?: CollectionRules | null;

  @ApiProperty({ required: false }) @IsOptional() @IsInt() priority?: number;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsDateString() startAt?:
    string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsDateString() endAt?:
    string | null;

  @ApiProperty({ required: false, enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: CatalogStatus;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  imageMediaId?: string | null;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  seo?: SeoMetadata | null;
}

export class ListCollectionsQueryDto extends PaginationQueryDto {
  @ApiProperty({ required: false, enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: CatalogStatus;

  @ApiProperty({ required: false, enum: ['MANUAL', 'DYNAMIC'] })
  @IsOptional()
  @IsIn(['MANUAL', 'DYNAMIC'])
  type?: CollectionType;
}

export class AddCollectionProductDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class ReorderCollectionProductsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  @Type(() => String)
  productIds!: string[];
}

export class CollectionMembersResponseDto {
  @ApiProperty({ type: [String] }) items!: string[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
}
