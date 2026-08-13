import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';

import type { CheckoutSessionWithDetail } from '../../domain/ports/checkout-session.repository.port';

import { PriceLineResponseDto } from './cart.dto';

export class CheckoutAddressDto {
  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerAddressId?: string | null;
  @ApiProperty() @IsString() @MinLength(1) recipientName!: string;
  @ApiProperty() @IsString() @MinLength(1) phone!: string;
  @ApiProperty() @IsString() @MinLength(1) province!: string;
  @ApiProperty() @IsString() @MinLength(1) city!: string;
  @ApiProperty() @IsString() @MinLength(1) addressLine1!: string;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() addressLine2?:
    string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() postalCode?:
    string | null;
}

export class StartCheckoutDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() cartId!: string;
  @ApiProperty({
    required: false,
    description:
      'Client-supplied idempotency key — a retried request with the same key returns the original checkout session.',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
  @ApiProperty({ required: false, type: CheckoutAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutAddressDto)
  address?: CheckoutAddressDto;
}

export class CheckoutAddressResponseDto {
  @ApiProperty({ nullable: true, format: 'uuid' }) customerAddressId!: string | null;
  @ApiProperty() recipientName!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() province!: string;
  @ApiProperty() city!: string;
  @ApiProperty() addressLine1!: string;
  @ApiProperty({ nullable: true }) addressLine2!: string | null;
  @ApiProperty({ nullable: true }) postalCode!: string | null;
}

export class CheckoutValidationIssueDto {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ required: false, format: 'uuid' }) productSkuId?: string;
}

export class CheckoutValidationResponseDto {
  @ApiProperty() outcome!: string;
  @ApiProperty({ type: [CheckoutValidationIssueDto] }) issues!: CheckoutValidationIssueDto[];
  @ApiProperty() validatedAt!: Date;
}

export class CheckoutTotalsResponseDto {
  @ApiProperty() currency!: string;
  @ApiProperty() subtotal!: string;
  @ApiProperty() discountTotal!: string;
  @ApiProperty() taxTotal!: string;
  @ApiProperty() shippingTotal!: string;
  @ApiProperty() grandTotal!: string;
  @ApiProperty({ type: [PriceLineResponseDto] }) breakdown!: PriceLineResponseDto[];
  @ApiProperty() calculatedAt!: Date;
}

export class CheckoutReservationResponseDto {
  @ApiProperty({ format: 'uuid' }) productSkuId!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ format: 'uuid' }) inventoryReservationId!: string;
  @ApiProperty() quantity!: number;
}

export class CheckoutResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) cartId!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) customerId!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() subtotal!: string;
  @ApiProperty() discountTotal!: string;
  @ApiProperty() taxTotal!: string;
  @ApiProperty() shippingTotal!: string;
  @ApiProperty() grandTotal!: string;
  @ApiProperty({ nullable: true }) expiresAt!: Date | null;
  @ApiProperty() idempotencyKey!: string;
  @ApiProperty({ nullable: true, type: CheckoutAddressResponseDto })
  address!: CheckoutAddressResponseDto | null;
  @ApiProperty({ nullable: true, type: CheckoutTotalsResponseDto })
  latestTotals!: CheckoutTotalsResponseDto | null;
  @ApiProperty({ nullable: true, type: CheckoutValidationResponseDto })
  latestValidation!: CheckoutValidationResponseDto | null;
  @ApiProperty({ type: [CheckoutReservationResponseDto] })
  reservations!: CheckoutReservationResponseDto[];
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(detail: CheckoutSessionWithDetail): CheckoutResponseDto {
    const dto = new CheckoutResponseDto();
    dto.id = detail.session.id;
    dto.cartId = detail.session.cartId;
    dto.customerId = detail.session.customerId;
    dto.status = detail.session.status;
    dto.currency = detail.session.currency;
    dto.subtotal = detail.session.subtotal.toString();
    dto.discountTotal = detail.session.discountTotal.toString();
    dto.taxTotal = detail.session.taxTotal.toString();
    dto.shippingTotal = detail.session.shippingTotal.toString();
    dto.grandTotal = detail.session.grandTotal.toString();
    dto.expiresAt = detail.session.expiresAt;
    dto.idempotencyKey = detail.session.idempotencyKey;
    dto.address = detail.address
      ? {
          customerAddressId: detail.address.customerAddressId,
          recipientName: detail.address.recipientName,
          phone: detail.address.phone,
          province: detail.address.province,
          city: detail.address.city,
          addressLine1: detail.address.addressLine1,
          addressLine2: detail.address.addressLine2,
          postalCode: detail.address.postalCode,
        }
      : null;
    dto.latestTotals = detail.latestTotals
      ? {
          currency: detail.latestTotals.currency,
          subtotal: detail.latestTotals.subtotal.toString(),
          discountTotal: detail.latestTotals.discountTotal.toString(),
          taxTotal: detail.latestTotals.taxTotal.toString(),
          shippingTotal: detail.latestTotals.shippingTotal.toString(),
          grandTotal: detail.latestTotals.grandTotal.toString(),
          breakdown: detail.latestTotals.breakdown.map((line) => ({
            productSkuId: line.productSkuId,
            quantity: line.quantity,
            basePrice: line.basePrice.toString(),
            resolvedUnitPrice: line.resolvedUnitPrice.toString(),
            lineDiscount: line.lineDiscount.toString(),
            lineTax: line.lineTax.toString(),
            lineSubtotal: line.lineSubtotal.toString(),
            taxRateBasisPoints: line.taxRateBasisPoints,
          })),
          calculatedAt: detail.latestTotals.calculatedAt,
        }
      : null;
    dto.latestValidation = detail.latestValidation
      ? {
          outcome: detail.latestValidation.outcome,
          issues: detail.latestValidation.issues.map((issue) => ({ ...issue })),
          validatedAt: detail.latestValidation.validatedAt,
        }
      : null;
    dto.reservations = detail.reservations.map((reservation) => ({
      productSkuId: reservation.productSkuId,
      warehouseId: reservation.warehouseId,
      inventoryReservationId: reservation.inventoryReservationId,
      quantity: reservation.quantity,
    }));
    dto.createdAt = detail.session.createdAt;
    dto.updatedAt = detail.session.updatedAt;
    return dto;
  }
}
