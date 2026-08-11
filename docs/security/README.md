# Security

Full target checklist: [`docs/product/blueprint.md`](../product/blueprint.md)
§55-§56, §100, §104, §111-§113. This document tracks what's **actually in place**
in the scaffold today versus what's still aspirational — don't assume anything
below marked "not yet" is covered just because the blueprint calls for it.

## In place today

| Control | Where |
| ------- | ----- |
| `helmet()` security headers | `services/api/src/main.ts` |
| CORS restricted to a configured origin | `services/api/src/main.ts` (`CORS_ORIGIN` env var) |
| Request body whitelisting (unknown fields rejected, not dropped) | `ValidationPipe` in `services/api/src/main.ts` |
| Env vars validated at startup, fail-fast | `@iecp/validation`'s `parseEnv()`, used by every service's `src/config/env.ts` |
| Secrets never committed | `.env` gitignored everywhere; every service ships an `.env.example` instead |
| `no-explicit-any` / `no-unsafe-*` hard-errored | `@iecp/eslint-config/base` — reduces a whole class of type-confusion bugs that turn into security bugs |
| Admin panel not indexed | `robots: { index: false, follow: false }` in `apps/admin`'s root layout |
| Dependency versions pinned exactly (no `^`/`~` ranges) | every `package.json` in the monorepo |

## Not yet — explicitly open

- **Authentication** — no auth exists anywhere in `services/api` yet. Every
  current endpoint is unauthenticated (see `docs/api/README.md`).
- **RBAC / permissions** — blueprint §53's fine-grained permission model
  (`Product.Publish`, per-action, per-role) isn't built.
- **Rate limiting** — `infrastructure/nginx/nginx.conf` has one blanket
  `limit_req_zone`; nothing per-route, nothing at the application layer.
- **2FA, device sessions, login-attempt tracking** — blueprint §55/§56, not
  started.
- **Audit log** — blueprint §54 (who changed what, old value → new value) — not
  started. This matters a lot once real price/inventory-changing endpoints exist.
- **Four-eyes / approval workflows** for sensitive actions (blueprint §57-§58,
  §105) — not started.
- **Dependency/secret/container scanning in CI** — `.github/workflows/ci.yml`
  runs lint/typecheck/build only; no `npm audit`/SCA/Trivy/secret-scan step yet
  (blueprint §112-§113).
- **OWASP ASVS / Top 10 review** — not performed. Do this before any endpoint
  handles real customer data or payment.

## Rule for every future PR touching `services/api`

If you're adding a write endpoint (`POST`/`PATCH`/`PUT`/`DELETE`) and it isn't
behind an auth guard, that's a bug, not a TODO — either add the guard or don't
merge the endpoint. The "not yet" list above is fine for what exists today
(read-only, no real data); it stops being fine the moment there's something
worth stealing or corrupting behind these routes.
