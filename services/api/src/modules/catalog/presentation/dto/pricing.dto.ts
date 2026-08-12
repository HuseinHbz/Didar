import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumberString, IsOptional, IsString } from 'class-validator';

import type { PriceHistoryEntry } from '../../domain/entities/price-history-entry.entity';
import type { ProductPrice } from '../../domain/entities/product-price.entity';

import { PaginationQueryDto } from './pagination.dto';

/** Amounts travel as decimal strings, not JSON numbers — `bigint` has no
 * native JSON representation, and a float would silently reintroduce the
 * exact class of bug `packages/types`' `Money` exists to prevent. */
export class SetPriceDto {
  @ApiProperty({ description: 'Integer Rial amount, as a string' })
  @IsNumberString()
  basePrice!: string;

  @ApiProperty({ required: false, nullable: true, description: 'Integer Rial amount, as a string' })
  @IsOptional()
  @IsNumberString()
  compareAtPrice?: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'Integer Rial amount, as a string' })
  @IsOptional()
  @IsNumberString()
  costPrice?: string | null;

  @ApiProperty({ required: false }) @IsOptional() @IsString() currency?: string;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsDateString() validFrom?:
    string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsDateString() validTo?:
    string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() reason?:
    string | null;
}

export class ProductPriceResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productSkuId!: string;
  @ApiProperty({ description: 'Integer Rial amount, as a string' }) basePrice!: string;
  @ApiProperty({ nullable: true, description: 'Integer Rial amount, as a string' })
  compareAtPrice!: string | null;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true }) validFrom!: Date | null;
  @ApiProperty({ nullable: true }) validTo!: Date | null;

  static fromDomain(price: ProductPrice): ProductPriceResponseDto {
    const dto = new ProductPriceResponseDto();
    dto.id = price.id;
    dto.productSkuId = price.productSkuId;
    dto.basePrice = price.basePrice.toString();
    dto.compareAtPrice = price.compareAtPrice === null ? null : price.compareAtPrice.toString();
    dto.currency = price.currency;
    dto.validFrom = price.validFrom;
    dto.validTo = price.validTo;
    return dto;
  }
}

export class PriceHistoryEntryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true }) oldPrice!: string | null;
  @ApiProperty() newPrice!: string;
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiProperty() changedAt!: Date;

  static fromDomain(entry: PriceHistoryEntry): PriceHistoryEntryResponseDto {
    const dto = new PriceHistoryEntryResponseDto();
    dto.id = entry.id;
    dto.oldPrice = entry.oldPrice === null ? null : entry.oldPrice.toString();
    dto.newPrice = entry.newPrice.toString();
    dto.reason = entry.reason;
    dto.changedAt = entry.changedAt;
    return dto;
  }
}

export class PriceHistoryPageResponseDto {
  @ApiProperty({ type: [PriceHistoryEntryResponseDto] }) items!: PriceHistoryEntryResponseDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;

  static fromResult(result: {
    items: PriceHistoryEntry[];
    nextCursor: string | null;
  }): PriceHistoryPageResponseDto {
    const dto = new PriceHistoryPageResponseDto();
    dto.items = result.items.map((item) => PriceHistoryEntryResponseDto.fromDomain(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}

export class ListPriceHistoryQueryDto extends PaginationQueryDto {}
