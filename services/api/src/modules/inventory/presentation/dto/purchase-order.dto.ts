import type { PurchaseOrderStatus } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import type { PurchaseOrderItem } from '../../domain/entities/purchase-order-item.entity';
import type { PurchaseOrder } from '../../domain/entities/purchase-order.entity';
import type { PurchaseOrderWithItems } from '../../domain/ports/purchase-order.repository.port';

import { PaginationQueryDto } from './pagination.dto';

const STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;

export class PurchaseOrderItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productSkuId!: string;
  @ApiProperty() orderedQuantity!: number;
  @ApiProperty() receivedQuantity!: number;
  @ApiProperty({ description: 'Integer Rial amount, as a string' }) unitCost!: string;

  static fromDomain(item: PurchaseOrderItem): PurchaseOrderItemResponseDto {
    const dto = new PurchaseOrderItemResponseDto();
    dto.id = item.id;
    dto.productSkuId = item.productSkuId;
    dto.orderedQuantity = item.orderedQuantity;
    dto.receivedQuantity = item.receivedQuantity;
    dto.unitCost = item.unitCost.toString();
    return dto;
  }
}

export class PurchaseOrderResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() poNumber!: string;
  @ApiProperty({ format: 'uuid' }) supplierId!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ enum: STATUSES }) status!: PurchaseOrderStatus;
  @ApiProperty({ nullable: true, format: 'uuid' }) createdBy!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) approvedBy!: string | null;
  @ApiProperty({ nullable: true }) approvedAt!: Date | null;
  @ApiProperty({ nullable: true }) cancelledAt!: Date | null;
  @ApiProperty({ nullable: true }) receivedAt!: Date | null;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ type: [PurchaseOrderItemResponseDto] }) items!: PurchaseOrderItemResponseDto[];

  static fromDomain(result: PurchaseOrderWithItems): PurchaseOrderResponseDto {
    const dto = new PurchaseOrderResponseDto();
    dto.id = result.purchaseOrder.id;
    dto.poNumber = result.purchaseOrder.poNumber;
    dto.supplierId = result.purchaseOrder.supplierId;
    dto.warehouseId = result.purchaseOrder.warehouseId;
    dto.status = result.purchaseOrder.status;
    dto.createdBy = result.purchaseOrder.createdBy;
    dto.approvedBy = result.purchaseOrder.approvedBy;
    dto.approvedAt = result.purchaseOrder.approvedAt;
    dto.cancelledAt = result.purchaseOrder.cancelledAt;
    dto.receivedAt = result.purchaseOrder.receivedAt;
    dto.notes = result.purchaseOrder.notes;
    dto.createdAt = result.purchaseOrder.createdAt;
    dto.updatedAt = result.purchaseOrder.updatedAt;
    dto.items = result.items.map((item) => PurchaseOrderItemResponseDto.fromDomain(item));
    return dto;
  }

  /** For list endpoints, which return `PurchaseOrder[]` without the item
   * rows joined — `items` is empty; callers needing line items use
   * `GET /purchase-orders/:id`. */
  static fromPurchaseOrderOnly(po: PurchaseOrder): PurchaseOrderResponseDto {
    const dto = new PurchaseOrderResponseDto();
    dto.id = po.id;
    dto.poNumber = po.poNumber;
    dto.supplierId = po.supplierId;
    dto.warehouseId = po.warehouseId;
    dto.status = po.status;
    dto.createdBy = po.createdBy;
    dto.approvedBy = po.approvedBy;
    dto.approvedAt = po.approvedAt;
    dto.cancelledAt = po.cancelledAt;
    dto.receivedAt = po.receivedAt;
    dto.notes = po.notes;
    dto.createdAt = po.createdAt;
    dto.updatedAt = po.updatedAt;
    dto.items = [];
    return dto;
  }
}

export class PurchaseOrderPageResponseDto {
  @ApiProperty({ type: [PurchaseOrderResponseDto] }) items!: PurchaseOrderResponseDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;

  static fromResult(result: {
    items: PurchaseOrder[];
    nextCursor: string | null;
  }): PurchaseOrderPageResponseDto {
    const dto = new PurchaseOrderPageResponseDto();
    dto.items = result.items.map((item) => PurchaseOrderResponseDto.fromPurchaseOrderOnly(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}

export class ListPurchaseOrdersQueryDto extends PaginationQueryDto {
  @ApiProperty({ required: false, enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: PurchaseOrderStatus;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

export class CreatePurchaseOrderItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productSkuId!: string;
  @ApiProperty() @IsInt() @IsPositive() orderedQuantity!: number;
  @ApiProperty({ description: 'Integer Rial amount, as a string' })
  @IsNumberString()
  unitCost!: string;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() supplierId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() warehouseId!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
  @ApiProperty({ type: [CreatePurchaseOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  items!: CreatePurchaseOrderItemDto[];
}

export class ReceivePurchaseOrderItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productSkuId!: string;
  @ApiProperty() @IsInt() @IsPositive() receivedQuantity!: number;
  @ApiProperty({ format: 'uuid', description: 'Warehouse location the stock is received into' })
  @IsUUID()
  locationId!: string;
}

export class ReceivePurchaseOrderDto {
  @ApiProperty({ type: [ReceivePurchaseOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseOrderItemDto)
  items!: ReceivePurchaseOrderItemDto[];

  /** Client-supplied idempotency key — a retried "receive this delivery"
   * call reusing the same value resolves to the state that call already
   * produced rather than double-crediting stock (see
   * `PurchaseOrderRepositoryPort.receive`'s own doc comment). Optional:
   * omitting it keeps the prior at-most-once-per-call-site behavior every
   * other pre-Phase-013 inventory mutation has. */
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string | null;
}
