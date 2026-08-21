'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { AppShell } from '@/components/app-shell/shell';
import { useAuth } from '@/lib/auth/auth-context';

/**
 * The actual authorization boundary is the API, not this layout (Phase
 * 4's rule) — a signed-out request here only ever sees a client-side
 * redirect; every real action still gets a real 401/403 from
 * `services/api` regardless of whether this redirect ever fired
 * (verified directly by `protected-routes.spec.tsx`, not by trusting
 * this component).
 */
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  if (status === 'loading') {
    return <div className="flex min-h-screen items-center justify-center">در حال بارگذاری...</div>;
  }
  if (status === 'unauthenticated') {
    return null;
  }

  return <AppShell>{children}</AppShell>;
}
