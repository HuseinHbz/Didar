import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

import type { AuditLogEntry } from '../../domain/entities/audit-log-entry.entity';

export class ListAuditLogQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class AuditLogEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true })
  actorId!: string | null;

  @ApiProperty({ nullable: true })
  actorIp!: string | null;

  @ApiProperty({ nullable: true })
  actorDevice!: string | null;

  @ApiProperty()
  action!: string;

  @ApiProperty()
  entityType!: string;

  @ApiProperty()
  entityId!: string;

  @ApiProperty({ nullable: true })
  oldValue!: unknown;

  @ApiProperty({ nullable: true })
  newValue!: unknown;

  @ApiProperty()
  createdAt!: Date;

  static fromDomain(entry: AuditLogEntry): AuditLogEntryResponseDto {
    const dto = new AuditLogEntryResponseDto();
    dto.id = entry.id;
    dto.actorId = entry.actorId;
    dto.actorIp = entry.actorIp;
    dto.actorDevice = entry.actorDevice;
    dto.action = entry.action;
    dto.entityType = entry.entityType;
    dto.entityId = entry.entityId;
    dto.oldValue = entry.oldValue;
    dto.newValue = entry.newValue;
    dto.createdAt = entry.createdAt;
    return dto;
  }
}

export class AuditLogPageResponseDto {
  @ApiProperty({ type: [AuditLogEntryResponseDto] })
  items!: AuditLogEntryResponseDto[];

  @ApiProperty({ nullable: true })
  nextCursor!: string | null;

  static fromResult(result: {
    items: AuditLogEntry[];
    nextCursor: string | null;
  }): AuditLogPageResponseDto {
    const dto = new AuditLogPageResponseDto();
    dto.items = result.items.map((item) => AuditLogEntryResponseDto.fromDomain(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}
