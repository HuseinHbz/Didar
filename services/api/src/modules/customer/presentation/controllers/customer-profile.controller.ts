import type { UserId } from '@iecp/types';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { CustomerProfileService } from '../../application/profile/customer-profile.service';
import { CustomerProfileResponseDto, UpdateCustomerProfileDto } from '../dto/customer-profile.dto';

/** `GET/PATCH /me/profile` — same authenticated-only, no-RBAC-decorator
 * shape `SessionsController` (`me/sessions`) establishes: ownership is
 * intrinsic to "the current user", enforced by `CurrentUserId` deriving
 * from the verified JWT, never a route param. */
@ApiTags('customer')
@Controller('me/profile')
export class CustomerProfileController {
  constructor(private readonly profile: CustomerProfileService) {}

  @Get()
  @ApiOkResponse({ type: CustomerProfileResponseDto })
  async getMe(@CurrentUserId() userId: UserId): Promise<CustomerProfileResponseDto> {
    const customer = await this.profile.getMe(userId);
    return CustomerProfileResponseDto.fromDomain(customer);
  }

  @Patch()
  @ApiOkResponse({ type: CustomerProfileResponseDto })
  async updateMe(
    @CurrentUserId() userId: UserId,
    @Body() dto: UpdateCustomerProfileDto,
  ): Promise<CustomerProfileResponseDto> {
    const updated = await this.profile.updateMe(userId, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      birthDate: dto.birthDate === undefined ? undefined : dto.birthDate === null ? null : new Date(dto.birthDate),
      gender: dto.gender,
    });
    return CustomerProfileResponseDto.fromDomain(updated);
  }
}
