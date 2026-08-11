import { ApiProperty } from '@nestjs/swagger';

import type { User } from '../../domain/user.entity';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '+989121234567' })
  phone!: string;

  @ApiProperty()
  createdAt!: Date;

  static fromDomain(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.phone = user.phone;
    dto.createdAt = user.createdAt;
    return dto;
  }
}
