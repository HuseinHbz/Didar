import type { PermissionEffect } from '@iecp/types';
import { PERMISSION_EFFECTS } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

import type { PermissionOverride } from '../../domain/entities/permission-override.entity';
import type { Permission } from '../../domain/entities/permission.entity';

export class PermissionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  module!: string;

  @ApiProperty()
  action!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  static fromDomain(permission: Permission): PermissionResponseDto {
    const dto = new PermissionResponseDto();
    dto.id = permission.id;
    dto.module = permission.module;
    dto.action = permission.action;
    dto.key = permission.key;
    dto.description = permission.description;
    return dto;
  }
}

export class EffectivePermissionsResponseDto {
  @ApiProperty({ type: [String] })
  permissions!: string[];

  static fromSet(permissions: Set<string>): EffectivePermissionsResponseDto {
    const dto = new EffectivePermissionsResponseDto();
    dto.permissions = [...permissions].sort();
    return dto;
  }
}

export class SetPermissionOverrideDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  permissionId!: string;

  @ApiProperty({ enum: PERMISSION_EFFECTS })
  @IsIn(PERMISSION_EFFECTS)
  effect!: PermissionEffect;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  reason?: string | null;
}

export class PermissionOverrideResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  permissionKey!: string;

  @ApiProperty({ enum: PERMISSION_EFFECTS })
  effect!: PermissionEffect;

  @ApiProperty({ nullable: true })
  reason!: string | null;

  static fromDomain(override: PermissionOverride): PermissionOverrideResponseDto {
    const dto = new PermissionOverrideResponseDto();
    dto.id = override.id;
    dto.permissionKey = override.permissionKey;
    dto.effect = override.effect;
    dto.reason = override.reason;
    return dto;
  }
}
