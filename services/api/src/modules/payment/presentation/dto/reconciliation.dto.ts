import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

import type { ReconciliationRecord } from '../../domain/entities/reconciliation-record.entity';

export class ResolveReconciliationDto {
  @ApiProperty() @IsString() @MinLength(1) resolutionNote!: string;
}

export class ReconciliationRecordResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) providerId!: string;
  @ApiProperty() transactionDate!: Date;
  @ApiProperty({ nullable: true, format: 'uuid' }) paymentTransactionId!: string | null;
  @ApiProperty() providerReference!: string;
  @ApiProperty({ nullable: true }) localAmount!: string | null;
  @ApiProperty({ nullable: true }) remoteAmount!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true }) resolvedAt!: Date | null;
  @ApiProperty({ nullable: true }) resolutionNote!: string | null;
  @ApiProperty() createdAt!: Date;

  static fromDomain(record: ReconciliationRecord): ReconciliationRecordResponseDto {
    const dto = new ReconciliationRecordResponseDto();
    dto.id = record.id;
    dto.providerId = record.providerId;
    dto.transactionDate = record.transactionDate;
    dto.paymentTransactionId = record.paymentTransactionId;
    dto.providerReference = record.providerReference;
    dto.localAmount = record.localAmount?.toString() ?? null;
    dto.remoteAmount = record.remoteAmount?.toString() ?? null;
    dto.status = record.status;
    dto.resolvedAt = record.resolvedAt;
    dto.resolutionNote = record.resolutionNote;
    dto.createdAt = record.createdAt;
    return dto;
  }
}
