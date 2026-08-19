import { Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { InvoiceService } from '../../application/invoice.service';
import { OrderService } from '../../application/order.service';
import { InvoiceResponseDto } from '../dto/invoice.dto';

/** Admin invoice routes (ADR-009 decision 7) — `order.invoice.*`
 * permissions. Issuance itself is automatic (`OrderConversionService`);
 * the `POST .../invoice` route here is the same "manual trigger for
 * support" pattern `ReconciliationController`'s manual run establishes,
 * useful if the `invoice_generation` sweep hasn't caught a gap yet. */
@ApiTags('admin/orders')
@Controller('admin/orders/:orderId/invoice')
export class InvoiceAdminController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly orders: OrderService,
  ) {}

  @Get()
  @RequirePermission('order.invoice.read')
  @ApiOkResponse({ type: InvoiceResponseDto })
  async get(@Param('orderId') orderId: string) {
    const detail = await this.invoices.getByOrderId(orderId);
    if (!detail) throw new NotFoundException('Invoice not found for this order');
    return InvoiceResponseDto.fromDomain(detail);
  }

  @Post()
  @RequirePermission('order.invoice.create')
  @ApiOkResponse({ type: InvoiceResponseDto })
  async issue(@Param('orderId') orderId: string) {
    const orderDetail = await this.orders.getForAdmin(orderId);
    const invoice = await this.invoices.issueForOrder({
      orderId,
      customerId: orderDetail.order.customerId,
      currency: orderDetail.order.currency,
      subtotal: orderDetail.order.subtotal,
      discountTotal: orderDetail.order.discountTotal,
      taxTotal: orderDetail.order.taxTotal,
      shippingTotal: orderDetail.order.shippingTotal,
      grandTotal: orderDetail.order.grandTotal,
      items: orderDetail.items.map((item) => ({
        description: item.nameSnapshot,
        quantity: item.quantity,
        unitPrice: item.unitPriceSnapshot,
        lineTotal: item.lineTotal,
      })),
    });
    const detail = await this.invoices.get(invoice.id);
    return InvoiceResponseDto.fromDomain(detail);
  }

  @Post('void')
  @RequirePermission('order.invoice.void')
  @ApiOkResponse({ type: InvoiceResponseDto })
  async voidInvoice(@Param('orderId') orderId: string) {
    const existing = await this.invoices.getByOrderId(orderId);
    if (!existing) throw new NotFoundException('Invoice not found for this order');
    await this.invoices.void(existing.invoice.id);
    const detail = await this.invoices.get(existing.invoice.id);
    return InvoiceResponseDto.fromDomain(detail);
  }
}
