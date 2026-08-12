import type { InventoryAdjustmentType } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, IsUUID, MinLength } from 'class-validator';

import type { InventoryAdjustment } from '../../domain/entities/inventory-adjustment.entity';

const ADJUSTMENT_TYPES = ['POSITIVE', 'NEGATIVE'] as const;

export class AdjustmentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty({ format: 'uuid' }) productSkuId!: string;
  @ApiProperty({ enum: ADJUSTMENT_TYPES }) adjustmentType!: InventoryAdjustmentType;
  @ApiProperty() quantity!: number;
  @ApiProperty() reason!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) approvedBy!: string | null;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty() createdAt!: Date;

  static fromDomain(adjustment: InventoryAdjustment): AdjustmentResponseDto {
    const dto = new AdjustmentResponseDto();
    dto.id = adjustment.id;
    dto.warehouseId = adjustment.warehouseId;
    dto.locationId = adjustment.locationId;
    dto.productSkuId = adjustment.productSkuId;
    dto.adjustmentType = adjustment.adjustmentType;
    dto.quantity = adjustment.quantity;
    dto.reason = adjustment.reason;
    dto.approvedBy = adjustment.approvedBy;
    dto.createdBy = adjustment.createdBy;
    dto.createdAt = adjustment.createdAt;
    return dto;
  }
}

export class AdjustmentPageResponseDto {
  @ApiProperty({ type: [AdjustmentResponseDto] }) items!: AdjustmentResponseDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;

  static fromResult(result: {
    items: InventoryAdjustment[];
    nextCursor: string | null;
  }): AdjustmentPageResponseDto {
    const dto = new AdjustmentPageResponseDto();
    dto.items = result.items.map((item) => AdjustmentResponseDto.fromDomain(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}

export class CreateAdjustmentDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() warehouseId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() locationId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() productSkuId!: string;
  @ApiProperty({ enum: ADJUSTMENT_TYPES })
  @IsIn(ADJUSTMENT_TYPES)
  adjustmentType!: InventoryAdjustmentType;
  @ApiProperty() @IsInt() @IsPositive() quantity!: number;
  @ApiProperty() @IsString() @MinLength(3) reason!: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() approvedBy?: string;
}
