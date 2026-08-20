import { ApiProperty } from '@nestjs/swagger';

import type { InvoiceWithItems } from '../../domain/ports/invoice.repository.port';

export class InvoiceItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() description!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPrice!: string;
  @ApiProperty() lineTotal!: string;
}

export class InvoiceResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() invoiceNumber!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty() status!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() subtotal!: string;
  @ApiProperty() discountTotal!: string;
  @ApiProperty() taxTotal!: string;
  @ApiProperty() shippingTotal!: string;
  @ApiProperty() grandTotal!: string;
  @ApiProperty({ nullable: true }) issuedAt!: Date | null;
  @ApiProperty({ nullable: true }) voidedAt!: Date | null;
  @ApiProperty({ type: [InvoiceItemResponseDto] }) items!: InvoiceItemResponseDto[];

  static fromDomain(detail: InvoiceWithItems): InvoiceResponseDto {
    const dto = new InvoiceResponseDto();
    dto.id = detail.invoice.id;
    dto.invoiceNumber = detail.invoice.invoiceNumber;
    dto.orderId = detail.invoice.orderId;
    dto.status = detail.invoice.status;
    dto.currency = detail.invoice.currency;
    dto.subtotal = detail.invoice.subtotal.toString();
    dto.discountTotal = detail.invoice.discountTotal.toString();
    dto.taxTotal = detail.invoice.taxTotal.toString();
    dto.shippingTotal = detail.invoice.shippingTotal.toString();
    dto.grandTotal = detail.invoice.grandTotal.toString();
    dto.issuedAt = detail.invoice.issuedAt;
    dto.voidedAt = detail.invoice.voidedAt;
    dto.items = detail.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toString(),
      lineTotal: item.lineTotal.toString(),
    }));
    return dto;
  }
}
