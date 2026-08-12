import type { ApiKeyId } from '@iecp/types';

import type { ApiKeyRecord } from '../entities/api-key.entity';

export const API_KEY_REPOSITORY = Symbol('API_KEY_REPOSITORY');

export interface ApiKeyRepositoryPort {
  /** Persists a key's hash — the raw key never reaches this port; generating
   * and hashing it is ApiKeyGeneratorService's job (infrastructure). */
  create(props: {
    name: string;
    keyHash: string;
    ownerId?: string | null;
    scopes: readonly string[];
  }): Promise<ApiKeyRecord>;
  findById(id: ApiKeyId): Promise<ApiKeyRecord | null>;
  findByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  listForOwner(ownerId: string): Promise<ApiKeyRecord[]>;
  revoke(id: ApiKeyId, at: Date): Promise<void>;
  touchLastUsed(id: ApiKeyId, at: Date): Promise<void>;
}
