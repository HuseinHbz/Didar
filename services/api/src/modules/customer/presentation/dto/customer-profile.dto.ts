import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import type { Customer } from '../../domain/entities/customer.entity';

export class UpdateCustomerProfileDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsDateString()
  birthDate?: string | null;
  @ApiProperty({ required: false, nullable: true, enum: ['MALE', 'FEMALE', 'OTHER'] })
  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
}

export class CustomerProfileResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  /** Deliberately excluded: `nationalId` is identity data, not a
   * "profile" field a self-service caller is meant to read/write back
   * through this route — see `CustomerProfileService.updateMe()`'s own
   * doc comment. */
  @ApiProperty({ nullable: true }) birthDate!: Date | null;
  @ApiProperty({ nullable: true, enum: ['MALE', 'FEMALE', 'OTHER'] }) gender!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(customer: Customer): CustomerProfileResponseDto {
    const dto = new CustomerProfileResponseDto();
    dto.id = customer.id;
    dto.firstName = customer.firstName;
    dto.lastName = customer.lastName;
    dto.birthDate = customer.birthDate;
    dto.gender = customer.gender;
    dto.createdAt = customer.createdAt;
    dto.updatedAt = customer.updatedAt;
    return dto;
  }
}
