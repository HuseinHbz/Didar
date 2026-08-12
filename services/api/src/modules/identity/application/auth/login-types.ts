import type { User } from '../../domain/entities/user.entity';

/** Request metadata every login-adjacent use case needs — device
 * fingerprinting/session bookkeeping, not authentication itself. */
export interface LoginContext {
  userAgent?: string | null;
  ipAddress?: string | null;
  /** Client-supplied device signature (see UserDevice.fingerprint) — the
   * caller is responsible for producing something stable per install;
   * this layer just hashes and stores whatever it's given. */
  deviceFingerprint?: string | null;
  devicePlatform?: string | null;
}

export type LoginOutcome =
  | { kind: 'AUTHENTICATED'; accessToken: string; refreshToken: string; user: User }
  | { kind: 'TWO_FACTOR_REQUIRED'; pendingToken: string };
