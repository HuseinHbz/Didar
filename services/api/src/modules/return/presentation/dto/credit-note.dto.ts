import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import type { CreditNoteWithLines } from '../../domain/ports/credit-note.repository.port';

export class CreditNoteLineResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() description!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPrice!: string;
  @ApiProperty() lineTotal!: string;
}

export class CreditNoteResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() creditNoteNumber!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) returnRequestId!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) invoiceId!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) customerId!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() subtotal!: string;
  @ApiProperty() discountTotal!: string;
  @ApiProperty() taxTotal!: string;
  @ApiProperty() grandTotal!: string;
  @ApiProperty({ nullable: true }) issuedAt!: Date | null;
  @ApiProperty({ nullable: true }) appliedAt!: Date | null;
  @ApiProperty({ nullable: true }) voidedAt!: Date | null;
  @ApiProperty({ type: [CreditNoteLineResponseDto] }) lines!: CreditNoteLineResponseDto[];
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(detail: CreditNoteWithLines): CreditNoteResponseDto {
    const dto = new CreditNoteResponseDto();
    dto.id = detail.creditNote.id;
    dto.creditNoteNumber = detail.creditNote.creditNoteNumber;
    dto.orderId = detail.creditNote.orderId;
    dto.returnRequestId = detail.creditNote.returnRequestId;
    dto.invoiceId = detail.creditNote.invoiceId;
    dto.customerId = detail.creditNote.customerId;
    dto.status = detail.creditNote.status;
    dto.currency = detail.creditNote.currency;
    dto.subtotal = detail.creditNote.subtotal.toString();
    dto.discountTotal = detail.creditNote.discountTotal.toString();
    dto.taxTotal = detail.creditNote.taxTotal.toString();
    dto.grandTotal = detail.creditNote.grandTotal.toString();
    dto.issuedAt = detail.creditNote.issuedAt;
    dto.appliedAt = detail.creditNote.appliedAt;
    dto.voidedAt = detail.creditNote.voidedAt;
    dto.createdAt = detail.creditNote.createdAt;
    dto.updatedAt = detail.creditNote.updatedAt;
    dto.lines = detail.lines.map((line) => {
      const lineDto = new CreditNoteLineResponseDto();
      lineDto.id = line.id;
      lineDto.description = line.description;
      lineDto.quantity = line.quantity;
      lineDto.unitPrice = line.unitPrice.toString();
      lineDto.lineTotal = line.lineTotal.toString();
      return lineDto;
    });
    return dto;
  }
}

export class VoidCreditNoteDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() reason?: string;
}
