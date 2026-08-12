import type { LocationType, WarehouseStatus, WarehouseType } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

import type { WarehouseLocation } from '../../domain/entities/warehouse-location.entity';
import type { Warehouse } from '../../domain/entities/warehouse.entity';

import { PaginationQueryDto } from './pagination.dto';

const WAREHOUSE_TYPES = ['CENTRAL', 'REGIONAL', 'STORE', 'DARK_STORE', 'QUARANTINE'] as const;
const WAREHOUSE_STATUSES = ['ACTIVE', 'INACTIVE', 'CLOSED'] as const;
const LOCATION_TYPES = [
  'RECEIVING',
  'PICKING',
  'STORAGE',
  'QUARANTINE',
  'DAMAGED',
  'RETURNS',
  'STAGING',
] as const;

export class WarehouseResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: WAREHOUSE_TYPES }) type!: WarehouseType;
  @ApiProperty({ enum: WAREHOUSE_STATUSES }) status!: WarehouseStatus;
  @ApiProperty({ nullable: true }) address!: string | null;
  @ApiProperty() timezone!: string;
  @ApiProperty({ nullable: true }) capacity!: number | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(warehouse: Warehouse): WarehouseResponseDto {
    const dto = new WarehouseResponseDto();
    dto.id = warehouse.id;
    dto.code = warehouse.code;
    dto.name = warehouse.name;
    dto.type = warehouse.type;
    dto.status = warehouse.status;
    dto.address = warehouse.address;
    dto.timezone = warehouse.timezone;
    dto.capacity = warehouse.capacity;
    dto.createdAt = warehouse.createdAt;
    dto.updatedAt = warehouse.updatedAt;
    return dto;
  }
}

export class WarehousePageResponseDto {
  @ApiProperty({ type: [WarehouseResponseDto] }) items!: WarehouseResponseDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;

  static fromResult(result: {
    items: Warehouse[];
    nextCursor: string | null;
  }): WarehousePageResponseDto {
    const dto = new WarehousePageResponseDto();
    dto.items = result.items.map((item) => WarehouseResponseDto.fromDomain(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}

export class CreateWarehouseDto {
  @ApiProperty() @IsString() @MinLength(1) code!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiProperty({ required: false, enum: WAREHOUSE_TYPES })
  @IsOptional()
  @IsIn(WAREHOUSE_TYPES)
  type?: WarehouseType;
  @ApiProperty({ required: false, enum: WAREHOUSE_STATUSES })
  @IsOptional()
  @IsIn(WAREHOUSE_STATUSES)
  status?: WarehouseStatus;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() address?:
    string | null;
  @ApiProperty({ required: false }) @IsOptional() @IsString() timezone?: string;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() @Min(0) capacity?:
    number | null;
}

export class UpdateWarehouseDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MinLength(1) name?: string;
  @ApiProperty({ required: false, enum: WAREHOUSE_TYPES })
  @IsOptional()
  @IsIn(WAREHOUSE_TYPES)
  type?: WarehouseType;
  @ApiProperty({ required: false, enum: WAREHOUSE_STATUSES })
  @IsOptional()
  @IsIn(WAREHOUSE_STATUSES)
  status?: WarehouseStatus;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() address?:
    string | null;
  @ApiProperty({ required: false }) @IsOptional() @IsString() timezone?: string;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsInt() @Min(0) capacity?:
    number | null;
}

export class ListWarehousesQueryDto extends PaginationQueryDto {
  @ApiProperty({ required: false, enum: WAREHOUSE_TYPES })
  @IsOptional()
  @IsIn(WAREHOUSE_TYPES)
  type?: WarehouseType;
  @ApiProperty({ required: false, enum: WAREHOUSE_STATUSES })
  @IsOptional()
  @IsIn(WAREHOUSE_STATUSES)
  status?: WarehouseStatus;
}

export class WarehouseLocationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: LOCATION_TYPES }) type!: LocationType;
  @ApiProperty() active!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(location: WarehouseLocation): WarehouseLocationResponseDto {
    const dto = new WarehouseLocationResponseDto();
    dto.id = location.id;
    dto.warehouseId = location.warehouseId;
    dto.code = location.code;
    dto.name = location.name;
    dto.type = location.type;
    dto.active = location.active;
    dto.createdAt = location.createdAt;
    dto.updatedAt = location.updatedAt;
    return dto;
  }
}

export class CreateLocationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() warehouseId!: string;
  @ApiProperty() @IsString() @MinLength(1) code!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiProperty({ required: false, enum: LOCATION_TYPES })
  @IsOptional()
  @IsIn(LOCATION_TYPES)
  type?: LocationType;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;
}
