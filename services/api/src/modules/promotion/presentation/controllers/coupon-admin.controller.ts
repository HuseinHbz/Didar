import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { CouponService } from '../../application/coupon.service';
import { CreateCouponDto, CouponResponseDto } from '../dto/coupon.dto';

/** `/admin/coupons/*` (§17) — every route RBAC-gated (`coupon.*`). */
@ApiTags('admin/coupons')
@Controller('admin/coupons')
export class CouponAdminController {
  constructor(private readonly coupons: CouponService) {}

  @Post()
  @RequirePermission('coupon.create')
  @ApiOkResponse({ type: CouponResponseDto })
  async create(@Body() dto: CreateCouponDto) {
    const coupon = await this.coupons.create({
      promotionId: dto.promotionId,
      code: dto.code,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      usageLimit: dto.usageLimit ?? null,
      perCustomerLimit: dto.perCustomerLimit ?? null,
      metadata: null,
    });
    return CouponResponseDto.fromDomain(coupon);
  }

  @Get(':id')
  @RequirePermission('coupon.read')
  @ApiOkResponse({ type: CouponResponseDto })
  async get(@Param('id') id: string) {
    return CouponResponseDto.fromDomain(await this.coupons.get(id));
  }

  @Post(':id/disable')
  @RequirePermission('coupon.disable')
  @ApiOkResponse({ type: CouponResponseDto })
  async disable(@Param('id') id: string) {
    return CouponResponseDto.fromDomain(await this.coupons.disable(id));
  }

  @Post(':id/pause')
  @RequirePermission('coupon.update')
  @ApiOkResponse({ type: CouponResponseDto })
  async pause(@Param('id') id: string) {
    return CouponResponseDto.fromDomain(await this.coupons.pause(id));
  }

  @Post(':id/activate')
  @RequirePermission('coupon.update')
  @ApiOkResponse({ type: CouponResponseDto })
  async activate(@Param('id') id: string) {
    return CouponResponseDto.fromDomain(await this.coupons.activate(id));
  }
}
