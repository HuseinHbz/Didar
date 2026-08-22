import type { SupplierStatus } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import type { Supplier } from '../../domain/entities/supplier.entity';

import { PaginationQueryDto } from './pagination.dto';

const STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export class SupplierResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) contactName!: string | null;
  @ApiProperty({ nullable: true }) contactEmail!: string | null;
  @ApiProperty({ nullable: true }) contactPhone!: string | null;
  @ApiProperty({ nullable: true }) address!: string | null;
  @ApiProperty({ enum: STATUSES }) status!: SupplierStatus;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(supplier: Supplier): SupplierResponseDto {
    const dto = new SupplierResponseDto();
    dto.id = supplier.id;
    dto.code = supplier.code;
    dto.name = supplier.name;
    dto.contactName = supplier.contactName;
    dto.contactEmail = supplier.contactEmail;
    dto.contactPhone = supplier.contactPhone;
    dto.address = supplier.address;
    dto.status = supplier.status;
    dto.createdAt = supplier.createdAt;
    dto.updatedAt = supplier.updatedAt;
    return dto;
  }
}

export class SupplierPageResponseDto {
  @ApiProperty({ type: [SupplierResponseDto] }) items!: SupplierResponseDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;

  static fromResult(result: {
    items: Supplier[];
    nextCursor: string | null;
  }): SupplierPageResponseDto {
    const dto = new SupplierPageResponseDto();
    dto.items = result.items.map((item) => SupplierResponseDto.fromDomain(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}

export class ListSuppliersQueryDto extends PaginationQueryDto {
  @ApiProperty({ required: false, enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: SupplierStatus;
}

export class CreateSupplierDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  contactName?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsEmail()
  contactEmail?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  contactPhone?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  address?: string | null;
}

export class UpdateSupplierDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  contactName?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsEmail()
  contactEmail?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  contactPhone?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  address?: string | null;
  @ApiProperty({ required: false, enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: SupplierStatus;
}
