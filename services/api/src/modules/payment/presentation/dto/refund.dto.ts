import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

import type { Refund } from '../../domain/entities/refund.entity';

export class CreateRefundDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() paymentTransactionId!: string;
  @ApiProperty({ description: 'Rial amount, as a positive integer.' })
  @IsInt()
  @IsPositive()
  amount!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() reason?: string;
  @ApiProperty({
    description:
      'Client-supplied idempotency key — a retried request with the same key returns the original refund.',
  })
  @IsString()
  idempotencyKey!: string;
}

export class RefundResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) paymentTransactionId!: string;
  @ApiProperty() amount!: string;
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) requestedBy!: string | null;
  @ApiProperty({ nullable: true }) providerRefundReference!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(refund: Refund): RefundResponseDto {
    const dto = new RefundResponseDto();
    dto.id = refund.id;
    dto.paymentTransactionId = refund.paymentTransactionId;
    dto.amount = refund.amount.toString();
    dto.reason = refund.reason;
    dto.status = refund.status;
    dto.requestedBy = refund.requestedBy;
    dto.providerRefundReference = refund.providerRefundReference;
    dto.createdAt = refund.createdAt;
    dto.updatedAt = refund.updatedAt;
    return dto;
  }
}
