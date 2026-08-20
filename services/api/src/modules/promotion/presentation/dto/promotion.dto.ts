import type { PromotionActionType, PromotionRuleType, PromotionTargetType } from '@iecp/types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

import type { Promotion } from '../../domain/entities/promotion.entity';

const DISCOUNT_TYPES: PromotionActionType[] = [
  'PERCENTAGE',
  'FIXED_AMOUNT',
  'FIXED_PRICE',
  'FREE_SHIPPING',
  'BUY_X_GET_Y',
  'BUNDLE_PRICE',
];
const TARGET_TYPES: PromotionTargetType[] = ['PRODUCT', 'SKU', 'CATEGORY', 'BRAND', 'COLLECTION'];
const RULE_TYPES: PromotionRuleType[] = [
  'MINIMUM_QUANTITY',
  'CUSTOMER_SEGMENT',
  'FIRST_PURCHASE_ONLY',
];

export class PromotionTargetDto {
  @ApiProperty({ enum: TARGET_TYPES }) @IsIn(TARGET_TYPES) type!: PromotionTargetType;
  @ApiProperty() @IsString() refId!: string;
}

export class PromotionRuleDto {
  @ApiProperty({ enum: RULE_TYPES }) @IsIn(RULE_TYPES) type!: PromotionRuleType;
  @ApiProperty({ type: Object }) config!: Record<string, unknown>;
}

/** Never accepts a client-supplied discount amount for an *order* — this
 * DTO only shapes what an *admin* declares a promotion's own rule to be
 * (§21's "never trust client-provided discount" is about checkout/order
 * pricing calls, not admin promotion authoring, which is RBAC-gated). */
export class CreatePromotionDto {
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) usageLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) perCustomerLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() stackable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() exclusive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() minimumCartValue?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() maximumDiscount?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresCoupon?: boolean;
  @ApiProperty({ enum: DISCOUNT_TYPES }) @IsIn(DISCOUNT_TYPES) discountType!: PromotionActionType;
  @ApiPropertyOptional() @IsOptional() @IsString() discountValue?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) buyQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) getQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) getDiscountBasisPoints?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() bundlePrice?: string;
  @ApiPropertyOptional({ type: [PromotionRuleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionRuleDto)
  rules?: PromotionRuleDto[];
  @ApiPropertyOptional({ type: [PromotionTargetDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionTargetDto)
  targets?: PromotionTargetDto[];
}

export class UpdatePromotionDto extends CreatePromotionDto {}

export class PromotionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() priority!: number;
  @ApiPropertyOptional() startsAt!: string | null;
  @ApiPropertyOptional() endsAt!: string | null;
  @ApiPropertyOptional() usageLimit!: number | null;
  @ApiPropertyOptional() perCustomerLimit!: number | null;
  @ApiProperty() usageCount!: number;
  @ApiProperty() stackable!: boolean;
  @ApiProperty() exclusive!: boolean;
  @ApiPropertyOptional() minimumCartValue!: string | null;
  @ApiPropertyOptional() maximumDiscount!: string | null;
  @ApiProperty() currency!: string;
  @ApiProperty() requiresCoupon!: boolean;
  @ApiProperty() discountType!: string;
  @ApiPropertyOptional() discountValue!: string | null;
  @ApiProperty({ type: [PromotionTargetDto] }) targets!: { type: string; refId: string }[];
  @ApiProperty({ type: [PromotionRuleDto] })
  rules!: { type: string; config: Record<string, unknown> }[];

  static fromDomain(promotion: Promotion): PromotionResponseDto {
    const dto = new PromotionResponseDto();
    dto.id = promotion.id;
    dto.name = promotion.name;
    dto.description = promotion.description;
    dto.status = promotion.status;
    dto.priority = promotion.priority;
    dto.startsAt = promotion.startsAt?.toISOString() ?? null;
    dto.endsAt = promotion.endsAt?.toISOString() ?? null;
    dto.usageLimit = promotion.usageLimit;
    dto.perCustomerLimit = promotion.perCustomerLimit;
    dto.usageCount = promotion.usageCount;
    dto.stackable = promotion.stackable;
    dto.exclusive = promotion.exclusive;
    dto.minimumCartValue = promotion.minimumCartValue?.toString() ?? null;
    dto.maximumDiscount = promotion.maximumDiscount?.toString() ?? null;
    dto.currency = promotion.currency;
    dto.requiresCoupon = promotion.requiresCoupon;
    dto.discountType = promotion.discountType;
    dto.discountValue = promotion.discountValue?.toString() ?? null;
    dto.targets = promotion.targets.map((target) => ({ type: target.type, refId: target.refId }));
    dto.rules = promotion.rules.map((rule) => ({ type: rule.type, config: rule.config }));
    return dto;
  }
}
