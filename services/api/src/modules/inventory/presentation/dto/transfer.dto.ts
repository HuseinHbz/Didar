import type { StockTransferStatus } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import type { StockTransferItem } from '../../domain/entities/stock-transfer-item.entity';
import type { StockTransfer } from '../../domain/entities/stock-transfer.entity';
import type { StockTransferWithItems } from '../../domain/ports/stock-transfer.repository.port';

import { PaginationQueryDto } from './pagination.dto';

const STATUSES = [
  'DRAFT',
  'REQUESTED',
  'APPROVED',
  'PICKING',
  'DISPATCHED',
  'IN_TRANSIT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;

export class TransferItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productSkuId!: string;
  @ApiProperty() requestedQuantity!: number;
  @ApiProperty({ nullable: true }) approvedQuantity!: number | null;
  @ApiProperty({ nullable: true }) dispatchedQuantity!: number | null;
  @ApiProperty({ nullable: true }) receivedQuantity!: number | null;

  static fromDomain(item: StockTransferItem): TransferItemResponseDto {
    const dto = new TransferItemResponseDto();
    dto.id = item.id;
    dto.productSkuId = item.productSkuId;
    dto.requestedQuantity = item.requestedQuantity;
    dto.approvedQuantity = item.approvedQuantity;
    dto.dispatchedQuantity = item.dispatchedQuantity;
    dto.receivedQuantity = item.receivedQuantity;
    return dto;
  }
}

export class TransferResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() referenceNumber!: string;
  @ApiProperty({ format: 'uuid' }) sourceWarehouseId!: string;
  @ApiProperty({ format: 'uuid' }) destinationWarehouseId!: string;
  @ApiProperty({ enum: STATUSES }) status!: StockTransferStatus;
  @ApiProperty({ nullable: true, format: 'uuid' }) requestedBy!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) approvedBy!: string | null;
  @ApiProperty({ nullable: true }) dispatchedAt!: Date | null;
  @ApiProperty({ nullable: true }) receivedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ type: [TransferItemResponseDto] }) items!: TransferItemResponseDto[];

  static fromDomain(result: StockTransferWithItems): TransferResponseDto {
    const dto = new TransferResponseDto();
    dto.id = result.transfer.id;
    dto.referenceNumber = result.transfer.referenceNumber;
    dto.sourceWarehouseId = result.transfer.sourceWarehouseId;
    dto.destinationWarehouseId = result.transfer.destinationWarehouseId;
    dto.status = result.transfer.status;
    dto.requestedBy = result.transfer.requestedBy;
    dto.approvedBy = result.transfer.approvedBy;
    dto.dispatchedAt = result.transfer.dispatchedAt;
    dto.receivedAt = result.transfer.receivedAt;
    dto.createdAt = result.transfer.createdAt;
    dto.updatedAt = result.transfer.updatedAt;
    dto.items = result.items.map((item) => TransferItemResponseDto.fromDomain(item));
    return dto;
  }

  /** For list endpoints, which return `StockTransfer[]` without the item
   * rows joined (see `StockTransferRepositoryPort.list`) — `items` is
   * empty; callers needing line items use `GET /transfers/:id`. */
  static fromTransferOnly(transfer: StockTransfer): TransferResponseDto {
    const dto = new TransferResponseDto();
    dto.id = transfer.id;
    dto.referenceNumber = transfer.referenceNumber;
    dto.sourceWarehouseId = transfer.sourceWarehouseId;
    dto.destinationWarehouseId = transfer.destinationWarehouseId;
    dto.status = transfer.status;
    dto.requestedBy = transfer.requestedBy;
    dto.approvedBy = transfer.approvedBy;
    dto.dispatchedAt = transfer.dispatchedAt;
    dto.receivedAt = transfer.receivedAt;
    dto.createdAt = transfer.createdAt;
    dto.updatedAt = transfer.updatedAt;
    dto.items = [];
    return dto;
  }
}

export class TransferPageResponseDto {
  @ApiProperty({ type: [TransferResponseDto] }) items!: TransferResponseDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;

  static fromResult(result: {
    items: StockTransfer[];
    nextCursor: string | null;
  }): TransferPageResponseDto {
    const dto = new TransferPageResponseDto();
    dto.items = result.items.map((item) => TransferResponseDto.fromTransferOnly(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}

export class ListTransfersQueryDto extends PaginationQueryDto {
  @ApiProperty({ required: false, enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: StockTransferStatus;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceWarehouseId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  destinationWarehouseId?: string;
}

export class CreateTransferItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productSkuId!: string;
  @ApiProperty() @IsInt() @IsPositive() requestedQuantity!: number;
}

export class CreateTransferDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() sourceWarehouseId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() destinationWarehouseId!: string;
  @ApiProperty({ type: [CreateTransferItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTransferItemDto)
  items!: CreateTransferItemDto[];
}

export class ApproveTransferItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productSkuId!: string;
  @ApiProperty() @IsInt() @IsPositive() approvedQuantity!: number;
}

export class ApproveTransferDto {
  @ApiProperty({ required: false, type: [ApproveTransferItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApproveTransferItemDto)
  items?: ApproveTransferItemDto[];
}

export class DispatchTransferItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productSkuId!: string;
  @ApiProperty() @IsInt() @IsPositive() dispatchedQuantity!: number;
}

export class DispatchTransferDto {
  @ApiProperty({ required: false, type: [DispatchTransferItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DispatchTransferItemDto)
  items?: DispatchTransferItemDto[];
}

export class ReceiveTransferItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productSkuId!: string;
  @ApiProperty() @IsInt() @IsPositive() receivedQuantity!: number;
}

export class ReceiveTransferDto {
  @ApiProperty({ type: [ReceiveTransferItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveTransferItemDto)
  items!: ReceiveTransferItemDto[];
}

// Re-exported for controllers that only need the plain entity type.
export type { StockTransfer };
