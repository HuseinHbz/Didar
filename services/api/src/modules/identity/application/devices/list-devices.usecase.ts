import type { UserId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import type { Device } from '../../domain/entities/device.entity';
import {
  DEVICE_REPOSITORY,
  type DeviceRepositoryPort,
} from '../../domain/ports/device.repository.port';

@Injectable()
export class ListDevicesUseCase {
  constructor(@Inject(DEVICE_REPOSITORY) private readonly devices: DeviceRepositoryPort) {}

  async execute(userId: UserId): Promise<Device[]> {
    return this.devices.listForUser(userId);
  }
}
