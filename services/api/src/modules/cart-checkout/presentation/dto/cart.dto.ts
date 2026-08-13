import { CART_ITEM_OPTION_TYPES, type CartItemOptionType } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';

import type { CartWithItems } from '../../domain/ports/cart.repository.port';
import type { PricingResolution } from '../../domain/services/pricing-resolver';

export class CartItemOptionDto {
  @ApiProperty({ enum: CART_ITEM_OPTION_TYPES })
  @IsIn(CART_ITEM_OPTION_TYPES)
  optionType!: CartItemOptionType;
  @ApiProperty() @IsString() @MinLength(1) optionKey!: string;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() optionLabel?:
    string | null;
}

export class AddCartItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() productSkuId!: string;
  @ApiProperty() @IsInt() @IsPositive() quantity!: number;
  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Line-specific configuration (lens selection, prescription reference, customization reference) — never raw sensitive data.',
  })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown> | null;
  @ApiProperty({ required: false, type: [CartItemOptionDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CartItemOptionDto)
  options?: CartItemOptionDto[];
}

export class UpdateCartItemQuantityDto {
  @ApiProperty() @IsInt() @IsPositive() quantity!: number;
}

export class MergeCartDto {
  @ApiProperty({
    description: "The guest cart token to merge into the authenticated customer's cart.",
  })
  @IsString()
  @MinLength(1)
  guestToken!: string;
}

export class ApplyCouponDto {
  @ApiProperty() @IsString() @MinLength(1) code!: string;
}

export class SelectShippingDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() shippingMethodId!: string;
  @ApiProperty() @IsString() @MinLength(1) province!: string;
  @ApiProperty() @IsString() @MinLength(1) city!: string;
}

export class CartItemOptionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: CART_ITEM_OPTION_TYPES }) optionType!: CartItemOptionType;
  @ApiProperty() optionKey!: string;
  @ApiProperty({ nullable: true }) optionLabel!: string | null;
  @ApiProperty({ nullable: true }) priceAdjustment!: string | null;
}

export class CartItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productSkuId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPriceSnapshot!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true }) configurationSnapshot!: Record<string, unknown> | null;
  @ApiProperty() lineSubtotal!: string;
  @ApiProperty({ type: [CartItemOptionResponseDto] }) options!: CartItemOptionResponseDto[];
}

export class CartResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) customerId!: string | null;
  @ApiProperty({ nullable: true }) guestToken!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true }) expiresAt!: Date | null;
  @ApiProperty({ type: [CartItemResponseDto] }) items!: CartItemResponseDto[];
  @ApiProperty({ nullable: true }) couponCode!: string | null;
  @ApiProperty({ nullable: true }) shippingMethodId!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(result: CartWithItems): CartResponseDto {
    const dto = new CartResponseDto();
    dto.id = result.cart.id;
    dto.customerId = result.cart.customerId;
    dto.guestToken = result.cart.guestToken;
    dto.status = result.cart.status;
    dto.currency = result.cart.currency;
    dto.expiresAt = result.cart.expiresAt;
    dto.items = result.items.map((item) => {
      const itemDto = new CartItemResponseDto();
      itemDto.id = item.id;
      itemDto.productSkuId = item.productSkuId;
      itemDto.quantity = item.quantity;
      itemDto.unitPriceSnapshot = item.unitPriceSnapshot.toString();
      itemDto.currency = item.currency;
      itemDto.configurationSnapshot = item.configurationSnapshot;
      itemDto.lineSubtotal = item.lineSubtotal.toString();
      itemDto.options = item.options.map((option) => {
        const optionDto = new CartItemOptionResponseDto();
        optionDto.id = option.id;
        optionDto.optionType = option.optionType;
        optionDto.optionKey = option.optionKey;
        optionDto.optionLabel = option.optionLabel;
        optionDto.priceAdjustment = option.priceAdjustment?.toString() ?? null;
        return optionDto;
      });
      return itemDto;
    });
    dto.couponCode = result.coupon?.code ?? null;
    dto.shippingMethodId = result.shippingSelection?.shippingMethodId ?? null;
    dto.createdAt = result.cart.createdAt;
    dto.updatedAt = result.cart.updatedAt;
    return dto;
  }
}

export class PriceLineResponseDto {
  @ApiProperty({ format: 'uuid' }) productSkuId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() basePrice!: string;
  @ApiProperty() resolvedUnitPrice!: string;
  @ApiProperty() lineDiscount!: string;
  @ApiProperty() lineTax!: string;
  @ApiProperty() lineSubtotal!: string;
  @ApiProperty() taxRateBasisPoints!: number;
}

export class PricingResolutionResponseDto {
  @ApiProperty({ type: [PriceLineResponseDto] }) lines!: PriceLineResponseDto[];
  @ApiProperty() subtotal!: string;
  @ApiProperty() discountTotal!: string;
  @ApiProperty() taxTotal!: string;
  @ApiProperty() shippingTotal!: string;
  @ApiProperty() grandTotal!: string;

  static fromDomain(resolution: PricingResolution): PricingResolutionResponseDto {
    const dto = new PricingResolutionResponseDto();
    dto.lines = resolution.lines.map((line) => {
      const lineDto = new PriceLineResponseDto();
      lineDto.productSkuId = line.productSkuId;
      lineDto.quantity = line.quantity;
      lineDto.basePrice = line.basePrice.toString();
      lineDto.resolvedUnitPrice = line.resolvedUnitPrice.toString();
      lineDto.lineDiscount = line.lineDiscount.toString();
      lineDto.lineTax = line.lineTax.toString();
      lineDto.lineSubtotal = line.lineSubtotal.toString();
      lineDto.taxRateBasisPoints = line.taxRateBasisPoints;
      return lineDto;
    });
    dto.subtotal = resolution.subtotal.toString();
    dto.discountTotal = resolution.discountTotal.toString();
    dto.taxTotal = resolution.taxTotal.toString();
    dto.shippingTotal = resolution.shippingTotal.toString();
    dto.grandTotal = resolution.grandTotal.toString();
    return dto;
  }
}
