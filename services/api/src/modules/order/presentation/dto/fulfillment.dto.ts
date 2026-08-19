import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

import type { FulfillmentWithDetail } from '../../domain/ports/fulfillment.repository.port';

export class FulfillmentItemInputDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() orderItemId!: string;
  @ApiProperty() @IsInt() @Min(1) quantity!: number;
}

export class CreateFulfillmentDto {
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() warehouseId?: string;
  @ApiProperty({ type: [FulfillmentItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FulfillmentItemInputDto)
  items!: FulfillmentItemInputDto[];
}

export class UpdateFulfillmentStatusDto {
  @ApiProperty({
    enum: ['ALLOCATED', 'PROCESSING', 'PACKED', 'READY', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
  })
  @IsString()
  status!: 'ALLOCATED' | 'PROCESSING' | 'PACKED' | 'READY' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
}

export class CreateShipmentDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() carrier?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() trackingNumber?: string;
}

export class UpdateShipmentStatusDto {
  @ApiProperty({ enum: ['IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED'] })
  @IsString()
  status!: 'IN_TRANSIT' | 'DELIVERED' | 'FAILED' | 'CANCELLED';

  @ApiProperty({ required: false }) @IsOptional() @IsString() location?: string;
}

export class FulfillmentItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) orderItemId!: string;
  @ApiProperty() quantity!: number;
}

export class ShipmentEventResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true }) location!: string | null;
  @ApiProperty() source!: string;
  @ApiProperty() occurredAt!: Date;
}

export class ShipmentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true }) carrier!: string | null;
  @ApiProperty({ nullable: true }) trackingNumber!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true }) shippedAt!: Date | null;
  @ApiProperty({ nullable: true }) deliveredAt!: Date | null;
  @ApiProperty({ type: [ShipmentEventResponseDto] }) events!: ShipmentEventResponseDto[];
}

export class FulfillmentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) warehouseId!: string | null;
  @ApiProperty({ nullable: true }) packedAt!: Date | null;
  @ApiProperty({ nullable: true }) shippedAt!: Date | null;
  @ApiProperty({ nullable: true }) deliveredAt!: Date | null;
  @ApiProperty({ type: [FulfillmentItemResponseDto] }) items!: FulfillmentItemResponseDto[];
  @ApiProperty({ nullable: true, type: ShipmentResponseDto }) shipment!: ShipmentResponseDto | null;

  static fromDomain(detail: FulfillmentWithDetail): FulfillmentResponseDto {
    const dto = new FulfillmentResponseDto();
    dto.id = detail.fulfillment.id;
    dto.orderId = detail.fulfillment.orderId;
    dto.status = detail.fulfillment.status;
    dto.warehouseId = detail.fulfillment.warehouseId;
    dto.packedAt = detail.fulfillment.packedAt;
    dto.shippedAt = detail.fulfillment.shippedAt;
    dto.deliveredAt = detail.fulfillment.deliveredAt;
    dto.items = detail.items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      quantity: item.quantity,
    }));
    dto.shipment = detail.shipment
      ? {
          id: detail.shipment.id,
          carrier: detail.shipment.carrier,
          trackingNumber: detail.shipment.trackingNumber,
          status: detail.shipment.status,
          shippedAt: detail.shipment.shippedAt,
          deliveredAt: detail.shipment.deliveredAt,
          events: detail.shipmentEvents.map((event) => ({
            id: event.id,
            status: event.status,
            location: event.location,
            source: event.source,
            occurredAt: event.occurredAt,
          })),
        }
      : null;
    return dto;
  }
}
