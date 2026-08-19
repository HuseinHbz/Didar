import type { PromotionStatus, UserId } from '@iecp/types';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { CouponService } from '../../application/coupon.service';
import { PromotionService } from '../../application/promotion.service';
import type { PromotionRuleConfig } from '../../domain/entities/promotion-rule.entity';
import { CouponResponseDto } from '../dto/coupon.dto';
import {
  CreatePromotionDto,
  PromotionResponseDto,
  type PromotionRuleDto,
  UpdatePromotionDto,
} from '../dto/promotion.dto';

function toRules(rules: PromotionRuleDto[] | undefined) {
  return rules?.map((rule) => ({ type: rule.type, config: rule.config as PromotionRuleConfig }));
}

/** `/admin/promotions/*` (§17) — every route RBAC-gated
 * (`promotion.*`), no ownership check (admin/marketing scope). */
@ApiTags('admin/promotions')
@Controller('admin/promotions')
export class PromotionAdminController {
  constructor(
    private readonly promotions: PromotionService,
    private readonly coupons: CouponService,
  ) {}

  @Get()
  @RequirePermission('promotion.read')
  @ApiOkResponse({ type: [PromotionResponseDto] })
  async list(
    @Query('status') status?: PromotionStatus,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const limit = limitRaw ? Math.min(Math.max(Number(limitRaw), 1), 100) : 20;
    const offset = offsetRaw ? Math.max(Number(offsetRaw), 0) : 0;
    const { items, total } = await this.promotions.list({ status, limit, offset });
    return { items: items.map((item) => PromotionResponseDto.fromDomain(item)), total };
  }

  @Get(':id')
  @RequirePermission('promotion.read')
  @ApiOkResponse({ type: PromotionResponseDto })
  async get(@Param('id') id: string) {
    return PromotionResponseDto.fromDomain(await this.promotions.get(id));
  }

  @Post()
  @RequirePermission('promotion.create')
  @ApiOkResponse({ type: PromotionResponseDto })
  async create(@Body() dto: CreatePromotionDto, @CurrentUserId() actorId: UserId) {
    const promotion = await this.promotions.create(
      {
        name: dto.name,
        description: dto.description ?? null,
        priority: dto.priority ?? 100,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        usageLimit: dto.usageLimit ?? null,
        perCustomerLimit: dto.perCustomerLimit ?? null,
        stackable: dto.stackable ?? false,
        exclusive: dto.exclusive ?? false,
        minimumCartValue: dto.minimumCartValue ? BigInt(dto.minimumCartValue) : null,
        maximumDiscount: dto.maximumDiscount ? BigInt(dto.maximumDiscount) : null,
        currency: 'IRR',
        requiresCoupon: dto.requiresCoupon ?? true,
        discountType: dto.discountType,
        discountValue: dto.discountValue ? BigInt(dto.discountValue) : null,
        buyQuantity: dto.buyQuantity ?? null,
        getQuantity: dto.getQuantity ?? null,
        getDiscountBasisPoints: dto.getDiscountBasisPoints ?? null,
        bundlePrice: dto.bundlePrice ? BigInt(dto.bundlePrice) : null,
        rules: toRules(dto.rules) ?? [],
        targets: dto.targets ?? [],
      },
      actorId,
    );
    return PromotionResponseDto.fromDomain(promotion);
  }

  @Patch(':id')
  @RequirePermission('promotion.update')
  @ApiOkResponse({ type: PromotionResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePromotionDto,
    @CurrentUserId() actorId: UserId,
  ) {
    const promotion = await this.promotions.update(
      id,
      {
        name: dto.name,
        description: dto.description,
        priority: dto.priority,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        usageLimit: dto.usageLimit,
        perCustomerLimit: dto.perCustomerLimit,
        stackable: dto.stackable,
        exclusive: dto.exclusive,
        minimumCartValue: dto.minimumCartValue ? BigInt(dto.minimumCartValue) : undefined,
        maximumDiscount: dto.maximumDiscount ? BigInt(dto.maximumDiscount) : undefined,
        requiresCoupon: dto.requiresCoupon,
        discountType: dto.discountType,
        discountValue: dto.discountValue ? BigInt(dto.discountValue) : undefined,
        buyQuantity: dto.buyQuantity,
        getQuantity: dto.getQuantity,
        getDiscountBasisPoints: dto.getDiscountBasisPoints,
        bundlePrice: dto.bundlePrice ? BigInt(dto.bundlePrice) : undefined,
        rules: toRules(dto.rules),
        targets: dto.targets,
      },
      actorId,
    );
    return PromotionResponseDto.fromDomain(promotion);
  }

  @Post(':id/activate')
  @RequirePermission('promotion.activate')
  @ApiOkResponse({ type: PromotionResponseDto })
  async activate(@Param('id') id: string, @CurrentUserId() actorId: UserId) {
    return PromotionResponseDto.fromDomain(await this.promotions.activate(id, actorId));
  }

  @Post(':id/pause')
  @RequirePermission('promotion.pause')
  @ApiOkResponse({ type: PromotionResponseDto })
  async pause(@Param('id') id: string, @CurrentUserId() actorId: UserId) {
    return PromotionResponseDto.fromDomain(await this.promotions.pause(id, actorId));
  }

  @Post(':id/archive')
  @RequirePermission('promotion.archive')
  @ApiOkResponse({ type: PromotionResponseDto })
  async archive(@Param('id') id: string, @CurrentUserId() actorId: UserId) {
    return PromotionResponseDto.fromDomain(await this.promotions.archive(id, actorId));
  }

  /** Read-only convenience view — rules/targets have no independent
   * lifecycle (ADR-010 decision 1) and are managed via the promotion's
   * own `PATCH` body; this route exists for the admin UI to fetch just
   * the rule list without the rest of the promotion payload. */
  @Get(':id/rules')
  @RequirePermission('promotion.read')
  async rules(@Param('id') id: string) {
    const promotion = await this.promotions.get(id);
    return promotion.rules.map((rule) => ({ type: rule.type, config: rule.config }));
  }

  @Get(':id/coupons')
  @RequirePermission('promotion.read')
  @ApiOkResponse({ type: [CouponResponseDto] })
  async listCoupons(@Param('id') id: string) {
    const coupons = await this.coupons.listByPromotion(id);
    return coupons.map((coupon) => CouponResponseDto.fromDomain(coupon));
  }
}
