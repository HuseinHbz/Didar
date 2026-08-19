import { type UserId } from '@iecp/types';
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { FulfillmentService } from '../../application/fulfillment.service';
import {
  CreateFulfillmentDto,
  CreateShipmentDto,
  FulfillmentResponseDto,
  ShipmentResponseDto,
  UpdateFulfillmentStatusDto,
  UpdateShipmentStatusDto,
} from '../dto/fulfillment.dto';

/** Admin fulfillment + shipment routes (ADR-009 decisions 8/12) —
 * `order.fulfill`/`order.ship`/`order.shipment.*` permissions, no
 * ownership check (admin/support scope). */
@ApiTags('admin/orders')
@Controller('admin/orders/:orderId')
export class FulfillmentAdminController {
  constructor(private readonly fulfillments: FulfillmentService) {}

  @Get('fulfillments')
  @RequirePermission('order.read')
  @ApiOkResponse({ type: [FulfillmentResponseDto] })
  async list(@Param('orderId') orderId: string) {
    const detail = await this.fulfillments.listByOrder(orderId);
    return detail.map((item) => FulfillmentResponseDto.fromDomain(item));
  }

  @Post('fulfillments')
  @RequirePermission('order.fulfill')
  @ApiOkResponse({ type: FulfillmentResponseDto })
  async create(
    @Param('orderId') orderId: string,
    @CurrentUserId() actorId: UserId,
    @Body() dto: CreateFulfillmentDto,
  ) {
    const fulfillment = await this.fulfillments.create(orderId, actorId, {
      warehouseId: dto.warehouseId,
      items: dto.items,
    });
    const detail = await this.fulfillments.get(fulfillment.id);
    return FulfillmentResponseDto.fromDomain(detail);
  }

  @Patch('fulfillments/:fulfillmentId')
  @RequirePermission('order.update')
  @ApiOkResponse({ type: FulfillmentResponseDto })
  async updateStatus(
    @Param('fulfillmentId') fulfillmentId: string,
    @CurrentUserId() actorId: UserId,
    @Body() dto: UpdateFulfillmentStatusDto,
  ) {
    await this.fulfillments.updateStatus(fulfillmentId, actorId, dto.status);
    const detail = await this.fulfillments.get(fulfillmentId);
    return FulfillmentResponseDto.fromDomain(detail);
  }

  @Post('fulfillments/:fulfillmentId/shipments')
  @RequirePermission('order.ship')
  @ApiOkResponse({ type: ShipmentResponseDto })
  async createShipment(
    @Param('fulfillmentId') fulfillmentId: string,
    @CurrentUserId() actorId: UserId,
    @Body() dto: CreateShipmentDto,
  ) {
    await this.fulfillments.createShipment(fulfillmentId, actorId, dto);
    const detail = await this.fulfillments.get(fulfillmentId);
    return detail.shipment ? FulfillmentResponseDto.fromDomain(detail).shipment : null;
  }

  @Get('shipments')
  @RequirePermission('order.shipment.read')
  @ApiOkResponse({ type: [FulfillmentResponseDto] })
  async listShipments(@Param('orderId') orderId: string) {
    const detail = await this.fulfillments.listByOrder(orderId);
    return detail.map((item) => FulfillmentResponseDto.fromDomain(item));
  }

  @Patch('shipments/:shipmentId')
  @RequirePermission('order.shipment.update')
  @ApiOkResponse()
  async updateShipmentStatus(
    @Param('shipmentId') shipmentId: string,
    @CurrentUserId() actorId: UserId,
    @Body() dto: UpdateShipmentStatusDto,
  ) {
    return this.fulfillments.updateShipmentStatus(shipmentId, actorId, dto.status, dto.location);
  }
}
