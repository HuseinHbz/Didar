'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Label } from '@iecp/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth/auth-context';

const loginSchema = z.object({
  email: z.string().min(1, 'ایمیل الزامی است'),
  password: z.string().min(1, 'رمز عبور الزامی است'),
});
type LoginFormValues = z.infer<typeof loginSchema>;

const twoFactorSchema = z.object({
  code: z.string().min(6, 'کد ۶ رقمی را وارد کنید'),
});
type TwoFactorFormValues = z.infer<typeof twoFactorSchema>;

/** ADR-018 decision 1 — admin/staff password+2FA flow against
 * `POST /auth/login` / `POST /auth/2fa/verify` (CP-004), distinct from
 * CP-017's customer-facing mobile OTP flow. */
export default function LoginPage() {
  const router = useRouter();
  const { login, verifyTwoFactor } = useAuth();
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loginForm = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });
  const twoFactorForm = useForm<TwoFactorFormValues>({ resolver: zodResolver(twoFactorSchema) });

  async function onLoginSubmit(values: LoginFormValues) {
    setError(null);
    try {
      const result = await login(values.email, values.password);
      if (result.status === 'TWO_FACTOR_REQUIRED') {
        setPendingToken(result.pendingToken);
      } else {
        router.push('/');
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'ورود ناموفق بود.');
    }
  }

  async function onTwoFactorSubmit(values: TwoFactorFormValues) {
    if (!pendingToken) return;
    setError(null);
    try {
      await verifyTwoFactor(pendingToken, values.code);
      router.push('/');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'کد نامعتبر است.');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border p-8">
        <h1 className="mb-6 text-center text-xl font-bold">ورود به پنل مدیریت</h1>

        {pendingToken ? (
          <form
            onSubmit={(event) => void twoFactorForm.handleSubmit(onTwoFactorSubmit)(event)}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="code">کد تأیید دو مرحله‌ای</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                {...twoFactorForm.register('code')}
              />
              {twoFactorForm.formState.errors.code ? (
                <p className="text-destructive mt-1 text-xs">
                  {twoFactorForm.formState.errors.code.message}
                </p>
              ) : null}
            </div>
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={twoFactorForm.formState.isSubmitting}
            >
              تأیید
            </Button>
          </form>
        ) : (
          <form
            onSubmit={(event) => void loginForm.handleSubmit(onLoginSubmit)(event)}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="email">ایمیل</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                {...loginForm.register('email')}
              />
              {loginForm.formState.errors.email ? (
                <p className="text-destructive mt-1 text-xs">
                  {loginForm.formState.errors.email.message}
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="password">رمز عبور</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...loginForm.register('password')}
              />
              {loginForm.formState.errors.password ? (
                <p className="text-destructive mt-1 text-xs">
                  {loginForm.formState.errors.password.message}
                </p>
              ) : null}
            </div>
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={loginForm.formState.isSubmitting}>
              ورود
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
