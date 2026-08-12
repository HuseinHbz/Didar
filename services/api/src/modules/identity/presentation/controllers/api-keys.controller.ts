import { asApiKeyId, type UserId } from '@iecp/types';
import {
  Body,
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

import { CreateApiKeyUseCase } from '../../application/api-keys/create-api-key.usecase';
import { ListApiKeysUseCase } from '../../application/api-keys/list-api-keys.usecase';
import { RevokeApiKeyUseCase } from '../../application/api-keys/revoke-api-key.usecase';
import { CurrentUserId } from '../decorators/current-user.decorator';
import { ApiKeyResponseDto, CreateApiKeyDto, CreatedApiKeyResponseDto } from '../dto/api-key.dto';

/**
 * blueprint §55 "API Keys" — management only (issue/list/revoke). Using an
 * API key to *authenticate* a request is deliberately out of scope for this
 * pass: nothing in this codebase yet needs service-to-service auth, so
 * building that verification path now would be speculative. See
 * identity/README.md.
 */
@ApiTags('api-keys')
@Controller('me/api-keys')
export class ApiKeysController {
  constructor(
    private readonly createApiKey: CreateApiKeyUseCase,
    private readonly listApiKeys: ListApiKeysUseCase,
    private readonly revokeApiKey: RevokeApiKeyUseCase,
  ) {}

  @Get()
  @ApiOkResponse({ type: [ApiKeyResponseDto] })
  async list(@CurrentUserId() userId: UserId): Promise<ApiKeyResponseDto[]> {
    const keys = await this.listApiKeys.execute(userId);
    return keys.map((key) => ApiKeyResponseDto.fromDomain(key));
  }

  @Post()
  @ApiOkResponse({ type: CreatedApiKeyResponseDto })
  async create(
    @CurrentUserId() userId: UserId,
    @Body() dto: CreateApiKeyDto,
  ): Promise<CreatedApiKeyResponseDto> {
    const created = await this.createApiKey.execute({
      name: dto.name,
      ownerId: userId,
      scopes: dto.scopes ?? [],
    });
    return CreatedApiKeyResponseDto.fromResult(created);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentUserId() userId: UserId,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.revokeApiKey.execute(userId, asApiKeyId(id));
  }
}
