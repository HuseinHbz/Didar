import { expect, test } from '@playwright/test';

import { ADMIN_CREDENTIALS } from './fixtures';

/**
 * Real login flow against a real running `services/api` + Postgres —
 * `P018`'s "Auth flow (login, 2FA)" deliverable's own smoke coverage.
 * The 2FA branch itself isn't exercised here (the seeded admin fixture
 * has no TOTP enrolled — enrolling one is `POST /auth/2fa/setup`, itself
 * already covered by `services/api`'s own e2e suite); this proves the
 * primary-factor path end to end through the real UI.
 */
test.describe('admin login', () => {
  test('an unauthenticated visitor to a protected route is redirected to /login', async ({
    page,
  }) => {
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a correct email/password logs in and reaches the permission-aware dashboard', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('ایمیل').fill(ADMIN_CREDENTIALS.email);
    await page.getByLabel('رمز عبور').fill(ADMIN_CREDENTIALS.password);
    await page.getByRole('button', { name: 'ورود' }).click();

    await expect(page).toHaveURL('/');
    // Scoped to the heading role: Next.js's own route-announcer live
    // region (for screen readers) echoes the page's heading text into a
    // second, identically-texted element, which would otherwise make this
    // locator ambiguous.
    await expect(page.getByRole('heading', { name: 'خوش آمدید' })).toBeVisible();
    // The admin fixture holds order.read/return.read/inventory.*/catalog
    // module access — every nav item should be real and visible, not
    // hardcoded. Scoped to the sidebar nav landmark: the dashboard's own
    // "quick links" section repeats the same labels as plain links in
    // `main`, which would otherwise make these locators ambiguous.
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'سفارش‌ها' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'بازگشت‌ها' })).toBeVisible();
  });

  test('a wrong password is rejected with a real error, not a silent redirect', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('ایمیل').fill(ADMIN_CREDENTIALS.email);
    await page.getByLabel('رمز عبور').fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'ورود' }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('logout clears the session and a subsequent protected visit redirects to /login again', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('ایمیل').fill(ADMIN_CREDENTIALS.email);
    await page.getByLabel('رمز عبور').fill(ADMIN_CREDENTIALS.password);
    await page.getByRole('button', { name: 'ورود' }).click();
    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: 'خروج' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login$/);
  });
});
