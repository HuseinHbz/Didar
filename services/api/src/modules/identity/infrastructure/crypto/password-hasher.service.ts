import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Argon2id (OWASP's current recommendation over bcrypt/scrypt for new
 * systems) — the one place in this module a *low-entropy, human-chosen*
 * secret gets hashed. See hash.util.ts's header comment for why everything
 * else (tokens, OTP codes, recovery codes) deliberately uses SHA-256
 * instead.
 */
@Injectable()
export class PasswordHasherService {
  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword);
  }

  async verify(hash: string, plainPassword: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainPassword);
    } catch {
      // argon2.verify throws on a malformed hash rather than returning
      // false — treat that the same as "doesn't match" rather than letting
      // it bubble up as a 500.
      return false;
    }
  }
}
