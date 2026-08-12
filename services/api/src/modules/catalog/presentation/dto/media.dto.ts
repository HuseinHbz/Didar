import type { LocalizedText, MediaKind, MediaProvider, MediaRole } from '@iecp/types';
import { MEDIA_KINDS, MEDIA_PROVIDERS, MEDIA_ROLES } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Min } from 'class-validator';

import type { Media } from '../../domain/entities/media.entity';
import type { ProductMedia } from '../../domain/entities/product-media.entity';

export class MediaResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: MEDIA_PROVIDERS }) provider!: MediaProvider;
  @ApiProperty() storageKey!: string;
  @ApiProperty() url!: string;
  @ApiProperty({ enum: MEDIA_KINDS }) kind!: MediaKind;
  @ApiProperty() mimeType!: string;
  @ApiProperty({ nullable: true }) width!: number | null;
  @ApiProperty({ nullable: true }) height!: number | null;
  @ApiProperty({ nullable: true, type: Object }) altText!: LocalizedText | null;

  static fromDomain(media: Media): MediaResponseDto {
    const dto = new MediaResponseDto();
    dto.id = media.id;
    dto.provider = media.provider;
    dto.storageKey = media.storageKey;
    dto.url = media.url;
    dto.kind = media.kind;
    dto.mimeType = media.mimeType;
    dto.width = media.width;
    dto.height = media.height;
    dto.altText = media.altText;
    return dto;
  }
}

export class RegisterMediaDto {
  @ApiProperty({ required: false, enum: MEDIA_PROVIDERS })
  @IsOptional()
  @IsIn(MEDIA_PROVIDERS)
  provider?: MediaProvider;

  @ApiProperty() @IsString() storageKey!: string;
  @ApiProperty() @IsString() url!: string;
  @ApiProperty({ enum: MEDIA_KINDS }) @IsIn(MEDIA_KINDS) kind!: MediaKind;
  @ApiProperty() @IsString() mimeType!: string;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() width?: number | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() height?: number | null;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  altText?: LocalizedText | null;
}

export class ProductMediaResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) variantId!: string | null;
  @ApiProperty({ format: 'uuid' }) mediaId!: string;
  @ApiProperty({ enum: MEDIA_ROLES }) role!: MediaRole;
  @ApiProperty() sortOrder!: number;

  static fromDomain(pm: ProductMedia): ProductMediaResponseDto {
    const dto = new ProductMediaResponseDto();
    dto.id = pm.id;
    dto.productId = pm.productId;
    dto.variantId = pm.variantId;
    dto.mediaId = pm.mediaId;
    dto.role = pm.role;
    dto.sortOrder = pm.sortOrder;
    return dto;
  }
}

export class AttachMediaDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() mediaId!: string;
  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  variantId?: string | null;

  @ApiProperty({ required: false, enum: MEDIA_ROLES })
  @IsOptional()
  @IsIn(MEDIA_ROLES)
  role?: MediaRole;

  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) sortOrder?: number;

  @ApiProperty({ required: false, nullable: true, type: Object })
  @IsOptional()
  @IsObject()
  altTextOverride?: LocalizedText | null;
}

export class ReorderProductMediaDto {
  @ApiProperty({ type: [String] }) @IsUUID('4', { each: true }) mediaAttachmentIds!: string[];
}
