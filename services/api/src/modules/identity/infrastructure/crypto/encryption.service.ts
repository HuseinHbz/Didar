import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

export const ENCRYPTION_KEYRING = Symbol('ENCRYPTION_KEYRING');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the recommended size for GCM

/** One versioned key ring: version 0 is always `ENCRYPTION_KEY` (env,
 * base64) — see `services/api/src/config/env.ts`; versions 1-3 are the
 * optional rotation slots (`ENCRYPTION_KEY_V1`.."V3"`). `currentVersion`
 * selects which entry `encrypt()` uses for new ciphertext. */
export interface EncryptionKeyring {
  readonly currentVersion: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

/**
 * AES-256-GCM at-rest encryption for the one secret this module needs to
 * both store AND read back in plaintext later: a user's TOTP seed
 * (`TwoFactorCredential.secretEncrypted`). Everything else sensitive
 * (passwords, tokens, OTP codes, recovery codes) only ever needs a
 * one-way compare, so it's hashed (PasswordHasherService / hash.util.ts),
 * never encrypted — encryption is reserved for the one case hashing can't
 * cover, verifying a live TOTP code requires the raw secret back.
 *
 * CP-028 (P2-7) — key rotation: ciphertext is now tagged with the key
 * version that produced it: `"version.iv.authTag.ciphertext"`. Legacy
 * 3-part ciphertext (`"iv.authTag.ciphertext"`, no version segment — every
 * row encrypted before this pass, and every row encrypted since if
 * rotation is never configured) is treated as version 0 and decrypts
 * unchanged with `ENCRYPTION_KEY` — strictly additive, no migration
 * required for existing data. `encrypt()` always uses whichever version
 * `currentVersion` names; with no rotation configured
 * (`ENCRYPTION_KEY_CURRENT_VERSION` unset, defaulting to `0`), it still
 * produces the exact pre-CP-028 3-part format, byte-for-byte — an
 * environment that never rotates sees zero behavior change.
 *
 * To rotate: set the next unused `ENCRYPTION_KEY_V{n}` to a fresh key,
 * then bump `ENCRYPTION_KEY_CURRENT_VERSION` to `{n}`. Every
 * already-encrypted value keeps decrypting via its own embedded version;
 * only new encryptions switch to the new key. Re-encrypting existing rows
 * onto the new version (so the old key can eventually be retired) is a
 * deliberately separate, not-yet-built follow-up — this class's job ends
 * at "the ciphertext format and decrypt path survive a key changing under
 * it," which is real and tested regardless of where the key material
 * itself comes from.
 *
 * This is the rotation *mechanism*, not a KMS integration — a real
 * KMS-backed provider (calling out to AWS KMS/GCP KMS/Vault instead of
 * reading a raw env var) is genuinely separate, still-undone work; this
 * sandbox has no outbound network path to any of them, the same class of
 * gap CP-017/CP-008's own "real adapter, unverified live network path"
 * precedent already documents for Kavenegar/ZarinPal.
 */
@Injectable()
export class EncryptionService {
  constructor(@Inject(ENCRYPTION_KEYRING) private readonly keyring: EncryptionKeyring) {
    for (const [version, key] of keyring.keys) {
      if (key.length !== 32) {
        throw new Error(`Encryption key v${version} must decode to 32 bytes, got ${key.length}`);
      }
    }
    if (!keyring.keys.has(keyring.currentVersion)) {
      throw new Error(
        `ENCRYPTION_KEY_CURRENT_VERSION=${keyring.currentVersion} has no matching key configured`,
      );
    }
  }

  encrypt(plaintext: string): string {
    const version = this.keyring.currentVersion;
    const key = this.keyring.keys.get(version);
    if (!key) {
      // Unreachable given the constructor's own check above — kept as a
      // real guard rather than a type assertion so a future refactor that
      // ever *could* reach it fails loudly instead of encrypting with a
      // wrong/undefined key.
      throw new Error(`No encryption key configured for version ${version}`);
    }

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encoded = [iv, authTag, ciphertext].map((buf) => buf.toString('base64'));
    // Version 0 keeps the original 3-part format exactly — no rotation
    // configured means byte-for-byte unchanged output.
    return version === 0 ? encoded.join('.') : [String(version), ...encoded].join('.');
  }

  decrypt(encoded: string): string {
    const segments = encoded.split('.');
    let version: number;
    let rest: readonly [string, string, string];

    if (segments.length === 3) {
      version = 0;
      rest = segments as [string, string, string];
    } else if (segments.length === 4) {
      const [versionSegment, ...parts] = segments as [string, string, string, string];
      version = Number(versionSegment);
      if (!Number.isInteger(version) || version < 0) {
        throw new Error('Malformed ciphertext: invalid key version');
      }
      rest = parts;
    } else {
      throw new Error(
        'Malformed ciphertext: expected "iv.authTag.ciphertext" or "version.iv.authTag.ciphertext"',
      );
    }

    const key = this.keyring.keys.get(version);
    if (!key) {
      throw new Error(`Malformed ciphertext: unknown key version ${version}`);
    }

    const [ivB64, authTagB64, ciphertextB64] = rest;
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
