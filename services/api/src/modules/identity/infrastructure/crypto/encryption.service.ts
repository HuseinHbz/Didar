import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

export const ENCRYPTION_KEY = Symbol('ENCRYPTION_KEY');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the recommended size for GCM

/**
 * AES-256-GCM at-rest encryption for the one secret this module needs to
 * both store AND read back in plaintext later: a user's TOTP seed
 * (`TwoFactorCredential.secretEncrypted`). Everything else sensitive
 * (passwords, tokens, OTP codes, recovery codes) only ever needs a
 * one-way compare, so it's hashed (PasswordHasherService / hash.util.ts),
 * never encrypted — encryption is reserved for the one case hashing can't
 * cover, verifying a live TOTP code requires the raw secret back.
 *
 * `key` is 32 raw bytes from `ENCRYPTION_KEY` (env, base64) — see
 * services/api/src/config/env.ts. No key rotation/versioning yet (documented
 * in docs/database/README.md's identity section) — a real environment needs
 * a KMS-backed key and a rotation story before this handles real user data.
 */
@Injectable()
export class EncryptionService {
  constructor(@Inject(ENCRYPTION_KEY) private readonly key: Buffer) {
    if (this.key.length !== 32) {
      throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${this.key.length}`);
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, ciphertext].map((buf) => buf.toString('base64')).join('.');
  }

  decrypt(encoded: string): string {
    const parts = encoded.split('.');
    if (parts.length !== 3) {
      throw new Error('Malformed ciphertext: expected "iv.authTag.ciphertext"');
    }
    const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string];
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
