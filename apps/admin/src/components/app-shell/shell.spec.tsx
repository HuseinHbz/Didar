import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from './shell';

const mockAuth = vi.hoisted(() => ({
  user: { id: 'u1', email: 'admin@iecp.dev' },
  hasModuleAccess: vi.fn((_module: string) => false),
  hasPermission: vi.fn((_key: string) => false),
  logout: vi.fn(),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => mockAuth,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * The real rendered-component half of "component tests for permission-
 * aware rendering" — proves `AppShell` actually hides a nav item when
 * `useAuth()` reports the caller lacks its gate, and shows it when the
 * gate is held. Cosmetic only (Phase 4's rule, restated in ADR-018
 * decision 2): this is not a security test — `e2e/authorization.spec.ts`
 * is what proves the same route rejects a direct API call.
 */
describe('AppShell permission-aware navigation', () => {
  it('hides every gated nav item when the caller holds no permissions', () => {
    mockAuth.hasModuleAccess.mockReturnValue(false);
    mockAuth.hasPermission.mockReturnValue(false);

    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );

    expect(screen.queryByText('محصولات')).not.toBeInTheDocument();
    expect(screen.queryByText('سفارش‌ها')).not.toBeInTheDocument();
    expect(screen.queryByText('بازگشت‌ها')).not.toBeInTheDocument();
    // The dashboard link itself is never gated — always visible once authenticated.
    expect(screen.getByText('داشبورد')).toBeInTheDocument();
  });

  it('shows only the nav items whose gate the caller actually holds', () => {
    mockAuth.hasModuleAccess.mockReturnValue(false);
    mockAuth.hasPermission.mockImplementation((key: string) => key === 'order.read');

    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );

    expect(screen.getByText('سفارش‌ها')).toBeInTheDocument();
    expect(screen.queryByText('بازگشت‌ها')).not.toBeInTheDocument();
    expect(screen.queryByText('محصولات')).not.toBeInTheDocument();
  });

  it('shows the caller identity from the authenticated profile, never a hardcoded placeholder', () => {
    mockAuth.hasModuleAccess.mockReturnValue(false);
    mockAuth.hasPermission.mockReturnValue(false);

    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );

    expect(screen.getByText('admin@iecp.dev')).toBeInTheDocument();
  });
});
