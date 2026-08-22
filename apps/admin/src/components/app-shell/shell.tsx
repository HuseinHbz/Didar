'use client';

import { Button } from '@iecp/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { visibleNavItems } from './nav-config';

import { useAuth } from '@/lib/auth/auth-context';

/**
 * Permission-aware navigation (`P018` deliverable) — every item is
 * hidden, never merely disabled, when the caller lacks the matching
 * gate, computed from `useAuth()`'s own `hasPermission`/`hasModuleAccess`
 * (`GET /me/permissions`, real, server-recomputed). This hides the
 * button; it enforces nothing — every route behind it still requires
 * the identical server-side check (ADR-018 decision 2).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, hasModuleAccess, hasPermission, logout } = useAuth();

  const visibleItems = visibleNavItems({ hasModuleAccess, hasPermission });

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="bg-muted/30 w-60 shrink-0 border-e p-4">
        <p className="mb-6 px-2 text-lg font-bold">پنل مدیریت دیدار</p>
        <nav className="flex flex-col gap-1">
          <Link
            href="/"
            className={
              pathname === '/'
                ? 'bg-accent rounded-md px-3 py-2 text-sm font-medium'
                : 'hover:bg-accent/50 rounded-md px-3 py-2 text-sm'
            }
          >
            داشبورد
          </Link>
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                pathname.startsWith(item.href)
                  ? 'bg-accent rounded-md px-3 py-2 text-sm font-medium'
                  : 'hover:bg-accent/50 rounded-md px-3 py-2 text-sm'
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b p-4">
          <span className="text-muted-foreground text-sm">{user?.email ?? user?.phone ?? ''}</span>
          <Button variant="outline" size="sm" onClick={() => void handleLogout()}>
            خروج
          </Button>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
