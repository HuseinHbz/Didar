# Admin panel security (CP-018)

This document is `docs/security/README.md`'s service-wide security posture,
expanded for the one thing CP-018 actually adds: a browser-based operator
console (`apps/admin`) speaking to `services/api` over a second CORS origin.
Companion to `docs/adr/ADR-018-admin-panel-architecture.md` (full architecture
account) and `docs/product/admin-panel.md` (scope).

## The one rule this whole document is a restatement of

**Frontend visibility is not authorization.** `apps/admin`'s
`useAuth().hasPermission()` / `hasModuleAccess()` — backed by a real call to
`GET /me/permissions` — decide only what the sidebar and page-level "New …"
buttons *render*. They decide nothing about what `services/api` *allows*.
Every mutation this app can trigger passes through the exact same
`AuthorizationGuard` / `@RequirePermission(...)` / `@RequireModule(...)`
decorators any other client (a future mobile app, a direct API caller, a
malicious script) would hit — this app invented none of that machinery
(CP-004 built and RBAC-gated every route this phase's UI calls; see ADR-018
decision 3's full mapping table). Concretely, this means: hiding the
"تعدیل جدید" (new adjustment) button from a user without `inventory.adjust`
is a UX courtesy, not a security control — the real control is the backend
guard that would 403 the same `POST /admin/inventory/adjustments` call if
issued directly, with or without a button in front of it.

## Proof, not assertion: `e2e/authorization.spec.ts`

`testing_requirements`'s own rule, applied literally: *"a test that only
checks that a button is hidden is NOT an authorization test. Test the API
directly."* This suite never opens a browser page — it uses Playwright's
`request` fixture to call `services/api` directly, bypassing the UI
entirely:

- No token at all → `401`, not data.
- A garbage/malformed bearer token → `401`, not a `500` or a silent
  pass-through.
- **Vertical privilege escalation**: the `catalog_editor` fixture (confirmed,
  via its own real `GET /me/permissions` call in the same test, to *not*
  hold `catalog.products.publish`) gets a real `403` from
  `POST /admin/catalog/products/:id/publish` — never a `200`.
- **Module-level bypass**: the same fixture (no order/return module access)
  gets `403` from `GET /admin/orders` and `GET /admin/returns`.
- **Not a global lockout**: the `admin` fixture (which *does* hold
  `order.read`) gets a real `200` from the identical route — proving the
  403s above are a permission check, not every non-superuser being rejected.

## Token storage

- **Access token**: a module-level JS variable (`lib/auth/token-store.ts`) —
  never written to `localStorage`, `sessionStorage`, or a cookie. Lost on
  every reload; restored via one silent `/auth/refresh` call on app mount.
- **Refresh token**: `localStorage`. This is the one place this app departs
  from "no tokens in localStorage," and it's a deliberate, scoped exception
  (ADR-018 decision 6), not an oversight: refresh tokens in this system are
  opaque random strings, hashed at rest (`sha256Hex`, never the raw value)
  and matched against a `Session` row — not JWTs, not self-verifying, and
  fully revocable server-side (logout, or an operator revoking a session).
  A stolen refresh token from `localStorage` (via XSS) is a real risk this
  doesn't eliminate, but it's a *revocable* one, not a standing forged
  credential — the same tradeoff `services/api`'s own identity module
  already made for every other client before this phase existed.

### A real session-restore bug this phase found and fixed

Refresh tokens **rotate**: every `/auth/refresh` call revokes the presented
token and issues a new one (`refresh-token.usecase.ts`'s own doc comment —
"a stolen-then-reused refresh token is single-use: whoever redeems it first
wins"). React 18's Strict Mode double-invokes mount effects in dev
(`next dev`) — mount, cleanup, mount again, synchronously, before either
async call resolves. The first implementation of `AuthProvider`'s
session-restore effect fired **two concurrent `/auth/refresh` calls** with
the identical stored token on every full page load. Whichever the server
processed second hit the now-revoked token, threw, and its `catch` branch
unconditionally called `clearTokens()` — wiping out the *other* call's
freshly-established, valid session, regardless of which one "won" the
client-side race. Caught by the real e2e suite (a hard page navigation
after login reliably left the session stuck on `status: 'loading'` or
bounced back to `/login`), not by inspection. Fixed by memoizing the
restore **promise** itself (`auth-context.tsx`) so a second effect
invocation awaits and applies the same in-flight result instead of issuing
a second `/auth/refresh` call — the actual network call now fires at most
once per real page load, immune to Strict Mode's phantom remount. Verified
by two consecutive full runs of the Playwright suite (12/12 both times)
after the fix.

## CORS: the one backend change this phase made

`services/api`'s `CORS_ORIGIN` was a single string
(`http://localhost:3000`, the storefront's own origin). This app is a
second legitimate browser origin (`http://localhost:3001`) — widened to a
comma-separated list, split in `main.ts`'s `enableCors({ origin: [...] })`.
This is infrastructure config, not new attack surface: `enableCors` still
does exact origin matching (no wildcard, no reflected-origin-without-
allowlist pattern) and `credentials: true` was already set before this
phase. No new cross-origin trust was granted beyond "this app's own origin
may also send credentialed requests," which is exactly what a second
first-party frontend needs.

## No secrets in the frontend bundle

`apps/admin` ships no API keys, no signing secrets, no service credentials
— `NEXT_PUBLIC_API_URL` (the only env var this app reads client-side) is a
plain base URL, not a secret. The ZarinPal/Kavenegar/encryption-key
secrets `services/api` holds never cross into this app; nothing in
`lib/api/*.ts` embeds a credential.

## Audit trail: WHO/WHAT/WHEN/WHERE/TARGET/OLD→NEW/RESULT

This app introduces no new audit-logging code — every mutation it issues
(publish a product, create an adjustment, approve a return, confirm
delivery, …) lands on a pre-existing `services/api` route that already
writes to the identity module's `AuditLog`/`SecurityEvent` tables
(CP-004), keyed by the real authenticated user, IP, and user-agent the
request carried — the same trail any other client's call to the same
route produces. This phase adds no second logging framework and
introduces no path that bypasses it: there is no direct-database write,
no admin-only shortcut route, anywhere in `apps/admin`'s API layer.

## What this phase does *not* cover

- **Role/permission/user/session/API-key/audit-log administration UI.**
  The backend for all of it exists and is RBAC-gated (CP-004); no admin
  frontend for it exists yet, by explicit scope decision — see
  `docs/product/admin-panel.md`'s scope matrix. An operator managing roles
  today still uses the API directly.
- **CSRF.** Not applicable to this app's actual auth model: no cookie-based
  session exists to forge a request against — the bearer access token is
  attached explicitly in an `Authorization` header by this app's own
  fetch wrapper (`lib/api/client.ts`), which a cross-site page cannot do on
  a victim's behalf without already having read the token out of this
  app's JS memory (at which point CSRF is not the relevant threat model).
- **A reachable third-party error-reporting provider.** `error-reporter.ts`
  defines a real `reportError()` interface and a real `ErrorBoundary` that
  calls it, but no live provider (Sentry or equivalent) is reachable from
  this sandbox — same class of gap ADR-018 decision 7 documents, and the
  same one earlier phases (P1-6/P1-8) already carry.
