const REFRESH_TOKEN_STORAGE_KEY = 'iecp_admin_refresh_token';

/** Access token lives in a module-level variable only — never persisted.
 * See ADR-018 decision 6 for the full reasoning (this doesn't defend
 * against XSS; it avoids leaving a live, un-revocable bearer credential
 * in storage after the tab closes). Refresh tokens are opaque,
 * server-side-revocable rows (identity/README.md's "why refresh tokens
 * aren't JWTs"), so `localStorage` for the refresh token is bounded by
 * that revocation model. */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
  } catch {
    // Private-browsing / storage-disabled contexts — treat as signed out.
    return null;
  }
}

export function setStoredRefreshToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token === null) {
      window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    } else {
      window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // Ignore — a session that can't persist a refresh token simply
    // doesn't survive a page reload, not a fatal error.
  }
}

export function clearTokens(): void {
  setAccessToken(null);
  setStoredRefreshToken(null);
}

/**
 * Reads the `sub` (userId) claim out of an access token's own payload —
 * decoding only, never verifying a signature: the browser has no key to
 * verify with, and no reason to, since every real use of this value is
 * itself re-authorized by the server on the next API call (ADR-018
 * decision 2). Returns `null` on any malformed token rather than
 * throwing, since a corrupt/foreign string here should fail open into
 * "not logged in," not crash the app.
 */
export function decodeUserId(token: string): string | null {
  try {
    const [, payloadSegment] = token.split('.');
    if (!payloadSegment) return null;
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const json = atob(padded);
    const payload: unknown = JSON.parse(json);
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'sub' in payload &&
      typeof payload.sub === 'string'
    ) {
      return (payload as { sub: string }).sub;
    }
    return null;
  } catch {
    return null;
  }
}
