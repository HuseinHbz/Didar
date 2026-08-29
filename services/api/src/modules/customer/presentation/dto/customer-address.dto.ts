import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import type { CustomerAddress } from '../../domain/entities/customer-address.entity';

export class CreateCustomerAddressDto {
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() @MaxLength(50) label?: string | null;
  @ApiProperty() @IsString() @MaxLength(150) recipientName!: string;
  @ApiProperty() @IsString() @MaxLength(20) phone!: string;
  @ApiProperty() @IsString() @MaxLength(100) province!: string;
  @ApiProperty() @IsString() @MaxLength(100) city!: string;
  @ApiProperty() @IsString() @MaxLength(255) addressLine1!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;
  /** Advisory only — see `PrismaCustomerAddressRepository.create()`: the
   * first address a customer ever creates is always default regardless
   * of what's sent here. */
  @ApiProperty({ required: false, default: false }) @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateCustomerAddressDto {
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() @MaxLength(50) label?: string | null;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(150) recipientName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(100) province?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(255) addressLine1?: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string | null;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;
}

export class CustomerAddressResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true }) label!: string | null;
  @ApiProperty() recipientName!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() province!: string;
  @ApiProperty() city!: string;
  @ApiProperty() addressLine1!: string;
  @ApiProperty({ nullable: true }) addressLine2!: string | null;
  @ApiProperty({ nullable: true }) postalCode!: string | null;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(address: CustomerAddress): CustomerAddressResponseDto {
    const dto = new CustomerAddressResponseDto();
    dto.id = address.id;
    dto.label = address.label;
    dto.recipientName = address.recipientName;
    dto.phone = address.phone;
    dto.province = address.province;
    dto.city = address.city;
    dto.addressLine1 = address.addressLine1;
    dto.addressLine2 = address.addressLine2;
    dto.postalCode = address.postalCode;
    dto.isDefault = address.isDefault;
    dto.createdAt = address.createdAt;
    dto.updatedAt = address.updatedAt;
    return dto;
  }
}
