import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

import type { PaymentIntentWithDetail } from '../../domain/ports/payment-intent.repository.port';

export class CreatePaymentIntentDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() checkoutSessionId!: string;
  @ApiProperty({ example: 'zarinpal' }) @IsString() providerCode!: string;
  @ApiProperty({
    required: false,
    description:
      'Client-supplied idempotency key — a retried request with the same key returns the original intent.',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class PaymentAttemptResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() attemptNumber!: number;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true }) redirectUrl!: string | null;
  @ApiProperty() startedAt!: Date;
  @ApiProperty({ nullable: true }) returnedAt!: Date | null;
}

export class PaymentTransactionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() providerReference!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true }) verifiedAt!: Date | null;
}

export class PaymentIntentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) checkoutSessionId!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) customerId!: string | null;
  @ApiProperty({ format: 'uuid' }) providerId!: string;
  @ApiProperty() status!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() idempotencyKey!: string;
  @ApiProperty({ nullable: true }) expiresAt!: Date | null;
  @ApiProperty({ type: [PaymentAttemptResponseDto] }) attempts!: PaymentAttemptResponseDto[];
  @ApiProperty({ type: [PaymentTransactionResponseDto] })
  transactions!: PaymentTransactionResponseDto[];
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(detail: PaymentIntentWithDetail): PaymentIntentResponseDto {
    const dto = new PaymentIntentResponseDto();
    dto.id = detail.intent.id;
    dto.checkoutSessionId = detail.intent.checkoutSessionId;
    dto.customerId = detail.intent.customerId;
    dto.providerId = detail.intent.providerId;
    dto.status = detail.intent.status;
    dto.amount = detail.intent.amount.toString();
    dto.currency = detail.intent.currency;
    dto.idempotencyKey = detail.intent.idempotencyKey;
    dto.expiresAt = detail.intent.expiresAt;
    dto.attempts = detail.attempts.map((attempt) => ({
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      redirectUrl: attempt.redirectUrl,
      startedAt: attempt.startedAt,
      returnedAt: attempt.returnedAt,
    }));
    dto.transactions = detail.transactions.map((transaction) => ({
      id: transaction.id,
      providerReference: transaction.providerReference,
      amount: transaction.amount.toString(),
      currency: transaction.currency,
      status: transaction.status,
      verifiedAt: transaction.verifiedAt,
    }));
    dto.createdAt = detail.intent.createdAt;
    dto.updatedAt = detail.intent.updatedAt;
    return dto;
  }
}

export class StartPaymentResponseDto {
  @ApiProperty() redirectUrl!: string;
  @ApiProperty({ type: PaymentIntentResponseDto }) intent!: PaymentIntentResponseDto;
}
