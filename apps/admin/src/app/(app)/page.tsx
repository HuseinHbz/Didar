'use client';

import Link from 'next/link';

import { visibleNavItems } from '@/components/app-shell/nav-config';
import { useAuth } from '@/lib/auth/auth-context';

/**
 * No KPI widgets — no backend aggregate/metrics endpoint exists to back
 * one honestly, and `P018` never lists a dashboard among its five
 * deliverables (ADR-018 non-goals). This is a permission-aware set of
 * real links into the modules the caller can actually act on.
 */
export default function DashboardPage() {
  const { user, hasModuleAccess, hasPermission } = useAuth();
  const visibleItems = visibleNavItems({ hasModuleAccess, hasPermission });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold">خوش آمدید</h1>
      <p className="text-muted-foreground mb-6 text-sm">{user?.email ?? user?.phone}</p>
      {visibleItems.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          حساب شما دسترسی به هیچ‌کدام از بخش‌های عملیاتی پنل را ندارد.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hover:bg-accent/50 rounded-md border p-4 text-sm font-medium transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
