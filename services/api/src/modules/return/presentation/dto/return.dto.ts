import {
  RETURN_ITEM_CONDITIONS,
  RETURN_REASONS,
  RETURN_RESOLUTIONS,
  type ReturnItemCondition,
  type ReturnReason,
  type ReturnResolution,
} from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import type { ReturnRequestWithDetail } from '../../domain/ports/return.repository.port';

export class ReturnItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) orderItemId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ nullable: true }) condition!: string | null;
  @ApiProperty({ nullable: true }) refundAmount!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class ReturnStatusHistoryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true }) fromStatus!: string | null;
  @ApiProperty() toStatus!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) changedBy!: string | null;
  @ApiProperty({ nullable: true }) note!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class ReturnResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() returnNumber!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) customerId!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ nullable: true }) reasonNote!: string | null;
  @ApiProperty() resolution!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) warehouseId!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) locationId!: string | null;
  @ApiProperty({ nullable: true }) rejectionReason!: string | null;
  @ApiProperty() requestedAt!: Date;
  @ApiProperty({ nullable: true }) approvedAt!: Date | null;
  @ApiProperty({ nullable: true }) receivedAt!: Date | null;
  @ApiProperty({ nullable: true }) inspectedAt!: Date | null;
  @ApiProperty({ nullable: true }) refundedAt!: Date | null;
  @ApiProperty({ nullable: true }) completedAt!: Date | null;
  @ApiProperty({ nullable: true }) rejectedAt!: Date | null;
  @ApiProperty({ nullable: true }) cancelledAt!: Date | null;
  @ApiProperty({ type: [ReturnItemResponseDto] }) items!: ReturnItemResponseDto[];
  @ApiProperty({ type: [ReturnStatusHistoryResponseDto] })
  history!: ReturnStatusHistoryResponseDto[];
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(detail: ReturnRequestWithDetail): ReturnResponseDto {
    const dto = new ReturnResponseDto();
    dto.id = detail.request.id;
    dto.returnNumber = detail.request.returnNumber;
    dto.orderId = detail.request.orderId;
    dto.customerId = detail.request.customerId;
    dto.status = detail.request.status;
    dto.reason = detail.request.reason;
    dto.reasonNote = detail.request.reasonNote;
    dto.resolution = detail.request.resolution;
    dto.warehouseId = detail.request.warehouseId;
    dto.locationId = detail.request.locationId;
    dto.rejectionReason = detail.request.rejectionReason;
    dto.requestedAt = detail.request.requestedAt;
    dto.approvedAt = detail.request.approvedAt;
    dto.receivedAt = detail.request.receivedAt;
    dto.inspectedAt = detail.request.inspectedAt;
    dto.refundedAt = detail.request.refundedAt;
    dto.completedAt = detail.request.completedAt;
    dto.rejectedAt = detail.request.rejectedAt;
    dto.cancelledAt = detail.request.cancelledAt;
    dto.createdAt = detail.request.createdAt;
    dto.updatedAt = detail.request.updatedAt;
    dto.items = detail.items.map((item) => {
      const itemDto = new ReturnItemResponseDto();
      itemDto.id = item.id;
      itemDto.orderItemId = item.orderItemId;
      itemDto.quantity = item.quantity;
      itemDto.condition = item.condition;
      itemDto.refundAmount = item.refundAmount === null ? null : item.refundAmount.toString();
      itemDto.createdAt = item.createdAt;
      return itemDto;
    });
    dto.history = detail.history.map((entry) => {
      const historyDto = new ReturnStatusHistoryResponseDto();
      historyDto.id = entry.id;
      historyDto.fromStatus = entry.fromStatus;
      historyDto.toStatus = entry.toStatus;
      historyDto.changedBy = entry.changedBy;
      historyDto.note = entry.note;
      historyDto.createdAt = entry.createdAt;
      return historyDto;
    });
    return dto;
  }
}

export class CreateReturnItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() orderItemId!: string;
  @ApiProperty() @IsInt() @IsPositive() quantity!: number;
}

export class CreateReturnDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() orderId!: string;
  @ApiProperty({ enum: RETURN_REASONS }) @IsIn(RETURN_REASONS) reason!: ReturnReason;
  @ApiProperty({ required: false }) @IsOptional() @IsString() reasonNote?: string;
  @ApiProperty({ enum: RETURN_RESOLUTIONS, required: false })
  @IsOptional()
  @IsIn(RETURN_RESOLUTIONS)
  resolution?: ReturnResolution;
  @ApiProperty({ type: [CreateReturnItemDto] })
  @ValidateNested({ each: true })
  @Type(() => CreateReturnItemDto)
  @ArrayMinSize(1)
  items!: CreateReturnItemDto[];
  @ApiProperty({ required: false }) @IsOptional() @IsString() idempotencyKey?: string;
}

export class RejectReturnDto {
  @ApiProperty() @IsString() reason!: string;
}

export class ReceiveReturnDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() warehouseId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() locationId!: string;
}

export class InspectReturnItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() returnItemId!: string;
  @ApiProperty({ enum: RETURN_ITEM_CONDITIONS })
  @IsIn(RETURN_ITEM_CONDITIONS)
  condition!: ReturnItemCondition;
}

export class InspectReturnDto {
  @ApiProperty({ type: [InspectReturnItemDto] })
  @ValidateNested({ each: true })
  @Type(() => InspectReturnItemDto)
  @ArrayMinSize(1)
  items!: InspectReturnItemDto[];
}
