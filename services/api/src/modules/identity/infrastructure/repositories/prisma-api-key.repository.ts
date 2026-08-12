import { prisma, type ApiKey as PrismaApiKey } from '@iecp/database';
import type { ApiKeyId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { ApiKeyRecord } from '../../domain/entities/api-key.entity';
import type { ApiKeyRepositoryPort } from '../../domain/ports/api-key.repository.port';

/**
 * `system.ApiKey` (blueprint §55), not `identity.*` — this repository lives
 * in the identity module because API-key *management* (issue/list/revoke)
 * is a user-facing identity concern, but the table itself is homed in the
 * platform-wide `system` schema per docs/database/README.md's domain-schema
 * boundaries. Module boundaries and Postgres schema boundaries aren't
 * required to match 1:1.
 */
@Injectable()
export class PrismaApiKeyRepository implements ApiKeyRepositoryPort {
  async create(props: {
    name: string;
    keyHash: string;
    ownerId?: string | null;
    scopes: readonly string[];
  }): Promise<ApiKeyRecord> {
    const row = await prisma.apiKey.create({
      data: {
        name: props.name,
        keyHash: props.keyHash,
        ownerId: props.ownerId ?? null,
        scopes: [...props.scopes],
      },
    });
    return toDomain(row);
  }

  async findById(id: ApiKeyId): Promise<ApiKeyRecord | null> {
    const row = await prisma.apiKey.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const row = await prisma.apiKey.findUnique({ where: { keyHash } });
    return row ? toDomain(row) : null;
  }

  async listForOwner(ownerId: string): Promise<ApiKeyRecord[]> {
    const rows = await prisma.apiKey.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomain);
  }

  async revoke(id: ApiKeyId, at: Date): Promise<void> {
    await prisma.apiKey.update({ where: { id }, data: { revokedAt: at } });
  }

  async touchLastUsed(id: ApiKeyId, at: Date): Promise<void> {
    await prisma.apiKey.update({ where: { id }, data: { lastUsedAt: at } });
  }
}

function toDomain(row: PrismaApiKey): ApiKeyRecord {
  return ApiKeyRecord.create({
    id: row.id,
    name: row.name,
    keyHash: row.keyHash,
    ownerId: row.ownerId,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  });
}
