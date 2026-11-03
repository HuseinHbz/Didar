import { REFUND_STATUSES, type RefundStatus } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, IsUUID, Max, Min } from 'class-validator';

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

/** `GET /admin/payments/refunds` — at least one of the three filters is
 * required (enforced by `RefundService.list`, which returns nothing otherwise). */
export class ListRefundsQueryDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  paymentTransactionId?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  returnRequestId?: string;

  @ApiProperty({
    required: false,
    enum: REFUND_STATUSES,
    description:
      'REJECTED lists refunds the system could not settle by itself (see failureReason) — ' +
      'finance settles those manually.',
  })
  @IsOptional()
  @IsIn(REFUND_STATUSES)
  status?: RefundStatus;

  @ApiProperty({ required: false, minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class RefundResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) paymentTransactionId!: string;
  @ApiProperty() amount!: string;
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) requestedBy!: string | null;
  @ApiProperty({ nullable: true }) providerRefundReference!: string | null;
  @ApiProperty({
    nullable: true,
    description:
      'Why the refund ended REJECTED or FAILED (for example the payment provider cannot ' +
      'refund a partial amount, so nothing was sent). Null for every other status.',
  })
  failureReason!: string | null;
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
    dto.failureReason = refund.failureReason;
    dto.createdAt = refund.createdAt;
    dto.updatedAt = refund.updatedAt;
    return dto;
  }
}
