import type { StockCountStatus } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

import type { StockCountItem } from '../../domain/entities/stock-count-item.entity';
import type { StockCount } from '../../domain/entities/stock-count.entity';
import type { StockCountWithItems } from '../../domain/ports/stock-count.repository.port';

import { PaginationQueryDto } from './pagination.dto';

const STATUSES = [
  'PLANNED',
  'IN_PROGRESS',
  'COUNTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'CLOSED',
] as const;

export class StockCountItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productSkuId!: string;
  @ApiProperty() expectedQuantity!: number;
  @ApiProperty({ nullable: true }) countedQuantity!: number | null;
  @ApiProperty({ nullable: true }) variance!: number | null;

  static fromDomain(item: StockCountItem): StockCountItemResponseDto {
    const dto = new StockCountItemResponseDto();
    dto.id = item.id;
    dto.productSkuId = item.productSkuId;
    dto.expectedQuantity = item.expectedQuantity;
    dto.countedQuantity = item.countedQuantity;
    dto.variance = item.variance;
    return dto;
  }
}

export class StockCountResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) locationId!: string | null;
  @ApiProperty({ enum: STATUSES }) status!: StockCountStatus;
  @ApiProperty({ nullable: true, format: 'uuid' }) countedBy!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) approvedBy!: string | null;
  @ApiProperty({ nullable: true }) startedAt!: Date | null;
  @ApiProperty({ nullable: true }) completedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ type: [StockCountItemResponseDto] }) items!: StockCountItemResponseDto[];

  static fromDomain(result: StockCountWithItems): StockCountResponseDto {
    const dto = new StockCountResponseDto();
    dto.id = result.stockCount.id;
    dto.warehouseId = result.stockCount.warehouseId;
    dto.locationId = result.stockCount.locationId;
    dto.status = result.stockCount.status;
    dto.countedBy = result.stockCount.countedBy;
    dto.approvedBy = result.stockCount.approvedBy;
    dto.startedAt = result.stockCount.startedAt;
    dto.completedAt = result.stockCount.completedAt;
    dto.createdAt = result.stockCount.createdAt;
    dto.updatedAt = result.stockCount.updatedAt;
    dto.items = result.items.map((item) => StockCountItemResponseDto.fromDomain(item));
    return dto;
  }

  static fromCountOnly(stockCount: StockCount): StockCountResponseDto {
    const dto = new StockCountResponseDto();
    dto.id = stockCount.id;
    dto.warehouseId = stockCount.warehouseId;
    dto.locationId = stockCount.locationId;
    dto.status = stockCount.status;
    dto.countedBy = stockCount.countedBy;
    dto.approvedBy = stockCount.approvedBy;
    dto.startedAt = stockCount.startedAt;
    dto.completedAt = stockCount.completedAt;
    dto.createdAt = stockCount.createdAt;
    dto.updatedAt = stockCount.updatedAt;
    dto.items = [];
    return dto;
  }
}

export class StockCountPageResponseDto {
  @ApiProperty({ type: [StockCountResponseDto] }) items!: StockCountResponseDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;

  static fromResult(result: {
    items: StockCount[];
    nextCursor: string | null;
  }): StockCountPageResponseDto {
    const dto = new StockCountPageResponseDto();
    dto.items = result.items.map((item) => StockCountResponseDto.fromCountOnly(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}

export class ListStockCountsQueryDto extends PaginationQueryDto {
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() warehouseId?: string;
  @ApiProperty({ required: false, enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: StockCountStatus;
}

export class CreateStockCountDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() warehouseId!: string;
  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  locationId?: string | null;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  productSkuIds!: string[];
}

export class SubmitStockCountItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productSkuId!: string;
  @ApiProperty() @IsInt() @Min(0) countedQuantity!: number;
}

export class SubmitStockCountDto {
  @ApiProperty({ type: [SubmitStockCountItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubmitStockCountItemDto)
  items!: SubmitStockCountItemDto[];
}
