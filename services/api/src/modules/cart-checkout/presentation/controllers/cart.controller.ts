import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../../../common/decorators/public.decorator';
import { CartService } from '../../application/cart.service';
import { CurrentActor } from '../decorators/current-actor.decorator';
import {
  AddCartItemDto,
  ApplyCouponDto,
  CartResponseDto,
  MergeCartDto,
  PricingResolutionResponseDto,
  SelectShippingDto,
  UpdateCartItemQuantityDto,
} from '../dto/cart.dto';
import { ActorResolverGuard } from '../guards/actor-resolver.guard';
import type { CartCheckoutActor } from '../request-context';

/**
 * `@Public()` + `ActorResolverGuard` (not the global `JwtAuthGuard`) on
 * every route here — cart must support both guest and authenticated
 * callers (the brief's own rule), and the global guard would reject any
 * request with no Bearer token outright. See `ActorResolverGuard`'s own
 * doc comment for exactly how ownership/identity is resolved either way.
 */
@ApiTags('cart')
@Controller('cart')
@Public()
@UseGuards(ActorResolverGuard)
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Post()
  @ApiOkResponse({ type: CartResponseDto })
  async create(@CurrentActor() actor: CartCheckoutActor): Promise<CartResponseDto> {
    const result = actor.customerId
      ? await this.cart.getOrCreateForCustomer(actor.customerId)
      : await this.cart.getOrCreateForGuest(actor.guestToken);
    return CartResponseDto.fromDomain(result);
  }

  @Get()
  @ApiOkResponse({ type: CartResponseDto })
  async get(@CurrentActor() actor: CartCheckoutActor): Promise<CartResponseDto> {
    const result = actor.customerId
      ? await this.cart.getOrCreateForCustomer(actor.customerId)
      : await this.cart.getOrCreateForGuest(actor.guestToken);
    return CartResponseDto.fromDomain(result);
  }

  @Delete()
  async delete(@CurrentActor() actor: CartCheckoutActor): Promise<void> {
    const current = actor.customerId
      ? await this.cart.getOrCreateForCustomer(actor.customerId)
      : await this.cart.getOrCreateForGuest(actor.guestToken);
    await this.cart.deleteCart(current.cart.id, actor);
  }

  @Post('items')
  @ApiOkResponse({ type: CartResponseDto })
  async addItem(
    @CurrentActor() actor: CartCheckoutActor,
    @Body() dto: AddCartItemDto,
  ): Promise<CartResponseDto> {
    const current = actor.customerId
      ? await this.cart.getOrCreateForCustomer(actor.customerId)
      : await this.cart.getOrCreateForGuest(actor.guestToken);
    const result = await this.cart.addItem(current.cart.id, actor, dto);
    return CartResponseDto.fromDomain(result);
  }

  @Patch('items/:id')
  @ApiOkResponse({ type: CartResponseDto })
  async updateItemQuantity(
    @CurrentActor() actor: CartCheckoutActor,
    @Param('id') itemId: string,
    @Body() dto: UpdateCartItemQuantityDto,
  ): Promise<CartResponseDto> {
    const current = actor.customerId
      ? await this.cart.getOrCreateForCustomer(actor.customerId)
      : await this.cart.getOrCreateForGuest(actor.guestToken);
    const result = await this.cart.updateItemQuantity(current.cart.id, actor, itemId, dto.quantity);
    return CartResponseDto.fromDomain(result);
  }

  @Delete('items/:id')
  @ApiOkResponse({ type: CartResponseDto })
  async removeItem(
    @CurrentActor() actor: CartCheckoutActor,
    @Param('id') itemId: string,
  ): Promise<CartResponseDto> {
    const current = actor.customerId
      ? await this.cart.getOrCreateForCustomer(actor.customerId)
      : await this.cart.getOrCreateForGuest(actor.guestToken);
    const result = await this.cart.removeItem(current.cart.id, actor, itemId);
    return CartResponseDto.fromDomain(result);
  }

  /** Guest -> customer cart merge (ADR-007 decision 10) — called once a
   * guest authenticates. Requires the caller to already be authenticated
   * (the merge target is `actor.customerId`); the guest cart is
   * identified by the `guestToken` in the request body, not the
   * `X-Cart-Token` header (which, for an authenticated caller, isn't even
   * read by `ActorResolverGuard`). */
  @Post('merge')
  @ApiOkResponse({ type: CartResponseDto })
  async merge(
    @CurrentActor() actor: CartCheckoutActor,
    @Body() dto: MergeCartDto,
  ): Promise<CartResponseDto> {
    if (!actor.customerId) {
      throw new UnauthorizedException('Merging a guest cart requires an authenticated customer');
    }
    const result = await this.cart.mergeGuestIntoCustomer(dto.guestToken, actor.customerId);
    return CartResponseDto.fromDomain(result);
  }

  @Post('coupon')
  @ApiOkResponse({ type: CartResponseDto })
  async applyCoupon(
    @CurrentActor() actor: CartCheckoutActor,
    @Body() dto: ApplyCouponDto,
  ): Promise<CartResponseDto> {
    const current = actor.customerId
      ? await this.cart.getOrCreateForCustomer(actor.customerId)
      : await this.cart.getOrCreateForGuest(actor.guestToken);
    const result = await this.cart.applyCoupon(current.cart.id, actor, dto.code);
    return CartResponseDto.fromDomain(result);
  }

  @Delete('coupon')
  @ApiOkResponse({ type: CartResponseDto })
  async removeCoupon(@CurrentActor() actor: CartCheckoutActor): Promise<CartResponseDto> {
    const current = actor.customerId
      ? await this.cart.getOrCreateForCustomer(actor.customerId)
      : await this.cart.getOrCreateForGuest(actor.guestToken);
    const result = await this.cart.removeCoupon(current.cart.id, actor);
    return CartResponseDto.fromDomain(result);
  }

  @Post('shipping')
  @ApiOkResponse({ type: CartResponseDto })
  async selectShipping(
    @CurrentActor() actor: CartCheckoutActor,
    @Body() dto: SelectShippingDto,
  ): Promise<CartResponseDto> {
    const current = actor.customerId
      ? await this.cart.getOrCreateForCustomer(actor.customerId)
      : await this.cart.getOrCreateForGuest(actor.guestToken);
    const result = await this.cart.selectShipping(current.cart.id, actor, dto.shippingMethodId, {
      province: dto.province,
      city: dto.city,
    });
    return CartResponseDto.fromDomain(result);
  }

  /** Server-side recalculation preview — never trusts a client-supplied
   * total (the brief's own absolute rule). */
  @Post('price')
  @ApiOkResponse({ type: PricingResolutionResponseDto })
  async price(@CurrentActor() actor: CartCheckoutActor): Promise<PricingResolutionResponseDto> {
    const current = actor.customerId
      ? await this.cart.getOrCreateForCustomer(actor.customerId)
      : await this.cart.getOrCreateForGuest(actor.guestToken);
    const resolution = await this.cart.price(current.cart.id, actor);
    return PricingResolutionResponseDto.fromDomain(resolution);
  }
}
