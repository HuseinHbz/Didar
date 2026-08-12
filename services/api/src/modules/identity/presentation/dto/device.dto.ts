import { ApiProperty } from '@nestjs/swagger';

import type { Device } from '../../domain/entities/device.entity';

export class DeviceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true })
  label!: string | null;

  @ApiProperty({ nullable: true })
  platform!: string | null;

  @ApiProperty()
  isTrusted!: boolean;

  @ApiProperty()
  lastSeenAt!: Date;

  static fromDomain(device: Device): DeviceResponseDto {
    const dto = new DeviceResponseDto();
    dto.id = device.id;
    dto.label = device.label;
    dto.platform = device.platform;
    dto.isTrusted = device.isTrusted;
    dto.lastSeenAt = device.lastSeenAt;
    return dto;
  }
}
