import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { FulfillmentService } from '../../application/fulfillment.service';
import { ShipmentSummaryResponseDto } from '../dto/fulfillment.dto';

/** ADR-011 decision 5 — a real, searchable tracking-number lookup, not
 * just a constraint with no consumer. Deliberately its own controller
 * (not nested under `admin/orders/:orderId`, since a tracking number is
 * looked up *without* already knowing the order) — reuses
 * `order.shipment.read`, the same permission `GET .../shipments` already
 * requires. Admin-only; no customer-facing equivalent exists. */
@ApiTags('admin/shipments')
@Controller('admin/shipments')
export class ShipmentLookupAdminController {
  constructor(private readonly fulfillments: FulfillmentService) {}

  @Get('by-tracking/:trackingNumber')
  @RequirePermission('order.shipment.read')
  @ApiOkResponse({ type: ShipmentSummaryResponseDto })
  async byTrackingNumber(@Param('trackingNumber') trackingNumber: string) {
    const shipment = await this.fulfillments.findShipmentByTrackingNumber(trackingNumber);
    if (!shipment) throw new NotFoundException('No shipment found for this tracking number');
    return ShipmentSummaryResponseDto.fromDomain(shipment);
  }
}
