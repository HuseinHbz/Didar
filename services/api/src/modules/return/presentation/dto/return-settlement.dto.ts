import { ApiProperty } from '@nestjs/swagger';

import type {
  ReconciliationFinding,
  ReconciliationReport,
} from '../../application/return-reconciliation.service';
import type { ReturnSettlement } from '../../domain/entities/return-settlement.entity';

/** Admin-only view of a `ReturnSettlement` — worker/queue metadata
 * (`attempts`, `lastError`, `lastAttemptAt`) is deliberately included
 * here (this DTO is never exposed on a customer-facing route) but
 * omitted from anything a customer can reach, per ADR-013's RBAC
 * section: "customers must never see internal settlement state,
 * worker metadata, or internal failure reasons." */
export class ReturnSettlementResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) returnRequestId!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true }) restockCompletedAt!: Date | null;
  @ApiProperty({ nullable: true }) refundRequestedAt!: Date | null;
  @ApiProperty({ nullable: true }) refundRecordedAt!: Date | null;
  @ApiProperty({ nullable: true }) settledAt!: Date | null;
  @ApiProperty({ nullable: true }) completedAt!: Date | null;
  @ApiProperty() attempts!: number;
  @ApiProperty({ nullable: true }) lastError!: string | null;
  @ApiProperty({ nullable: true }) lastAttemptAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(settlement: ReturnSettlement): ReturnSettlementResponseDto {
    const dto = new ReturnSettlementResponseDto();
    dto.id = settlement.id;
    dto.returnRequestId = settlement.returnRequestId;
    dto.status = settlement.status;
    dto.restockCompletedAt = settlement.restockCompletedAt;
    dto.refundRequestedAt = settlement.refundRequestedAt;
    dto.refundRecordedAt = settlement.refundRecordedAt;
    dto.settledAt = settlement.settledAt;
    dto.completedAt = settlement.completedAt;
    dto.attempts = settlement.attempts;
    dto.lastError = settlement.lastError;
    dto.lastAttemptAt = settlement.lastAttemptAt;
    dto.createdAt = settlement.createdAt;
    dto.updatedAt = settlement.updatedAt;
    return dto;
  }
}

export class ReconciliationFindingResponseDto {
  @ApiProperty({ format: 'uuid' }) returnRequestId!: string;
  @ApiProperty({ nullable: true, format: 'uuid' }) settlementId!: string | null;
  @ApiProperty() pattern!: string;
  @ApiProperty({ required: false }) detail?: string;

  static fromDomain(finding: ReconciliationFinding): ReconciliationFindingResponseDto {
    const dto = new ReconciliationFindingResponseDto();
    dto.returnRequestId = finding.returnRequestId;
    dto.settlementId = finding.settlementId;
    dto.pattern = finding.pattern;
    dto.detail = finding.detail;
    return dto;
  }
}

export class ReconciliationReportResponseDto {
  @ApiProperty({ type: [ReconciliationFindingResponseDto] })
  findings!: ReconciliationFindingResponseDto[];
  @ApiProperty() manualReviewCount!: number;

  static fromDomain(report: ReconciliationReport): ReconciliationReportResponseDto {
    const dto = new ReconciliationReportResponseDto();
    dto.findings = report.findings.map((finding) =>
      ReconciliationFindingResponseDto.fromDomain(finding),
    );
    dto.manualReviewCount = report.manualReviewCount;
    return dto;
  }
}
