import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../../../common/decorators/public.decorator';
import { CheckoutService } from '../../application/checkout.service';
import { CurrentActor } from '../decorators/current-actor.decorator';
import { PricingResolutionResponseDto } from '../dto/cart.dto';
import { CheckoutAddressDto, CheckoutResponseDto, StartCheckoutDto } from '../dto/checkout.dto';
import { ActorResolverGuard } from '../guards/actor-resolver.guard';
import type { CartCheckoutActor } from '../request-context';

/** Same `@Public()` + `ActorResolverGuard` shape as `CartController` —
 * guest checkout must reach `READY_FOR_PAYMENT` without ever
 * authenticating (a common e-commerce pattern this repo doesn't forbid,
 * ADR-007's own scoping decision). */
@ApiTags('checkout')
@Controller('checkout')
@Public()
@UseGuards(ActorResolverGuard)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post()
  @ApiOkResponse({ type: CheckoutResponseDto })
  async start(
    @CurrentActor() actor: CartCheckoutActor,
    @Body() dto: StartCheckoutDto,
  ): Promise<CheckoutResponseDto> {
    const detail = await this.checkout.start(dto.cartId, actor, {
      idempotencyKey: dto.idempotencyKey,
      address: dto.address,
    });
    return CheckoutResponseDto.fromDomain(detail);
  }

  @Get(':id')
  @ApiOkResponse({ type: CheckoutResponseDto })
  async get(
    @CurrentActor() actor: CartCheckoutActor,
    @Param('id') id: string,
  ): Promise<CheckoutResponseDto> {
    const detail = await this.checkout.get(id, actor);
    return CheckoutResponseDto.fromDomain(detail);
  }

  @Post(':id/address')
  @ApiOkResponse({ type: CheckoutResponseDto })
  async setAddress(
    @CurrentActor() actor: CartCheckoutActor,
    @Param('id') id: string,
    @Body() dto: CheckoutAddressDto,
  ): Promise<CheckoutResponseDto> {
    const detail = await this.checkout.setAddress(id, actor, dto);
    return CheckoutResponseDto.fromDomain(detail);
  }

  @Post(':id/validate')
  @ApiOkResponse({ type: CheckoutResponseDto })
  async validate(
    @CurrentActor() actor: CartCheckoutActor,
    @Param('id') id: string,
  ): Promise<CheckoutResponseDto> {
    const detail = await this.checkout.validate(id, actor);
    return CheckoutResponseDto.fromDomain(detail);
  }

  @Post(':id/price')
  @ApiOkResponse({ type: PricingResolutionResponseDto })
  async price(
    @CurrentActor() actor: CartCheckoutActor,
    @Param('id') id: string,
  ): Promise<PricingResolutionResponseDto> {
    const resolution = await this.checkout.price(id, actor);
    return PricingResolutionResponseDto.fromDomain(resolution);
  }

  @Post(':id/reserve')
  @ApiOkResponse({ type: CheckoutResponseDto })
  async reserve(
    @CurrentActor() actor: CartCheckoutActor,
    @Param('id') id: string,
  ): Promise<CheckoutResponseDto> {
    const detail = await this.checkout.reserve(id, actor);
    return CheckoutResponseDto.fromDomain(detail);
  }

  @Post(':id/refresh')
  @ApiOkResponse({ type: CheckoutResponseDto })
  async refresh(
    @CurrentActor() actor: CartCheckoutActor,
    @Param('id') id: string,
  ): Promise<CheckoutResponseDto> {
    const detail = await this.checkout.refresh(id, actor);
    return CheckoutResponseDto.fromDomain(detail);
  }

  @Post(':id/cancel')
  @ApiOkResponse({ type: CheckoutResponseDto })
  async cancel(
    @CurrentActor() actor: CartCheckoutActor,
    @Param('id') id: string,
  ): Promise<CheckoutResponseDto> {
    const detail = await this.checkout.cancel(id, actor);
    return CheckoutResponseDto.fromDomain(detail);
  }

  @Post(':id/ready-for-payment')
  @ApiOkResponse({ type: CheckoutResponseDto })
  async readyForPayment(
    @CurrentActor() actor: CartCheckoutActor,
    @Param('id') id: string,
  ): Promise<CheckoutResponseDto> {
    const detail = await this.checkout.readyForPayment(id, actor);
    return CheckoutResponseDto.fromDomain(detail);
  }
}
