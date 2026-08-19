import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../../../common/decorators/public.decorator';
import { CurrentActor } from '../../../cart-checkout/presentation/decorators/current-actor.decorator';
import { ActorResolverGuard } from '../../../cart-checkout/presentation/guards/actor-resolver.guard';
import type { CartCheckoutActor } from '../../../cart-checkout/presentation/request-context';
import { FulfillmentService } from '../../application/fulfillment.service';
import { InvoiceService } from '../../application/invoice.service';
import { OrderService } from '../../application/order.service';
import { FulfillmentResponseDto } from '../dto/fulfillment.dto';
import { InvoiceResponseDto } from '../dto/invoice.dto';
import { OrderResponseDto } from '../dto/order.dto';

/**
 * Customer/guest-facing order routes — same `ActorResolverGuard`
 * dual-auth shape `PaymentIntentController` already reuses directly
 * (ADR-009 decision 11: an order's owner is exactly its originating
 * checkout's owner, customer or guest alike).
 */
@ApiTags('orders')
@Controller('orders')
@Public()
@UseGuards(ActorResolverGuard)
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly invoices: InvoiceService,
    private readonly fulfillments: FulfillmentService,
  ) {}

  @Get()
  @ApiOkResponse({ type: [OrderResponseDto] })
  async list(
    @CurrentActor() actor: CartCheckoutActor,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = limitRaw ? Math.min(Math.max(Number(limitRaw), 1), 100) : 20;
    const { items, nextCursor } = await this.orders.list(actor, limit, cursor);
    const detailed = await Promise.all(items.map((order) => this.orders.get(order.id, actor)));
    return { items: detailed.map((item) => OrderResponseDto.fromDomain(item)), nextCursor };
  }

  @Get(':id')
  @ApiOkResponse({ type: OrderResponseDto })
  async get(@CurrentActor() actor: CartCheckoutActor, @Param('id') id: string) {
    const detail = await this.orders.get(id, actor);
    return OrderResponseDto.fromDomain(detail);
  }

  @Get(':id/invoice')
  @ApiOkResponse({ type: InvoiceResponseDto })
  async getInvoice(@CurrentActor() actor: CartCheckoutActor, @Param('id') id: string) {
    await this.orders.get(id, actor); // ownership check
    const detail = await this.invoices.getByOrderId(id);
    if (!detail) throw new NotFoundException('Invoice not found for this order');
    return InvoiceResponseDto.fromDomain(detail);
  }

  @Get(':id/shipments')
  @ApiOkResponse({ type: [FulfillmentResponseDto] })
  async getShipments(@CurrentActor() actor: CartCheckoutActor, @Param('id') id: string) {
    await this.orders.get(id, actor); // ownership check
    const fulfillments = await this.fulfillments.listByOrder(id);
    return fulfillments.map((item) => FulfillmentResponseDto.fromDomain(item));
  }
}
