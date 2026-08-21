# @iecp/admin

Internal admin panel — Next.js 16 App Router, React 19, TypeScript strict. Runs on
port 3001 in dev (`storefront` owns 3000) so both can run side by side.

## Scope (CP-018 — Admin Panel MVP)

Per `docs/product/master-roadmap-v2.md`'s `P018` (the canonical source for this
phase — see `docs/adr/ADR-018-admin-panel-architecture.md` for why this is
narrower than the RBAC-console framing an earlier version of this README used):
a real operator console over the auth/catalog/inventory/order/return backend
`services/api` already exposes (CP-004/005/006/009/012). Not a role/permission/
user/session/API-key/audit-log administration UI — that surface is already fully
built server-side (CP-004) but has no admin frontend yet; it's explicitly out of
this phase's scope (`docs/product/admin-panel.md`'s scope matrix, category F).

Built:

- **Auth**: real `POST /auth/login` (email + password), 2FA verification step if
  the account has TOTP enrolled, silent session restore on reload via the stored
  refresh token, logout.
- **Permission-aware navigation**: the sidebar and dashboard only show links to
  modules the signed-in user's real `GET /me/permissions` response grants —
  **cosmetic only**, never the authorization boundary itself (see Security below).
- **Catalog**: product list + detail (publish/unpublish).
- **Inventory**: stock adjustments (create + list, per warehouse), transfers
  (list, detail, receive against dispatched line items).
- **Orders**: list + detail (fulfillments, shipments, delivery confirmation).
- **Returns**: list + detail (approve/reject/receive/inspect/refund, settlement
  panel).

## Architecture

- **Zero new backend business logic.** Every route this app calls already
  existed, already RBAC-gated, before this phase started — see ADR-018 decision
  3 for the full deliverable→route mapping. The one backend touch this phase
  made was widening `services/api`'s `CORS_ORIGIN` to include this app's own
  origin (`http://localhost:3001`) — infrastructure config, not a new endpoint.
- **Server-side authorization only.** `useAuth().hasPermission()` /
  `hasModuleAccess()` (backed by the real `GET /me/permissions`) decide what to
  *show*. They decide nothing about what the backend *allows* — every mutation
  is re-checked by the same `AuthorizationGuard` / `@RequirePermission` /
  `@RequireModule` decorators every other client already goes through. See
  `docs/security/admin-panel-security.md` and `e2e/authorization.spec.ts`
  (direct-API-only tests — a hidden button is never treated as proof of
  authorization here).
- **Token storage**: access token in a module-level JS variable only (never
  persisted, lost on reload); refresh token in `localStorage` (opaque,
  server-revocable, single-use/rotating on each refresh — see
  `identity/application/auth/refresh-token.usecase.ts`). Full rationale in
  ADR-018 decision 6.
- **Cursor-only pagination.** Every admin list endpoint returns
  `{items, nextCursor}` — `use-cursor-pagination.ts` layers a client-side
  cursor-history stack on top to make a "Previous" button possible.
- **Money**: order/return/payment DTOs serialize money as plain rial-integer
  strings, not `Money.toJSON()`'s `{amount, currency}` shape — `format/money.ts`
  reconstructs `Money.ofRial(BigInt(value)).formatToman('fa-IR')` from that.
- **Types**: hand-mirrored from the real DTOs (no codegen pipeline exists in
  this repo yet), reusing `@iecp/types`' real status/enum unions directly so a
  new backend status value is a compile error here, not a silent "unknown"
  badge (`components/status-badge.tsx`).

```
src/
  app/
    (auth)/login/            # unauthenticated route group
    (app)/                   # authenticated route group — layout enforces the session guard
      catalog/products/
      inventory/adjustments/ inventory/transfers/
      orders/
      returns/
  components/
    app-shell/                # sidebar + permission-aware nav filtering
    error-boundary.tsx         # real ErrorBoundary + reportError() interface
    status-badge.tsx
  lib/
    api/                       # one file per backend module, apiRequest() wrapper
    auth/                      # token-store.ts + auth-context.tsx (session restore, login/logout)
    format/money.ts
    hooks/use-cursor-pagination.ts
    observability/error-reporter.ts
```

## Not indexed

`robots: { index: false, follow: false }` is set in the root layout — this app is
never meant to appear in search results. Real deployments should also gate it
behind network-level access control (VPN/IP allowlist) in addition to the auth
wall this phase adds.

## Testing

First frontend test suite in this repo — the template CP-020/CP-022 inherit
(ADR-018's Consequences). Two layers, both real, no mocked backend:

- **Component/unit** (Vitest + Testing Library): pure logic
  (`nav-config.spec.ts`, `token-store.spec.ts`, `money.spec.ts`) and rendered
  permission-aware nav filtering (`shell.spec.tsx`).
- **E2E** (`@playwright/test`, real browser): real running `services/api` +
  Postgres + Redis + seeded fixture data. `scripts/e2e-set-admin-password.ts`
  (in `services/api`) sets a real argon2-hashed password on two seeded fixture
  users so the real password-login flow can be exercised end to end — run it
  once before `test:e2e` (`pnpm --filter @iecp/api e2e:set-admin-password`).
  `authorization.spec.ts` hits `services/api` directly with Playwright's
  `request` fixture, no browser — proving server-side enforcement, not that a
  button is hidden.

```bash
pnpm --filter @iecp/admin test        # vitest
pnpm --filter @iecp/admin test:e2e    # playwright — needs services/api + this app running
```

## Commands

```bash
pnpm --filter @iecp/admin dev      # http://localhost:3001
pnpm --filter @iecp/admin build
pnpm --filter @iecp/admin lint
pnpm --filter @iecp/admin typecheck
```
