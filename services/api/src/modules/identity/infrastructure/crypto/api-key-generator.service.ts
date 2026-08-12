import { Injectable } from '@nestjs/common';

import { randomToken, sha256Hex } from './hash.util';

const PREFIX = 'iecp_';

/** Generates a raw API key (shown to the caller exactly once, at creation)
 * and its hash (the only thing ever persisted — see ApiKeyRepositoryPort). */
@Injectable()
export class ApiKeyGeneratorService {
  generate(): { rawKey: string; keyHash: string } {
    const rawKey = `${PREFIX}${randomToken(32)}`;
    return { rawKey, keyHash: sha256Hex(rawKey) };
  }

  hash(rawKey: string): string {
    return sha256Hex(rawKey);
  }
}
