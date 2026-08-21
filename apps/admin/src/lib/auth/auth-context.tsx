'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  loginWithPassword,
  logout as apiLogout,
  verifyTwoFactorLogin,
  type LoginResult,
} from '../api/auth';
import { apiRequest } from '../api/client';
import { getMyPermissions, getUserById, type UserProfile } from '../api/permissions';

import {
  clearTokens,
  decodeUserId,
  getStoredRefreshToken,
  setAccessToken,
  setStoredRefreshToken,
} from './token-store';

interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  user: UserProfile | null;
  permissions: Set<string>;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyTwoFactor: (pendingToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Cosmetic only — every gated action is re-checked server-side
   * regardless of this hook's answer (ADR-018 decision 2 / Phase 4's
   * rule). */
  hasPermission: (key: string) => boolean;
  hasModuleAccess: (module: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadSession(
  accessToken: string,
): Promise<{ user: UserProfile; permissions: Set<string> }> {
  const userId = decodeUserId(accessToken);
  if (!userId) throw new Error('توکن نامعتبر است');
  const [user, permissionList] = await Promise.all([getUserById(userId), getMyPermissions()]);
  return { user, permissions: new Set(permissionList) };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    permissions: new Set(),
  });
  // Shared in-flight/completed restore promise, not a plain "have we
  // started" boolean. React 18 StrictMode's dev-only double-invocation of
  // mount effects (mount → cleanup → mount, synchronously, before either
  // async call resolves) means the FIRST invocation's cleanup runs
  // immediately, while the first invocation's own `restore()` is the one
  // actually left running. A start-once ref alone deadlocks: invocation 1
  // (cancelled=true) does the real network work but its setState is
  // suppressed, while invocation 2 (cancelled=false, the survivor) never
  // starts its own restore() because the ref already says "started" —
  // status never leaves 'loading'. Memoizing the PROMISE instead lets
  // invocation 2 await the exact same in-flight work invocation 1 kicked
  // off and apply the result itself once resolved — so the actual
  // `/auth/refresh` call still fires at most once per real page load
  // (refresh tokens are single-use/rotating — see
  // refresh-token.usecase.ts — so a second concurrent call would 401 on
  // the now-revoked token and clobber the first call's freshly-stored
  // tokens), while exactly one non-cancelled invocation is guaranteed to
  // observe and apply the outcome.
  const restorePromise = useRef<Promise<AuthState> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function restore(): Promise<AuthState> {
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) {
        return { status: 'unauthenticated', user: null, permissions: new Set() };
      }
      try {
        const refreshed = await apiRequest<{
          tokens?: { accessToken: string; refreshToken: string };
        }>('/auth/refresh', { method: 'POST', body: { refreshToken } });
        if (!refreshed.tokens) throw new Error('نشست منقضی شده است');
        setAccessToken(refreshed.tokens.accessToken);
        setStoredRefreshToken(refreshed.tokens.refreshToken);
        const session = await loadSession(refreshed.tokens.accessToken);
        return { status: 'authenticated', ...session };
      } catch {
        clearTokens();
        return { status: 'unauthenticated', user: null, permissions: new Set() };
      }
    }

    restorePromise.current ??= restore();
    void restorePromise.current.then((result) => {
      if (!cancelled) setState(result);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginWithPassword(email, password);
    if (result.status === 'AUTHENTICATED') {
      setAccessToken(result.tokens.accessToken);
      setStoredRefreshToken(result.tokens.refreshToken);
      const session = await loadSession(result.tokens.accessToken);
      setState({ status: 'authenticated', ...session });
    }
    return result;
  }, []);

  const verifyTwoFactor = useCallback(async (pendingToken: string, code: string) => {
    const tokens = await verifyTwoFactorLogin(pendingToken, code);
    setAccessToken(tokens.accessToken);
    setStoredRefreshToken(tokens.refreshToken);
    const session = await loadSession(tokens.accessToken);
    setState({ status: 'authenticated', ...session });
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = getStoredRefreshToken();
    clearTokens();
    setState({ status: 'unauthenticated', user: null, permissions: new Set() });
    if (refreshToken) {
      // Best-effort — the client-side session is already cleared
      // regardless of whether the server-side revocation call succeeds
      // (e.g. the token already expired), matching "sign out always
      // works locally" over "sign out requires a round trip."
      await apiLogout(refreshToken).catch(() => undefined);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      verifyTwoFactor,
      logout,
      hasPermission: (key) => state.permissions.has(key),
      hasModuleAccess: (module) => {
        const prefix = `${module}.`;
        for (const key of state.permissions) {
          if (key.startsWith(prefix)) return true;
        }
        return false;
      },
    }),
    [state, login, verifyTwoFactor, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
