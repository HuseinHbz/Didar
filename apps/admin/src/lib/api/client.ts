import {
  clearTokens,
  getAccessToken,
  getStoredRefreshToken,
  setAccessToken,
  setStoredRefreshToken,
} from '../auth/token-store';

import { ApiError } from './errors';

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Internal — set on the retry attempt after a refresh, so a second
   * 401 fails hard instead of looping refresh attempts forever. */
  _isRetry?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(API_BASE_URL.replace(/\/$/, '') + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

interface NestErrorBody {
  message?: string | string[];
  error?: string;
}

async function parseErrorBody(response: Response): Promise<ApiError> {
  let body: NestErrorBody = {};
  try {
    body = (await response.json()) as NestErrorBody;
  } catch {
    // Non-JSON error body (rare — a proxy/gateway error page) — fall
    // through to the generic message below.
  }
  const details = Array.isArray(body.message) ? body.message : [];
  const message = Array.isArray(body.message)
    ? (body.error ?? 'خطای اعتبارسنجی')
    : (body.message ?? response.statusText);
  return new ApiError(response.status, message, details);
}

/** One refresh attempt shared by every concurrent 401 — prevents a burst
 * of parallel requests each independently racing `POST /auth/refresh`
 * (which would otherwise present the same refresh token twice and, since
 * refresh tokens rotate on use, strand every request after the first
 * with an already-revoked token). */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) return false;
    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        clearTokens();
        return false;
      }
      const data = (await response.json()) as {
        tokens?: { accessToken: string; refreshToken: string };
      };
      if (!data.tokens) {
        clearTokens();
        return false;
      }
      setAccessToken(data.tokens.accessToken);
      setStoredRefreshToken(data.tokens.refreshToken);
      return true;
    } catch {
      clearTokens();
      return false;
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/**
 * The one place every admin API call goes through. Injects the access
 * token, retries exactly once after a transparent refresh on a 401 (a
 * caller never sees the intermediate 401), and never leaks the token
 * itself into a thrown error or a console log (ADR-018 decision 6 /
 * Phase 4's "never log credentials" rule).
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, _isRetry = false } = options;
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && !_isRetry && getStoredRefreshToken()) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, _isRetry: true });
    }
  }

  if (!response.ok) {
    throw await parseErrorBody(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
