import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

import type { LowStockRow } from '../../domain/ports/inventory-threshold.repository.port';

export class LowStockRowResponseDto {
  @ApiProperty({ format: 'uuid' }) productSkuId!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() availableQuantity!: number;
  @ApiProperty() reorderPoint!: number;
  @ApiProperty() safetyStock!: number;
  @ApiProperty({ nullable: true }) minStock!: number | null;
  @ApiProperty({ nullable: true }) maxStock!: number | null;

  static fromDomain(row: LowStockRow): LowStockRowResponseDto {
    const dto = new LowStockRowResponseDto();
    dto.productSkuId = row.threshold.productSkuId;
    dto.warehouseId = row.threshold.warehouseId;
    dto.availableQuantity = row.availableQuantity;
    dto.reorderPoint = row.threshold.reorderPoint;
    dto.safetyStock = row.threshold.safetyStock;
    dto.minStock = row.threshold.minStock;
    dto.maxStock = row.threshold.maxStock;
    return dto;
  }
}

export class SetThresholdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productSkuId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() warehouseId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) reorderPoint?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) safetyStock?: number;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() @Min(0) minStock?:
    number | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() @Min(0) maxStock?:
    number | null;
}
