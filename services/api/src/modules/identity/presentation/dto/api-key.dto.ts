import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

import type { CreatedApiKey } from '../../application/api-keys/create-api-key.usecase';
import type { ApiKeyRecord } from '../../domain/entities/api-key.entity';

export class CreateApiKeyDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ type: [String], required: false, default: [] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];
}

export class CreatedApiKeyResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Shown exactly once — store it now, it cannot be retrieved again.' })
  rawKey!: string;

  static fromResult(result: CreatedApiKey): CreatedApiKeyResponseDto {
    const dto = new CreatedApiKeyResponseDto();
    dto.id = result.id;
    dto.rawKey = result.rawKey;
    return dto;
  }
}

export class ApiKeyResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiProperty({ nullable: true })
  lastUsedAt!: Date | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;

  static fromDomain(record: ApiKeyRecord): ApiKeyResponseDto {
    const dto = new ApiKeyResponseDto();
    dto.id = record.id;
    dto.name = record.name;
    dto.scopes = [...record.scopes];
    dto.lastUsedAt = record.lastUsedAt;
    dto.isActive = record.isActive;
    dto.createdAt = record.createdAt;
    return dto;
  }
}
