import { asUserId } from '@iecp/types';
import { Controller, Get, Param, ParseUUIDPipe, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';

import { GetUserByIdUseCase } from '../../application/users/get-user-by-id.usecase';
import { FieldPermissions } from '../decorators/field-permissions.decorator';
import { UserResponseDto } from '../dto/user-response.dto';
import { FieldPermissionInterceptor } from '../interceptors/field-permission.interceptor';

/**
 * Presentation layer: HTTP-specific concerns only (routing, param parsing,
 * OpenAPI annotations, DTO mapping). No business logic — that's application/.
 */
@ApiTags('identity')
@Controller('users')
export class IdentityController {
  constructor(private readonly getUserById: GetUserByIdUseCase) {}

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserResponseDto })
  @UseInterceptors(FieldPermissionInterceptor)
  @FieldPermissions([
    { field: 'phone', permissionKey: 'identity.users.view_contact' },
    { field: 'email', permissionKey: 'identity.users.view_contact' },
  ])
  async findById(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    const user = await this.getUserById.execute(asUserId(id));
    return UserResponseDto.fromDomain(user);
  }
}
