# ADR-018 — Admin Panel MVP Architecture (CP-018)

## Status

Accepted — implemented this phase.

## Context

`apps/admin` has been a placeholder scaffold since CP-001 (one page, no
routing, no auth) — CP-005 explicitly deferred building it
("P5#48 Scope decision: backend-only catalog, defer admin/storefront
Next.js UI") on the reasoning that eight backend modules needed to exist
and be hardened first. They now do: identity/RBAC (CP-004), catalog
(CP-005), inventory (CP-006), cart/checkout (CP-007), payment (CP-008),
order/fulfillment (CP-009/011), promotion (CP-010), return/settlement
(CP-012/013/015). CP-018 is the first phase in this repository that ships
a real frontend of any kind — every architectural choice here becomes the
template the next two frontend phases (CP-020 storefront, CP-022 mobile)
will either follow or explicitly deviate from, matching how ADR-005
(catalog) became the template every backend phase after it followed.

### Conflict found and resolved before any code was written

Two documents describe "the admin panel" at very different sizes:

1. `apps/admin/README.md`'s own pre-existing "Scope (target)" section
   (written at CP-001, quoting `docs/product/blueprint.md` §51-55): a
   full Commerce/Inventory/Stores/CRM/CMS/Marketing/Finance/Analytics/
   System console with fine-grained per-action RBAC editing, audit log
   browsing, content approval workflows, and a four-eyes principle.
2. `docs/roadmap/master-roadmap-v2.md`'s `P018` block (the actual
   canonical, current phase definition CP-014 established and every
   phase since has been built against): a narrower MVP —
   `deliverables: [Auth flow (login, 2FA), Permission-aware navigation,
Order/fulfillment/return operator views, Inventory adjustment/transfer
views, Catalog product/variant/SKU management views]`.

