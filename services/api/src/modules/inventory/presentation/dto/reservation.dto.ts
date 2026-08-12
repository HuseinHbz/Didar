import type { InventoryReservationStatus } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

import type { InventoryReservation } from '../../domain/entities/inventory-reservation.entity';

export class ReservationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productSkuId!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty({ format: 'uuid' }) inventoryItemId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() status!: InventoryReservationStatus;
  @ApiProperty() sourceType!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty() idempotencyKey!: string;
  @ApiProperty({ nullable: true }) expiresAt!: Date | null;
  @ApiProperty({ nullable: true }) releasedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(reservation: InventoryReservation): ReservationResponseDto {
    const dto = new ReservationResponseDto();
    dto.id = reservation.id;
    dto.productSkuId = reservation.productSkuId;
    dto.warehouseId = reservation.warehouseId;
    dto.locationId = reservation.locationId;
    dto.inventoryItemId = reservation.inventoryItemId;
    dto.quantity = reservation.quantity;
    dto.status = reservation.status;
    dto.sourceType = reservation.sourceType;
    dto.sourceId = reservation.sourceId;
    dto.idempotencyKey = reservation.idempotencyKey;
    dto.expiresAt = reservation.expiresAt;
    dto.releasedAt = reservation.releasedAt;
    dto.createdAt = reservation.createdAt;
    dto.updatedAt = reservation.updatedAt;
    return dto;
  }
}

export class CreateReservationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productSkuId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() warehouseId!: string;
  @ApiProperty() @IsInt() @IsPositive() quantity!: number;
  @ApiProperty({ description: 'e.g. CART, ORDER, POS, HOME_TRY_ON, MANUAL' })
  @IsString()
  @MinLength(1)
  sourceType!: string;
  @ApiProperty() @IsString() @MinLength(1) sourceId!: string;
  @ApiProperty({
    required: false,
    description:
      'Client-supplied idempotency key — a retried request with the same key returns the original reservation.',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date | null;
}

export class ReleaseReservationDto {
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() reason?:
    string | null;
}

export class ConvertReservationDto {
  @ApiProperty({ required: false, description: 'e.g. ORDER' })
  @IsOptional()
  @IsString()
  referenceType?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() referenceId?: string;
}
