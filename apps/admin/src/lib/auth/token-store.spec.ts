import { describe, expect, it } from 'vitest';

import { decodeUserId } from './token-store';

/** Builds a real base64url JWT-shaped string (unsigned — `decodeUserId`
 * never checks the signature, see its own doc comment) so this test
 * exercises the actual base64url-decode path, not a mocked stand-in. */
function makeToken(payload: Record<string, unknown>): string {
  const encode = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

describe('decodeUserId', () => {
  it('extracts the sub claim from a real base64url-encoded payload', () => {
    const token = makeToken({ sub: 'user-123', type: 'access' });
    expect(decodeUserId(token)).toBe('user-123');
  });

  it('returns null for a token missing a sub claim', () => {
    const token = makeToken({ type: 'access' });
    expect(decodeUserId(token)).toBeNull();
  });

  it('returns null for a malformed token rather than throwing', () => {
    expect(decodeUserId('not-a-jwt')).toBeNull();
    expect(decodeUserId('')).toBeNull();
    expect(decodeUserId('a.b')).toBeNull();
  });

  it('returns null when sub is present but not a string', () => {
    const token = makeToken({ sub: 12345 });
    expect(decodeUserId(token)).toBeNull();
  });
});
