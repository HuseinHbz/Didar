/** Real seeded credentials — see `packages/database/prisma/seed.ts` (the
 * two users) and `services/api/scripts/e2e-set-admin-password.ts` (the
 * password each gets before this suite runs). `catalog-editor` is a
 * real, documented lesser role: "can create a product, cannot publish/
 * delete/set a price" — used by `authorization.spec.ts`'s real
 * privilege-bypass proof. */
export const E2E_PASSWORD = process.env['E2E_ADMIN_PASSWORD'] ?? 'AdminPanel!E2E-2026';

export const ADMIN_CREDENTIALS = { email: 'admin@iecp.dev', password: E2E_PASSWORD };
export const CATALOG_EDITOR_CREDENTIALS = {
  email: 'catalog-editor@iecp.dev',
  password: E2E_PASSWORD,
};

export const API_BASE_URL = process.env['E2E_API_URL'] ?? 'http://localhost:4000/api/v1';
