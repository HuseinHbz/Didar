import { createHash, randomBytes } from 'node:crypto';

/**
 * SHA-256 for high-entropy random secrets (refresh tokens, API keys,
 * recovery codes, OTP codes) — deliberately NOT argon2/bcrypt here.
 * Argon2's slowness defends against brute-forcing a *low-entropy*,
 * human-chosen secret (a password); it adds real CPU cost with zero
 * security benefit against a 256-bit random token or a 6-digit code that's
 * already attempt-limited and short-lived (OtpRequest.MAX_ATTEMPTS,
 * `expiresAt`). See PasswordHasherService for the one place argon2 belongs.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** URL-safe random token, `bytes` of entropy (default 32 = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** A short, human-typeable random code, e.g. recovery codes: `XXXX-XXXX`. */
export function randomAlphanumericCode(groups = 2, groupLength = 4): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids visual ambiguity
  const pick = (): string => {
    const byte = randomBytes(1).at(0) ?? 0;
    return alphabet.charAt(byte % alphabet.length);
  };
  return Array.from({ length: groups }, () =>
    Array.from({ length: groupLength }, pick).join(''),
  ).join('-');
}
