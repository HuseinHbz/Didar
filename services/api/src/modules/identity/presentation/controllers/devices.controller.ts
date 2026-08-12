import { asDeviceId, type UserId } from '@iecp/types';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { ListDevicesUseCase } from '../../application/devices/list-devices.usecase';
import { RevokeDeviceUseCase } from '../../application/devices/revoke-device.usecase';
import { TrustDeviceUseCase } from '../../application/devices/trust-device.usecase';
import { CurrentUserId } from '../decorators/current-user.decorator';
import { DeviceResponseDto } from '../dto/device.dto';

/** blueprint §56 "Device Trust" — always the caller's own devices. */
@ApiTags('devices')
@Controller('me/devices')
export class DevicesController {
  constructor(
    private readonly listDevices: ListDevicesUseCase,
    private readonly trustDevice: TrustDeviceUseCase,
    private readonly revokeDevice: RevokeDeviceUseCase,
  ) {}

  @Get()
  @ApiOkResponse({ type: [DeviceResponseDto] })
  async list(@CurrentUserId() userId: UserId): Promise<DeviceResponseDto[]> {
    const devices = await this.listDevices.execute(userId);
    return devices.map((device) => DeviceResponseDto.fromDomain(device));
  }

  @Post(':id/trust')
  @HttpCode(HttpStatus.NO_CONTENT)
  async trust(
    @CurrentUserId() userId: UserId,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.trustDevice.execute(userId, asDeviceId(id));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentUserId() userId: UserId,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.revokeDevice.execute(userId, asDeviceId(id));
  }
}
