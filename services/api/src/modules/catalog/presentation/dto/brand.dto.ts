import type { CatalogStatus, LocalizedText, SeoMetadata } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

import type { Brand } from '../../domain/entities/brand.entity';

import { PaginationQueryDto } from './pagination.dto';

export class BrandResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ nullable: true, type: Object })
  localizedName!: LocalizedText | null;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  logoMediaId!: string | null;

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  status!: CatalogStatus;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ nullable: true, type: Object })
  seo!: SeoMetadata | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromDomain(brand: Brand): BrandResponseDto {
    const dto = new BrandResponseDto();
    dto.id = brand.id;
    dto.name = brand.name;
    dto.slug = brand.slug;
    dto.localizedName = brand.localizedName;
    dto.description = brand.description;
    dto.logoMediaId = brand.logoMediaId;
    dto.status = brand.status;
    dto.sortOrder = brand.sortOrder;
    dto.seo = brand.seo;
    dto.createdAt = brand.createdAt;
    dto.updatedAt = brand.updatedAt;
    return dto;
  }
}

export class BrandPageResponseDto {
  @ApiProperty({ type: [BrandResponseDto] })
  items!: BrandResponseDto[];

  @ApiProperty({ nullable: true })
  nextCursor!: string | null;

  static fromResult(result: { items: Brand[]; nextCursor: string | null }): BrandPageResponseDto {
    const dto = new BrandPageResponseDto();
    dto.items = result.items.map((item) => BrandResponseDto.fromDomain(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}

export class CreateBrandDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  slug?: string;

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
  logoMediaId?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  seo?: SeoMetadata | null;
}

export class UpdateBrandDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  slug?: string;

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
  logoMediaId?: string | null;

  @ApiProperty({ required: false, enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: CatalogStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  seo?: SeoMetadata | null;
}

export class ListBrandsQueryDto extends PaginationQueryDto {
  @ApiProperty({ required: false, enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: CatalogStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