`blueprint.md` is the original, superseded full-product vision (CP-000);
`master-roadmap-v2.md` is what CP-014's audit and every phase since
actually treats as authoritative (`docs/product/phase-governance.md`'s
own "Definition of Ready" cites `master-roadmap-v2.md`/`canonical-
roadmap.md` explicitly as the phase_format source). Per this phase's own
governing rule ("repository evidence wins for implementation details,
canonical governance wins for phase identity") and "do NOT invent
requirements," **`P018`'s five listed deliverables are CP-018's actual
scope** — not `blueprint.md`'s larger vision.

Concretely, this means: **role/permission editing, user management,
session/device management, API-key management, and audit-log/security-
event browsing UIs are explicitly OUT of CP-018's scope**, even though
real, already-tested backend routes for every one of them already exist
(`roles.controller.ts`, `permissions.controller.ts`, `sessions.controller.ts`,
`api-keys.controller.ts`, `audit-log.controller.ts` — all shipped by
CP-004). Building UI for them would not violate "no new backend logic,"
but it would be scope invented beyond `P018`'s own deliverables list, and
no future phase currently owns them either (`docs/product/gap-priority-
matrix.md` has no entry for "RBAC administration UI"). This is recorded
here as a genuine, honest gap — not silently resolved by building it
anyway, and not silently dropped from tracking. See `docs/product/admin-
panel.md`'s own "Explicitly out of scope" section for the full list and
the recommendation that a future phase (CP-028 security hardening, or a
new gap entry) pick this up.

## Decisions

### 1. Auth: reuse the existing password + 2FA flow, not OTP

`services/api`'s `POST /auth/login` (email+password) → optional
`POST /auth/2fa/verify` (TOTP) is the flow CP-018 wires up — not the
mobile-OTP flow CP-017 hardened, which is customer-facing
(`docs/adr/ADR-014-real-notification-delivery.md`'s own scope explicitly
excludes admin auth). This matches `identity/README.md`'s own framing:
password+2FA for admin/staff accounts, OTP for customers. No new backend
route needed.

### 2. Permission-aware navigation: `GET /me/permissions`, decoded JWT `sub` for self-profile — zero new backend endpoints

`GET /me/permissions` already exists (`permissions.controller.ts`,
CP-004) and recomputes the caller's effective permission set server-side
on every call (role inheritance + per-user overrides + deny-wins) — never
trusting anything cached in a JWT (`AuthorizationGuard`'s own doc
comment). The admin frontend calls it once after login and on every
top-level navigation, and hides/disables nav sections and destructive
buttons the caller doesn't hold the permission for. This is **cosmetic
only** — every one of those same actions still requires the identical
`@RequirePermission`/`@RequireModule` guard server-side; a hidden button
is not a security boundary (Phase 4's own rule).

For the caller's own profile display (phone/email in the topbar), the
frontend decodes (never verifies — the browser has no reason to check a
signature the server will re-check on every real request) the access
token's own `sub` claim to learn its own `userId`, then calls the
existing `GET /users/:id` with that id. `UserResponseDto` already exists
(CP-004); no new backend endpoint. Decoding one's own already-possessed
JWT claim client-side is not a security boundary decision (it grants
nothing — every subsequent API call is independently authorized), so it
does not conflict with "never trust hidden client state."

### 3. Zero new backend business logic — this MVP is a pure consumer

Every one of `P018`'s five deliverables maps onto an already-implemented,
already-RBAC-gated, already-tested route:

| Deliverable                             | Backend surface (all pre-existing, CP-004/005/006/009/011/012/013)                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Auth (login, 2FA)                       | `AuthController`, `TwoFactorController`                                                                          |
| Permission-aware nav                    | `PermissionsController#mine` (`GET /me/permissions`)                                                             |
| Catalog product/variant/SKU             | `ProductController`, `VariantSkuController` (`admin/catalog/*`)                                                  |
| Inventory adjustment/transfer           | `AdjustmentController`, `TransferController`, `StockController`                                                  |
| Order/fulfillment/return operator views | `OrderAdminController`, `FulfillmentAdminController`, `ReturnAdminController`, `ReturnSettlementAdminController` |

No migration, no new DTO on the backend, no new use case. This satisfies
`P018`'s own `acceptance_criteria` ("every admin action in the UI maps to
a real, already-existing, already-tested backend route — no new backend
business logic invented") and `database_requirements: []` literally.

### 4. Frontend architecture: Next.js App Router, server-rendered shell + client-side data fetching, cursor pagination throughout

- **Routing**: App Router route groups — `(auth)/login` public,
  `(app)/*` behind a layout-level auth check. No middleware-based route
  protection is added beyond what the layout does client-side, because
  the actual authorization boundary is the API, not the frontend router
  (Phase 4's rule) — a signed-out user hitting `(app)/*` sees a redirect
  to `/login`, nothing more; the same route rendered without a valid
  token simply gets 401s from every API call and the shell's own
  `useAuth` hook redirects.
- **Data fetching**: TanStack Query (already a dependency, unused until
  now) for every list/detail read, with the existing cursor-pagination
  contract every admin list endpoint already uses (`cursor`/`limit`/
  `nextCursor` — `ProductPageResponseDto`'s own shape). No offset
  pagination invented for consistency with one endpoint that happens to
  use it differently.
- **Forms**: `react-hook-form` + `zod` (already dependencies) for every
  mutation, client-side validation mirroring (never replacing) the
  backend's own `class-validator` DTOs — a client-side check is a UX
  nicety; the 400 the backend returns on invalid input is the real
  contract.
- **API client**: one small typed `fetch` wrapper
  (`apps/admin/src/lib/api/client.ts`) — access token in memory + one
  `httpOnly`-equivalent via `localStorage`-backed refresh flow (see
  Decision 6), automatic 401→refresh→retry once, no client generation
  tooling introduced (the backend's OpenAPI/Swagger document exists at
  `/api/v1/docs` but wiring a codegen pipeline is out of this MVP's
  scope — types are hand-mirrored from each DTO, matching how
  `packages/types` already hand-mirrors Prisma-derived domain shapes
  rather than generating them).
- **Components**: extends `packages/ui` (until now a single `Button`)
  with the genuinely reusable primitives every module's screens need —
  `Table`, `Badge`, `Input`, `Select`, `Textarea`, `Dialog`,
  `ConfirmDialog`, `EmptyState`, `ErrorState`, `Skeleton`, `Pagination` —
  rather than building one-off admin-local copies, so `apps/storefront`
  (CP-020) inherits them for free instead of re-inventing the same
  primitives a second time.

### 5. Money and status vocabulary: reuse `@iecp/types`, never re-derive

`Money.formatToman()` (already shipped, `packages/types/src/money.ts`)
is the only place amounts are ever formatted — the admin frontend
reconstructs a `Money` from each DTO's `{amount, currency}` JSON shape
and calls `.formatToman('fa-IR')`, never re-implementing Persian-locale
number formatting. Every status badge (order/fulfillment/shipment/
product/return/settlement) reads its color/label from a small lookup
keyed by the exact string-union types `packages/types/src/enums.ts`
already exports (`OrderStatus`, `FulfillmentStatus`, ...) — adding a new
backend status value without updating the frontend badge map is a
TypeScript compile error, not a silent "unknown" render, because the
lookup is typed as `Record<OrderStatus, ...>` (exhaustive).

### 6. Token storage: access token in memory, refresh token in `localStorage`

The backend's refresh tokens are already opaque, hashed, revocable
per-device rows (`identity/README.md`'s "Why refresh tokens aren't
JWTs"), and `POST /auth/logout` already revokes one by value — so
`localStorage` storage for the refresh token is bounded by the backend's
own revocation model, not by hoping XSS never happens. The **access**
token itself is kept in a module-level JS variable only (never
persisted) — an XSS payload that can read `localStorage` can already
call the API as the logged-in user regardless of where the access token
lives, so this doesn't claim to defend against XSS; it only avoids
leaving a live, un-revocable bearer credential sitting in storage for a
same-origin script to find after the tab closes. This is the explicit,
justified exception Phase 4's own instruction anticipates ("no tokens in
localStorage unless architecture explicitly requires and justifies it")
— httpOnly cookies were considered and rejected because `services/api`
and `apps/admin` are deliberately separate origins/ports in this
monorepo's dev and deploy model (no shared parent domain to scope a
cookie to without introducing a proxy this phase doesn't otherwise need).

### 7. Observability: a real error boundary + reporter interface, no live third-party wiring

`P018`'s `observability_requirements` calls for "frontend error tracking
wired (new capability for this repo)." No third-party error-tracking
service is reachable from this sandbox (the outbound proxy denies
unlisted hosts — the same constraint CP-008/CP-017 already hit and
documented for their own provider integrations), so this phase ships the
real, structural half — a root `ErrorBoundary` around the authenticated
shell, a small `reportError(error, context)` interface, and a console-
based implementation that never logs tokens/passwords/OTP codes/PII
beyond the current route — and documents wiring a real provider (Sentry
or equivalent) behind that same interface as a staging task, the same
"real code, unverified live network path" pattern already established
for ZarinPal (`P1-6`). Recorded as new gap `P1-9`
(`docs/product/gap-priority-matrix.md`), not silently treated as done.

## Non-goals (explicit)

- Role/permission/user/session/API-key/audit-log administration UI (see
  "Conflict found and resolved," above).
- Dashboard KPI widgets — no backend aggregate/metrics endpoint exists to
  back one honestly, and `P018` never lists a dashboard among its five
  deliverables; inventing client-side aggregation over paginated list
  endpoints would violate "no business-critical data hardcoded/invented
  in the frontend." The landing page after login is a permission-aware
  set of links into the real modules, nothing invented.
- Global search — not in `P018`'s deliverables list; no backend
  cross-module search endpoint exists to back it.
- CSRF token handling — this API is a pure Bearer-token JSON API (no
  cookie-based session ever set for `services/api` itself), so CSRF (an
  attack against ambient cookie auth) does not apply; documented in
  `docs/security/admin-panel-security.md` rather than silently omitted.
- Live third-party error-tracking wiring (see Decision 7).
- Storefront/PWA/mobile changes — untouched.

## Consequences

- `packages/ui` becomes a real, if still small, shared component library
  — every future frontend phase inherits it.
- The admin frontend's own test suite (component + e2e smoke) is the
  first frontend test suite in this repository; its shape (Playwright
  for e2e, matching `docs/product/phase-governance.md`'s "no mocks for
  infrastructure behavior" applied to the frontend — a real running API
  - real Postgres/Redis behind the smoke tests, not a mocked fetch) is
    the template CP-020/CP-022 inherit.
- The RBAC-administration gap this ADR documents needs an owner —
  recorded in `docs/product/gap-priority-matrix.md` as a new item this
  phase's own audit adds, not assigned to a phase without evidence that
  phase actually intends to own it.
