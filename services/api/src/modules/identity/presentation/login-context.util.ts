import type { Request } from 'express';

import type { LoginContext } from '../application/auth/login-types';

/**
 * Every login-completing endpoint needs the same request metadata — pulled
 * out once so `auth.controller.ts` and `two-factor.controller.ts` don't
 * each reimplement it slightly differently. `X-Device-Fingerprint` is
 * client-supplied (a stable per-install signature the client generates and
 * persists itself); its absence just means this login isn't tied to a
 * device row (see UserSession.deviceId's nullability).
 */
export function extractLoginContext(req: Request): LoginContext {
  return {
    userAgent: req.headers['user-agent'] ?? null,
    ipAddress: req.ip ?? null,
    deviceFingerprint: firstHeader(req.headers['x-device-fingerprint']),
    devicePlatform: firstHeader(req.headers['x-device-platform']),
  };
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}
