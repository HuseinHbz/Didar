import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

import type { Coupon } from '../../domain/entities/coupon.entity';

export class CreateCouponDto {
  @ApiProperty() @IsString() promotionId!: string;
  @ApiProperty() @IsString() code!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) usageLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) perCustomerLimit?: number;
}

export class CouponResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() promotionId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() startsAt!: string | null;
  @ApiPropertyOptional() expiresAt!: string | null;
  @ApiPropertyOptional() usageLimit!: number | null;
  @ApiProperty() usageCount!: number;
  @ApiPropertyOptional() perCustomerLimit!: number | null;

  static fromDomain(coupon: Coupon): CouponResponseDto {
    const dto = new CouponResponseDto();
    dto.id = coupon.id;
    dto.promotionId = coupon.promotionId;
    dto.code = coupon.code;
    dto.status = coupon.status;
    dto.startsAt = coupon.startsAt?.toISOString() ?? null;
    dto.expiresAt = coupon.expiresAt?.toISOString() ?? null;
    dto.usageLimit = coupon.usageLimit;
    dto.usageCount = coupon.usageCount;
    dto.perCustomerLimit = coupon.perCustomerLimit;
    return dto;
  }
}
