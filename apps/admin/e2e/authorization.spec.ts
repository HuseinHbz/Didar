import { expect, test } from '@playwright/test';

import { API_BASE_URL, ADMIN_CREDENTIALS, CATALOG_EDITOR_CREDENTIALS } from './fixtures';

/**
 * Security tests, `testing_requirements`'s own explicit rule applied
 * literally: "a test that only checks that a button is hidden is NOT an
 * authorization test. Test the API directly." Every request below goes
 * straight at `services/api` through Playwright's `request` fixture —
 * no browser, no UI, nothing the admin frontend could hide or shape.
 * Proves the real server-side enforcement `AuthorizationGuard` /
 * `@RequirePermission` / `@RequireModule` already perform (CP-004) —
 * this phase invents none of it, only proves it's really there.
 */
test.describe('direct API authorization (no UI involved)', () => {
  test('no token at all — a protected admin route returns 401, not data', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/admin/orders`);
    expect(response.status()).toBe(401);
  });

  test('a garbage/malformed bearer token — 401, not a 500 or a silent pass-through', async ({
    request,
  }) => {
    const response = await request.get(`${API_BASE_URL}/admin/orders`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(response.status()).toBe(401);
  });

  test('vertical privilege escalation: catalog-editor (no catalog.products.publish) gets a real 403 from publish, never 200', async ({
    request,
  }) => {
    const loginResponse = await request.post(`${API_BASE_URL}/auth/login`, {
      data: CATALOG_EDITOR_CREDENTIALS,
    });
    expect(loginResponse.ok()).toBe(true);
    const loginBody = (await loginResponse.json()) as { tokens: { accessToken: string } };
    const editorToken = loginBody.tokens.accessToken;

    // Independently confirm from the real server what this fixture
    // actually holds — the assertion below is meaningless if the seed
    // data ever changes to grant this permission.
    const permissionsResponse = await request.get(`${API_BASE_URL}/me/permissions`, {
      headers: { Authorization: `Bearer ${editorToken}` },
    });
    const { permissions } = (await permissionsResponse.json()) as { permissions: string[] };
    expect(permissions).not.toContain('catalog.products.publish');

    // Find a real product to target — any id works for proving 403,
    // since AuthorizationGuard rejects before the use case ever runs.
    const adminLoginResponse = await request.post(`${API_BASE_URL}/auth/login`, {
      data: ADMIN_CREDENTIALS,
    });
    const adminBody = (await adminLoginResponse.json()) as { tokens: { accessToken: string } };
    const listResponse = await request.get(`${API_BASE_URL}/admin/catalog/products?limit=1`, {
      headers: { Authorization: `Bearer ${adminBody.tokens.accessToken}` },
    });
    const { items } = (await listResponse.json()) as { items: { id: string }[] };
    const [targetProduct] = items;
    if (!targetProduct) throw new Error('fixture data must seed at least one catalog product');
    const targetProductId = targetProduct.id;

    const publishResponse = await request.post(
      `${API_BASE_URL}/admin/catalog/products/${targetProductId}/publish`,
      { headers: { Authorization: `Bearer ${editorToken}` } },
    );
    expect(publishResponse.status()).toBe(403);
  });

  test('module-level bypass: catalog-editor (no order/return module access) gets 403 from admin order and return reads', async ({
    request,
  }) => {
    const loginResponse = await request.post(`${API_BASE_URL}/auth/login`, {
      data: CATALOG_EDITOR_CREDENTIALS,
    });
    const { tokens } = (await loginResponse.json()) as { tokens: { accessToken: string } };

    const ordersResponse = await request.get(`${API_BASE_URL}/admin/orders`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(ordersResponse.status()).toBe(403);

    const returnsResponse = await request.get(`${API_BASE_URL}/admin/returns`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(returnsResponse.status()).toBe(403);
  });

  test('the admin fixture (holds order.read) gets a real 200 from the same route — proves this is a permission check, not a global lockout', async ({
    request,
  }) => {
    const loginResponse = await request.post(`${API_BASE_URL}/auth/login`, {
      data: ADMIN_CREDENTIALS,
    });
    const { tokens } = (await loginResponse.json()) as { tokens: { accessToken: string } };

    const response = await request.get(`${API_BASE_URL}/admin/orders`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(response.status()).toBe(200);
  });
});
