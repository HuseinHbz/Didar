import type { DeviceId, UserId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  DEVICE_REPOSITORY,
  type DeviceRepositoryPort,
} from '../../domain/ports/device.repository.port';

/** blueprint §56 "Device Trust" — an explicit, separate action from just
 * having logged in from a device; see Device.isTrusted. */
@Injectable()
export class TrustDeviceUseCase {
  constructor(@Inject(DEVICE_REPOSITORY) private readonly devices: DeviceRepositoryPort) {}

  async execute(callerUserId: UserId, deviceId: DeviceId): Promise<void> {
    const device = await this.devices.findById(deviceId);
    if (device?.userId !== callerUserId) {
      throw new NotFoundException('Device not found');
    }
    await this.devices.trust(deviceId, new Date());
  }
}
