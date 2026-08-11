import { asUserId } from '@iecp/types';
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';

import { GetUserByIdUseCase } from '../application/get-user-by-id.usecase';

import { UserResponseDto } from './dto/user-response.dto';

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
  async findById(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    const user = await this.getUserById.execute(asUserId(id));
    return UserResponseDto.fromDomain(user);
  }
}
