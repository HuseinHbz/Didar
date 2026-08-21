import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../../../common/decorators/public.decorator';
import { CurrentActor } from '../../../cart-checkout/presentation/decorators/current-actor.decorator';
import { ActorResolverGuard } from '../../../cart-checkout/presentation/guards/actor-resolver.guard';
import type { CartCheckoutActor } from '../../../cart-checkout/presentation/request-context';
import { ReturnService } from '../../application/return.service';
import { CreateReturnDto, ReturnResponseDto } from '../dto/return.dto';

/**
 * Customer/guest-facing return routes — same `ActorResolverGuard`
 * dual-auth shape `OrderController` already reuses (ADR-012's own note:
 * a return's owner is exactly its originating order's owner). `cancel`
 * and `ship` consume no RBAC permission — the customer's own withdrawal/
 * shipping-notice actions, ownership-gated by `ReturnService` itself.
 */
@ApiTags('returns')
@Controller('returns')
@Public()
@UseGuards(ActorResolverGuard)
export class ReturnController {
  constructor(private readonly returns: ReturnService) {}

  @Post()
  @ApiOkResponse({ type: ReturnResponseDto })
  async create(@CurrentActor() actor: CartCheckoutActor, @Body() dto: CreateReturnDto) {
    const created = await this.returns.create(actor, dto);
    const detail = await this.returns.get(created.id, actor);
    return ReturnResponseDto.fromDomain(detail);
  }

  @Get()
  @ApiOkResponse({ type: [ReturnResponseDto] })
  async list(
    @CurrentActor() actor: CartCheckoutActor,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = limitRaw ? Math.min(Math.max(Number(limitRaw), 1), 100) : 20;
    const { items, nextCursor } = await this.returns.list(actor, limit, cursor);
    const detailed = await Promise.all(items.map((item) => this.returns.get(item.id, actor)));
    return { items: detailed.map((item) => ReturnResponseDto.fromDomain(item)), nextCursor };
  }

  @Get(':id')
  @ApiOkResponse({ type: ReturnResponseDto })
  async get(@CurrentActor() actor: CartCheckoutActor, @Param('id') id: string) {
    const detail = await this.returns.get(id, actor);
    return ReturnResponseDto.fromDomain(detail);
  }

  @Post(':id/cancel')
  @ApiOkResponse({ type: ReturnResponseDto })
  async cancel(@CurrentActor() actor: CartCheckoutActor, @Param('id') id: string) {
    await this.returns.cancel(id, actor);
    const detail = await this.returns.get(id, actor);
    return ReturnResponseDto.fromDomain(detail);
  }

  @Post(':id/ship')
  @ApiOkResponse({ type: ReturnResponseDto })
  async ship(@CurrentActor() actor: CartCheckoutActor, @Param('id') id: string) {
    await this.returns.markShipped(id, actor);
    const detail = await this.returns.get(id, actor);
    return ReturnResponseDto.fromDomain(detail);
  }
}
