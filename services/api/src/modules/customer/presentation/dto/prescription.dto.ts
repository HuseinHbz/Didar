import { centiToDiopter, PRESCRIPTION_BOUNDS } from '@iecp/validation';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

import type { Prescription } from '../../domain/entities/prescription.entity';

/** Bounds are enforced authoritatively by `EyeMeasurementValidator`
 * (`@iecp/validation`'s `eyeMeasurementSchema` — step/axis-requires-cyl
 * included); the `@Min`/`@Max` here are a fast, documented rejection at
 * the DTO boundary for the common case, not a second source of truth —
 * both read `PRESCRIPTION_BOUNDS`. */
export class EyeMeasurementDto {
  @ApiProperty({ minimum: PRESCRIPTION_BOUNDS.sph.min, maximum: PRESCRIPTION_BOUNDS.sph.max })
  @IsNumber()
  @Min(PRESCRIPTION_BOUNDS.sph.min)
  @Max(PRESCRIPTION_BOUNDS.sph.max)
  sph!: number;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(PRESCRIPTION_BOUNDS.cyl.min)
  @Max(PRESCRIPTION_BOUNDS.cyl.max)
  cyl?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(PRESCRIPTION_BOUNDS.axis.min)
  @Max(PRESCRIPTION_BOUNDS.axis.max)
  axis?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(PRESCRIPTION_BOUNDS.add.min)
  @Max(PRESCRIPTION_BOUNDS.add.max)
  add?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(PRESCRIPTION_BOUNDS.pd.min)
  @Max(PRESCRIPTION_BOUNDS.pd.max)
  pd?: number | null;
}

export class CreatePrescriptionDto {
  @ApiProperty({ type: EyeMeasurementDto }) @ValidateNested() @Type(() => EyeMeasurementDto) rightEye!: EyeMeasurementDto;
  @ApiProperty({ type: EyeMeasurementDto }) @ValidateNested() @Type(() => EyeMeasurementDto) leftEye!: EyeMeasurementDto;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsDateString() issuedAt?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsDateString() expiresAt?: string | null;
}

export class RejectPrescriptionDto {
  @ApiProperty() @IsString() @MaxLength(1000) reason!: string;
}

export class EyeMeasurementResponseDto {
  @ApiProperty() sph!: number;
  @ApiProperty({ nullable: true }) cyl!: number | null;
  @ApiProperty({ nullable: true }) axis!: number | null;
  @ApiProperty({ nullable: true }) add!: number | null;
  @ApiProperty({ nullable: true }) pd!: number | null;
}

export class PrescriptionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) rootId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ nullable: true, format: 'uuid' }) previousVersionId!: string | null;
  @ApiProperty({ enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED'] })
  status!: string;
  @ApiProperty({ type: EyeMeasurementResponseDto }) rightEye!: EyeMeasurementResponseDto;
  @ApiProperty({ type: EyeMeasurementResponseDto }) leftEye!: EyeMeasurementResponseDto;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty({ nullable: true }) issuedAt!: Date | null;
  @ApiProperty({ nullable: true }) expiresAt!: Date | null;
  @ApiProperty({ nullable: true }) submittedAt!: Date | null;
  @ApiProperty({ nullable: true }) reviewStartedAt!: Date | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) reviewedByUserId!: string | null;
  @ApiProperty({ nullable: true }) reviewedAt!: Date | null;
  @ApiProperty({ nullable: true }) rejectionReason!: string | null;
  @ApiProperty({ nullable: true }) supersededAt!: Date | null;
  /** `CLINICAL_APPROVAL_STATUS` — always `'PENDING'` in this codebase
   * today (see `@iecp/validation`'s `prescription.ts` header). Surfaced
   * on every response so no client can mistake `status: 'APPROVED'`
   * (workflow approval by a reviewer) for a clinically reviewed bounds
   * spec — the two are unrelated. */
  @ApiProperty() clinicalApprovalStatus!: 'PENDING';
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(prescription: Prescription): PrescriptionResponseDto {
    const dto = new PrescriptionResponseDto();
    dto.id = prescription.id;
    dto.rootId = prescription.rootId;
    dto.version = prescription.version;
    dto.previousVersionId = prescription.previousVersionId;
    dto.status = prescription.status;
    dto.rightEye = toEyeResponse(prescription.rightEye);
    dto.leftEye = toEyeResponse(prescription.leftEye);
    dto.notes = prescription.notes;
    dto.issuedAt = prescription.issuedAt;
    dto.expiresAt = prescription.expiresAt;
    dto.submittedAt = prescription.submittedAt;
    dto.reviewStartedAt = prescription.reviewStartedAt;
    dto.reviewedByUserId = prescription.reviewedByUserId;
    dto.reviewedAt = prescription.reviewedAt;
    dto.rejectionReason = prescription.rejectionReason;
    dto.supersededAt = prescription.supersededAt;
    dto.clinicalApprovalStatus = 'PENDING';
    dto.createdAt = prescription.createdAt;
    dto.updatedAt = prescription.updatedAt;
    return dto;
  }
}

function toEyeResponse(eye: Prescription['rightEye']): EyeMeasurementResponseDto {
  const dto = new EyeMeasurementResponseDto();
  dto.sph = centiToDiopter(eye.sph);
  dto.cyl = eye.cyl === null ? null : centiToDiopter(eye.cyl);
  dto.axis = eye.axis;
  dto.add = eye.add === null ? null : centiToDiopter(eye.add);
  dto.pd = eye.pd === null ? null : centiToDiopter(eye.pd);
  return dto;
}
