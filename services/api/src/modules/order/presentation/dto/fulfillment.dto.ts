import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import type { Shipment } from '../../domain/entities/shipment.entity';
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
  /** ADR-011 decision 2 — optional; a caller that supplies one and
   * retries the exact same request gets back the original fulfillment
   * instead of creating a second, real duplicate. */
  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}

/** `DELIVERED` deliberately excluded — ADR-011 decision 4: a fulfillment
 * only ever reaches `DELIVERED` via its shipment's own dedicated
 * `POST .../shipments/:id/deliver` route, never this generic PATCH. */
export class UpdateFulfillmentStatusDto {
  @ApiProperty({
    enum: ['ALLOCATED', 'PROCESSING', 'PACKED', 'READY', 'SHIPPED', 'CANCELLED'],
  })
  @IsIn(['ALLOCATED', 'PROCESSING', 'PACKED', 'READY', 'SHIPPED', 'CANCELLED'])
  status!: 'ALLOCATED' | 'PROCESSING' | 'PACKED' | 'READY' | 'SHIPPED' | 'CANCELLED';
}

export class CreateShipmentDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() carrier?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() trackingNumber?: string;
}

/** `DELIVERED` deliberately excluded — see `UpdateFulfillmentStatusDto`'s
 * own doc comment; the dedicated deliver route is the only path to it. */
export class UpdateShipmentStatusDto {
  @ApiProperty({ enum: ['IN_TRANSIT', 'FAILED', 'CANCELLED'] })
  @IsIn(['IN_TRANSIT', 'FAILED', 'CANCELLED'])
  status!: 'IN_TRANSIT' | 'FAILED' | 'CANCELLED';

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

/** ADR-011 decision 5 — the tracking-number lookup response: enough to
 * find the fulfillment (and, from there via a second call, the order)
 * without eagerly joining the whole aggregate. */
export class ShipmentSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) fulfillmentId!: string;
  @ApiProperty({ nullable: true }) carrier!: string | null;
  @ApiProperty({ nullable: true }) trackingNumber!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true }) shippedAt!: Date | null;
  @ApiProperty({ nullable: true }) deliveredAt!: Date | null;

  static fromDomain(shipment: Shipment): ShipmentSummaryResponseDto {
    const dto = new ShipmentSummaryResponseDto();
    dto.id = shipment.id;
    dto.fulfillmentId = shipment.fulfillmentId;
    dto.carrier = shipment.carrier;
    dto.trackingNumber = shipment.trackingNumber;
    dto.status = shipment.status;
    dto.shippedAt = shipment.shippedAt;
    dto.deliveredAt = shipment.deliveredAt;
    return dto;
  }
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
