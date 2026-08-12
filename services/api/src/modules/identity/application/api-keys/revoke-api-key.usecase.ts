import type { ApiKeyId, UserId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  API_KEY_REPOSITORY,
  type ApiKeyRepositoryPort,
} from '../../domain/ports/api-key.repository.port';
import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';

@Injectable()
export class RevokeApiKeyUseCase {
  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
  ) {}

  async execute(callerUserId: UserId, apiKeyId: ApiKeyId): Promise<void> {
    const record = await this.apiKeys.findById(apiKeyId);
    if (record?.ownerId !== callerUserId) {
      throw new NotFoundException('API key not found');
    }
    await this.apiKeys.revoke(apiKeyId, new Date());
    await this.securityEvents.record({ userId: callerUserId, type: 'API_KEY_REVOKED' });
  }
}
