import { randomBytes } from 'node:crypto';

import { EncryptionService, type EncryptionKeyring } from './encryption.service';

/**
 * CP-028 (P2-7) — this repo had zero unit coverage for `EncryptionService`
 * before this pass, despite it being the one thing guarding TOTP secrets
 * at rest. Covers the pre-existing behavior (kept byte-for-byte unchanged
 * when no rotation is configured) and the new rotation mechanism: a
 * ciphertext produced under one key version must keep decrypting after
 * the keyring's current version moves on, and tampering must still be
 * caught (AES-GCM's own auth tag, unchanged).
 */
describe('EncryptionService', () => {
  const key0 = randomBytes(32);
  const key1 = randomBytes(32);
  const key2 = randomBytes(32);

  const noRotationKeyring: EncryptionKeyring = {
    currentVersion: 0,
    keys: new Map([[0, key0]]),
  };

  it('round-trips a plaintext at version 0 (no rotation configured)', () => {
    const service = new EncryptionService(noRotationKeyring);

    const ciphertext = service.encrypt('a-totp-seed-value');

    expect(service.decrypt(ciphertext)).toBe('a-totp-seed-value');
  });

  it('produces the exact pre-CP-028 3-part format when no rotation is configured', () => {
    const service = new EncryptionService(noRotationKeyring);

    const ciphertext = service.encrypt('plaintext');

    expect(ciphertext.split('.')).toHaveLength(3);
  });

  it('produces a 4-part, version-tagged ciphertext once rotation is configured', () => {
    const rotatedKeyring: EncryptionKeyring = {
      currentVersion: 1,
      keys: new Map([
        [0, key0],
        [1, key1],
      ]),
    };
    const service = new EncryptionService(rotatedKeyring);

    const ciphertext = service.encrypt('plaintext');
    const parts = ciphertext.split('.');

    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('1');
    expect(service.decrypt(ciphertext)).toBe('plaintext');
  });

  it('keeps decrypting a legacy (unversioned) ciphertext after rotating current forward', () => {
    // Simulates the real rotation story: a value encrypted before
    // rotation was ever configured must still decrypt correctly once the
    // keyring gains new versions and moves `currentVersion` on.
    const before = new EncryptionService(noRotationKeyring);
    const legacyCiphertext = before.encrypt('pre-rotation-secret');

    const afterRotation = new EncryptionService({
      currentVersion: 1,
      keys: new Map([
        [0, key0],
        [1, key1],
      ]),
    });

    expect(afterRotation.decrypt(legacyCiphertext)).toBe('pre-rotation-secret');
  });

  it('keeps decrypting a v1 ciphertext after rotating current forward to v2', () => {
    const atV1 = new EncryptionService({
      currentVersion: 1,
      keys: new Map([
        [0, key0],
        [1, key1],
      ]),
    });
    const v1Ciphertext = atV1.encrypt('rotated-once-secret');

    const atV2 = new EncryptionService({
      currentVersion: 2,
      keys: new Map([
        [0, key0],
        [1, key1],
        [2, key2],
      ]),
    });

    expect(atV2.decrypt(v1Ciphertext)).toBe('rotated-once-secret');
    // And new encryptions now use v2, not v1.
    expect(atV2.encrypt('new-secret').split('.')[0]).toBe('2');
  });

  it('rejects ciphertext referencing a key version the keyring no longer has', () => {
    const service = new EncryptionService({
      currentVersion: 0,
      keys: new Map([[0, key0]]),
    });
    const foreignCiphertext = new EncryptionService({
      currentVersion: 1,
      keys: new Map([
        [0, key0],
        [1, key1],
      ]),
    }).encrypt('secret-under-v1');

    expect(() => service.decrypt(foreignCiphertext)).toThrow(/unknown key version/);
  });

  it('rejects malformed ciphertext (wrong segment count)', () => {
    const service = new EncryptionService(noRotationKeyring);

    expect(() => service.decrypt('only.two')).toThrow(/Malformed ciphertext/);
    expect(() => service.decrypt('one.two.three.four.five')).toThrow(/Malformed ciphertext/);
  });

  it('rejects a non-integer key-version segment', () => {
    const service = new EncryptionService(noRotationKeyring);

    expect(() => service.decrypt('not-a-number.iv.tag.ct')).toThrow(/invalid key version/);
  });

  it('detects tampering via AES-GCM auth tag (never silently returns wrong plaintext)', () => {
    const service = new EncryptionService(noRotationKeyring);
    const ciphertext = service.encrypt('sensitive-value');
    const [iv, authTag, body] = ciphertext.split('.');
    // Flip the ciphertext body — the auth tag no longer matches.
    const tampered = [iv, authTag, `${body}AA`].join('.');

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('rejects a keyring whose currentVersion has no matching key at construction time', () => {
    expect(
      () =>
        new EncryptionService({
          currentVersion: 5,
          keys: new Map([[0, key0]]),
        }),
    ).toThrow(/ENCRYPTION_KEY_CURRENT_VERSION=5/);
  });

  it('rejects a keyring with a key that is not exactly 32 bytes', () => {
    expect(
      () =>
        new EncryptionService({
          currentVersion: 0,
          keys: new Map([[0, randomBytes(16)]]),
        }),
    ).toThrow(/must decode to 32 bytes/);
  });
});
