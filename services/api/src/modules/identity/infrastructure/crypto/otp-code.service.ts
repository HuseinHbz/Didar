import { randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { sha256Hex } from './hash.util';

/** Generates and hashes the 6-digit codes `identity.otp_requests` stores.
 * `crypto.randomInt` (not `Math.random`) — cryptographically strong, not
 * just statistically random. */
@Injectable()
export class OtpCodeService {
  generate(): { code: string; codeHash: string } {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    return { code, codeHash: sha256Hex(code) };
  }

  hash(code: string): string {
    return sha256Hex(code);
  }
}
