import {
  ORDER_EXCEPTION_RESOLUTIONS,
  ORDER_EXCEPTION_STATUSES,
  ORDER_EXCEPTION_TYPES,
} from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';

import type { OrderException } from '../../domain/entities/order-exception.entity';

/** CP-031 — one entry of the operator work queue for paid orders that cannot
 * proceed on their own. `dedupeKey` is an internal idempotency detail and is
 * deliberately not exposed. */
export class OrderExceptionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ enum: ORDER_EXCEPTION_TYPES }) type!: string;
  @ApiProperty({ enum: ORDER_EXCEPTION_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) productSkuId!: string | null;
  @ApiProperty({ nullable: true }) requestedQuantity!: number | null;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  detail!: Record<string, unknown> | null;
  @ApiProperty() openedAt!: Date;
  @ApiProperty({ nullable: true }) resolvedAt!: Date | null;
  @ApiProperty({ nullable: true, enum: ORDER_EXCEPTION_RESOLUTIONS }) resolution!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) resolvedBy!: string | null;

  static fromDomain(exception: OrderException): OrderExceptionResponseDto {
    const dto = new OrderExceptionResponseDto();
    dto.id = exception.id;
    dto.orderId = exception.orderId;
    dto.type = exception.type;
    dto.status = exception.status;
    dto.productSkuId = exception.productSkuId;
    dto.requestedQuantity = exception.requestedQuantity;
    dto.detail = exception.detail;
    dto.openedAt = exception.openedAt;
    dto.resolvedAt = exception.resolvedAt;
    dto.resolution = exception.resolution;
    dto.resolvedBy = exception.resolvedBy;
    return dto;
  }
}
