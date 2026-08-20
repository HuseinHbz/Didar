import { type UserId } from '@iecp/types';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { OrderConversionService } from '../../application/order-conversion.service';
import { OrderService } from '../../application/order.service';
import type { OrderListFilter } from '../../domain/ports/order.repository.port';
import { CancelOrderDto, OrderResponseDto, RequestOrderRefundDto } from '../dto/order.dto';

/** Admin order lifecycle — every route permission-gated
 * (`@RequirePermission`), no ownership check (an admin/support user may
 * act on any order). Global `JwtAuthGuard`/`AuthorizationGuard` already
 * cover authentication, same as every other `admin/*` route in this
 * service. */
@ApiTags('admin/orders')
@Controller('admin/orders')
export class OrderAdminController {
  constructor(
    private readonly orders: OrderService,
    private readonly conversion: OrderConversionService,
  ) {}

  /** ADR-011 decision 6 — real, database-backed search/filter: status,
   * payment state, fulfillment state, a placed-date range, and a
   * specific customer, any combination at once. All applied as genuine
   * `WHERE` clauses (`PrismaOrderRepository.list()`), never fetched-then-
   * filtered here. */
  @Get()
  @RequirePermission('order.read')
  @ApiOkResponse({ type: [OrderResponseDto] })
  async list(
    @Query('status') status?: OrderListFilter['status'],
    @Query('paymentStatus') paymentStatus?: OrderListFilter['paymentStatus'],
    @Query('fulfillmentStatus') fulfillmentStatus?: OrderListFilter['fulfillmentStatus'],
    @Query('customerId') customerId?: string,
    @Query('placedFrom') placedFrom?: string,
    @Query('placedTo') placedTo?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = limitRaw ? Math.min(Math.max(Number(limitRaw), 1), 100) : 20;
    const { items, nextCursor } = await this.orders.listForAdmin({
      status,
      paymentStatus,
      fulfillmentStatus,
      customerId,
      placedFrom: placedFrom ? new Date(placedFrom) : undefined,
      placedTo: placedTo ? new Date(placedTo) : undefined,
      limit,
      cursor,
    });
    const detailed = await Promise.all(items.map((order) => this.orders.getForAdmin(order.id)));
    return { items: detailed.map((item) => OrderResponseDto.fromDomain(item)), nextCursor };
  }

  @Get(':id')
  @RequirePermission('order.read')
  @ApiOkResponse({ type: OrderResponseDto })
  async get(@Param('id') id: string) {
    const detail = await this.orders.getForAdmin(id);
    return OrderResponseDto.fromDomain(detail);
  }

  /** Manual conversion trigger — support investigating a checkout whose
   * payment verified but the order-conversion sweep hasn't caught yet.
   * Idempotent (the exact same `convertFromCheckout()` the sweep and the
   * synchronous path use); returns `null`-shaped 404 if the checkout
   * hasn't actually verified a payment yet. */
  @Post(':checkoutSessionId/convert')
  @RequirePermission('order.create')
  @ApiOkResponse({ type: OrderResponseDto })
  async convert(@Param('checkoutSessionId') checkoutSessionId: string) {
    const order = await this.conversion.convertFromCheckout(checkoutSessionId);
    if (!order) {
      return { converted: false, message: 'Checkout has not verified a payment yet' };
    }
    const detail = await this.orders.getForAdmin(order.id);
    return OrderResponseDto.fromDomain(detail);
  }

  @Post(':id/approve')
  @RequirePermission('order.approve')
  @ApiOkResponse({ type: OrderResponseDto })
  async approve(@Param('id') id: string, @CurrentUserId() actorId: UserId) {
    await this.orders.approve(id, actorId);
    const detail = await this.orders.getForAdmin(id);
    return OrderResponseDto.fromDomain(detail);
  }

  @Post(':id/complete')
  @RequirePermission('order.complete')
  @ApiOkResponse({ type: OrderResponseDto })
  async complete(@Param('id') id: string, @CurrentUserId() actorId: UserId) {
    await this.orders.complete(id, actorId);
    const detail = await this.orders.getForAdmin(id);
    return OrderResponseDto.fromDomain(detail);
  }

  @Post(':id/cancel')
  @RequirePermission('order.cancel')
  @ApiOkResponse({ type: OrderResponseDto })
  async cancel(
    @Param('id') id: string,
    @CurrentUserId() actorId: UserId,
    @Body() dto: CancelOrderDto,
  ) {
    await this.orders.cancel(id, actorId, dto.reason);
    const detail = await this.orders.getForAdmin(id);
    return OrderResponseDto.fromDomain(detail);
  }

  @Post(':id/refund')
  @RequirePermission('order.refund')
  @ApiOkResponse({ type: OrderResponseDto })
  async requestRefund(
    @Param('id') id: string,
    @CurrentUserId() actorId: UserId,
    @Body() dto: RequestOrderRefundDto,
  ) {
    await this.orders.requestPartialRefund(id, actorId, BigInt(dto.amount), dto.reason);
    const detail = await this.orders.getForAdmin(id);
    return OrderResponseDto.fromDomain(detail);
  }
}
