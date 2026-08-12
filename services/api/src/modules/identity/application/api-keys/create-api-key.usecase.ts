import type { UserId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import {
  API_KEY_REPOSITORY,
  type ApiKeyRepositoryPort,
} from '../../domain/ports/api-key.repository.port';
import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import { ApiKeyGeneratorService } from '../../infrastructure/crypto/api-key-generator.service';

export interface CreatedApiKey {
  id: string;
  /** Shown exactly once — only `keyHash` is ever persisted (see
   * ApiKeyRepositoryPort / infrastructure/crypto/api-key-generator.service.ts). */
  rawKey: string;
}

@Injectable()
export class CreateApiKeyUseCase {
  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
    private readonly generator: ApiKeyGeneratorService,
  ) {}

  async execute(props: {
    name: string;
    ownerId: UserId;
    scopes: readonly string[];
  }): Promise<CreatedApiKey> {
    const { rawKey, keyHash } = this.generator.generate();
    const record = await this.apiKeys.create({
      name: props.name,
      keyHash,
      ownerId: props.ownerId,
      scopes: props.scopes,
    });
    await this.securityEvents.record({
      userId: props.ownerId,
      type: 'API_KEY_CREATED',
      metadata: { name: props.name },
    });
    return { id: record.id, rawKey };
  }
}
