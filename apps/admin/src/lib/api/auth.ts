import { apiRequest } from './client';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export type LoginResult =
  | { status: 'AUTHENTICATED'; tokens: Tokens }
  | { status: 'TWO_FACTOR_REQUIRED'; pendingToken: string };

/** Mirrors `LoginResponseDto` (`services/api`'s `AuthController`) — the
 * admin/staff password+2FA flow, distinct from CP-017's customer-facing
 * mobile OTP flow (ADR-018 decision 1). */
export async function loginWithPassword(email: string, password: string): Promise<LoginResult> {
  const result = await apiRequest<{ status: string; tokens?: Tokens; pendingToken?: string }>(
    '/auth/login',
    { method: 'POST', body: { email, password } },
  );
  if (result.status === 'AUTHENTICATED' && result.tokens) {
    return { status: 'AUTHENTICATED', tokens: result.tokens };
  }
  if (result.status === 'TWO_FACTOR_REQUIRED' && result.pendingToken) {
    return { status: 'TWO_FACTOR_REQUIRED', pendingToken: result.pendingToken };
  }
  throw new Error('پاسخ نامعتبر از سرور برای ورود');
}

export async function verifyTwoFactorLogin(pendingToken: string, code: string): Promise<Tokens> {
  const result = await apiRequest<{ status: string; tokens?: Tokens }>('/auth/2fa/verify', {
    method: 'POST',
    body: { pendingToken, code },
  });
  if (result.status !== 'AUTHENTICATED' || !result.tokens) {
    throw new Error('پاسخ نامعتبر از سرور برای تأیید دو مرحله‌ای');
  }
  return result.tokens;
}

export async function logout(refreshToken: string): Promise<void> {
  await apiRequest<undefined>('/auth/logout', { method: 'POST', body: { refreshToken } });
}
