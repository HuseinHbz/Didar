import { asApiKeyId, type ApiKeyId } from '@iecp/types';

/** system.ApiKey (blueprint §55) — `keyHash` only; the raw key is shown to
 * the caller exactly once, at creation, and never persisted or logged. */
export class ApiKeyRecord {
  private constructor(
    public readonly id: ApiKeyId,
    public readonly name: string,
    public readonly keyHash: string,
    public readonly ownerId: string | null,
    public readonly scopes: readonly string[],
    public readonly lastUsedAt: Date | null,
    public readonly revokedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    name: string;
    keyHash: string;
    ownerId?: string | null;
    scopes: readonly string[];
    lastUsedAt?: Date | null;
    revokedAt?: Date | null;
    createdAt: Date;
  }): ApiKeyRecord {
    return new ApiKeyRecord(
      asApiKeyId(props.id),
      props.name,
      props.keyHash,
      props.ownerId ?? null,
      props.scopes,
      props.lastUsedAt ?? null,
      props.revokedAt ?? null,
      props.createdAt,
    );
  }

  get isActive(): boolean {
    return this.revokedAt === null;
  }
}
