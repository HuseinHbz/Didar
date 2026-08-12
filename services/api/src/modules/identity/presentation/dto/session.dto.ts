import { ApiProperty } from '@nestjs/swagger';

import type { Session } from '../../domain/entities/session.entity';

export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  deviceId!: string | null;

  @ApiProperty({ nullable: true })
  userAgent!: string | null;

  @ApiProperty({ nullable: true })
  ipAddress!: string | null;

  @ApiProperty()
  expiresAt!: Date;

  @ApiProperty()
  createdAt!: Date;

  static fromDomain(session: Session): SessionResponseDto {
    const dto = new SessionResponseDto();
    dto.id = session.id;
    dto.deviceId = session.deviceId;
    dto.userAgent = session.userAgent;
    dto.ipAddress = session.ipAddress;
    dto.expiresAt = session.expiresAt;
    dto.createdAt = session.createdAt;
    return dto;
  }
}
