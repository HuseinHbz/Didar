import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

import type { OrderWithDetail } from '../../domain/ports/order.repository.port';

export class OrderItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) productSkuId!: string | null;
  @ApiProperty() skuSnapshot!: string;
  @ApiProperty() nameSnapshot!: string;
  @ApiProperty() unitPriceSnapshot!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() discountAmount!: string;
  @ApiProperty() taxAmount!: string;
  @ApiProperty() lineTotal!: string;
}

export class OrderStatusHistoryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true }) fromStatus!: string | null;
  @ApiProperty() toStatus!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) changedBy!: string | null;
  @ApiProperty({ nullable: true }) note!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class OrderResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ format: 'uuid' }) checkoutSessionId!: string;
  @ApiProperty({ format: 'uuid' }) paymentIntentId!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) customerId!: string | null;
  @ApiProperty() source!: string;
  @ApiProperty() status!: string;
  @ApiProperty() paymentStatus!: string;
  @ApiProperty() fulfillmentStatus!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() subtotal!: string;
  @ApiProperty() discountTotal!: string;
  @ApiProperty() taxTotal!: string;
  @ApiProperty() shippingTotal!: string;
  @ApiProperty() grandTotal!: string;
  @ApiProperty() paidTotal!: string;
  @ApiProperty() refundedTotal!: string;
  @ApiProperty() shippingAddressSnapshot!: Record<string, unknown>;
  @ApiProperty({ nullable: true }) billingAddressSnapshot!: Record<string, unknown> | null;
  @ApiProperty() placedAt!: Date;
  @ApiProperty({ nullable: true }) cancelledAt!: Date | null;
  @ApiProperty({ nullable: true }) completedAt!: Date | null;
  @ApiProperty({ type: [OrderItemResponseDto] }) items!: OrderItemResponseDto[];
  @ApiProperty({ type: [OrderStatusHistoryResponseDto] }) statusHistory!: OrderStatusHistoryResponseDto[];
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(detail: OrderWithDetail): OrderResponseDto {
    const dto = new OrderResponseDto();
    dto.id = detail.order.id;
    dto.orderNumber = detail.order.orderNumber;
    dto.checkoutSessionId = detail.order.checkoutSessionId;
    dto.paymentIntentId = detail.order.paymentIntentId;
    dto.customerId = detail.order.customerId;
    dto.source = detail.order.source;
    dto.status = detail.order.status;
    dto.paymentStatus = detail.order.paymentStatus;
    dto.fulfillmentStatus = detail.order.fulfillmentStatus;
    dto.currency = detail.order.currency;
    dto.subtotal = detail.order.subtotal.toString();
    dto.discountTotal = detail.order.discountTotal.toString();
    dto.taxTotal = detail.order.taxTotal.toString();
    dto.shippingTotal = detail.order.shippingTotal.toString();
    dto.grandTotal = detail.order.grandTotal.toString();
    dto.paidTotal = detail.order.paidTotal.toString();
    dto.refundedTotal = detail.order.refundedTotal.toString();
    dto.shippingAddressSnapshot = detail.order.shippingAddressSnapshot;
    dto.billingAddressSnapshot = detail.order.billingAddressSnapshot;
    dto.placedAt = detail.order.placedAt;
    dto.cancelledAt = detail.order.cancelledAt;
    dto.completedAt = detail.order.completedAt;
    dto.items = detail.items.map((item) => ({
      id: item.id,
      productSkuId: item.productSkuId,
      skuSnapshot: item.skuSnapshot,
      nameSnapshot: item.nameSnapshot,
      unitPriceSnapshot: item.unitPriceSnapshot.toString(),
      quantity: item.quantity,
      discountAmount: item.discountAmount.toString(),
      taxAmount: item.taxAmount.toString(),
      lineTotal: item.lineTotal.toString(),
    }));
    dto.statusHistory = detail.statusHistory.map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      changedBy: entry.changedBy,
      note: entry.note,
      createdAt: entry.createdAt,
    }));
    dto.createdAt = detail.order.createdAt;
    dto.updatedAt = detail.order.updatedAt;
    return dto;
  }
}

export class CancelOrderDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() reason?: string;
}

export class RequestOrderRefundDto {
  @ApiProperty({ description: 'Rial amount, as a positive integer.' })
  @IsInt()
  @IsPositive()
  amount!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() reason?: string;
}
