import type { UserId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import type { ApiKeyRecord } from '../../domain/entities/api-key.entity';
import {
  API_KEY_REPOSITORY,
  type ApiKeyRepositoryPort,
} from '../../domain/ports/api-key.repository.port';

@Injectable()
export class ListApiKeysUseCase {
  constructor(@Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepositoryPort) {}

  async execute(ownerId: UserId): Promise<ApiKeyRecord[]> {
    return this.apiKeys.listForOwner(ownerId);
  }
}
