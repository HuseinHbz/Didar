# Admin Panel MVP (CP-018)

Scope doc, matching the shape every phase since CP-005 has produced.
Architecture rationale and the roadmap-vs-`blueprint.md` conflict this
phase found and resolved: see
[`../adr/ADR-018-admin-panel-architecture.md`](../adr/ADR-018-admin-panel-architecture.md).

## Mission

Give the operations team a real UI over the eight backend modules
already hardened by CP-004 through CP-013: log in, see and act on
catalog products, inventory adjustments/transfers, orders/fulfillment/
shipments, and returns/settlements — every action authorized exactly the
same way the API already authorizes it, with nothing new invented on the
backend.

## Canonical requirements (verbatim source: `docs/roadmap/master-roadmap-v2.md` `P018`)

```
objective: Build the first real business features in apps/admin,
  covering the operator workflows the 8 backend modules already support
  end-to-end (catalog management, inventory adjustment, order/fulfillment
  view, return/settlement review once P015 lands).
dependencies: [P015, P016]
deliverables:
  - Auth flow against modules/identity (login, 2FA)
  - Permission-aware navigation (hide/disable actions the logged-in role
    can't perform, matching the existing RBAC matrix — never a second
    source of truth for permissions)
  - Order/fulfillment/return operator views
  - Inventory adjustment/transfer views
  - Catalog product/variant/SKU management views
acceptance_criteria:
  - Every admin action in the UI maps to a real, already-existing,
    already-tested backend route — no new backend business logic invented
    to support the UI
  - No business-critical data hardcoded in the frontend (permission
    matrix, prices, statuses all fetched from the API)
security_requirements:
  - UI-side permission checks are cosmetic only — the backend's existing
    RBAC remains the actual enforcement (defense in depth, not the only
    layer)
database_requirements: []
testing_requirements:
  - Component tests for permission-aware rendering
  - E2E smoke tests for the critical operator flows (approve return,
    adjust stock, view order)
observability_requirements:
  - Frontend error tracking wired (new capability for this repo)
documentation_requirements:
  - apps/admin/README.md rewritten from scaffold-description to real
    feature description
```

## Scope matrix

| Requirement | Canonical | Existing before this phase | Missing | Action taken |
| --- | --- | --- | --- | --- |
| Auth flow (login, 2FA) | Yes, listed deliverable | Backend: `POST /auth/login`, `POST /auth/2fa/verify`, `POST /auth/refresh`, `POST /auth/logout(-all)` (CP-004) — real, tested. Frontend: none. | Frontend login/2FA pages | **Implemented** — `(auth)/login` |
| Permission-aware navigation | Yes, listed deliverable | Backend: `GET /me/permissions` (CP-004) — real, tested. Frontend: none. | Frontend nav gating | **Implemented** — `AppShell` reads `/me/permissions` once per session, memoized |
| Catalog product/variant/SKU views | Yes, listed deliverable | Backend: full CRUD + lifecycle (CP-005) — real, tested. Frontend: none. | Frontend list/detail/actions | **Implemented** — `/catalog/products` |
| Inventory adjustment/transfer views | Yes, listed deliverable | Backend: full CRUD + workflow (CP-006) — real, tested. Frontend: none. | Frontend list/create/actions | **Implemented** — `/inventory/adjustments`, `/inventory/transfers` |
| Order/fulfillment/return operator views | Yes, listed deliverable | Backend: full admin surface (CP-009/011/012/013) — real, tested. Frontend: none. | Frontend list/detail/actions | **Implemented** — `/orders`, `/returns` (incl. settlements) |
| Role/permission/user/session/API-key/audit-log admin UI | **No** — not in `P018`'s deliverables list; only present in the superseded `blueprint.md` §51-55 vision | Backend: full CRUD (CP-004) — real, tested, unused by any UI | Frontend entirely | **Out of scope** (category F: incorrectly assumed in-scope by `apps/admin/README.md`'s stale pre-CP-018 text, corrected this phase) — see ADR-018. No phase currently owns building it; flagged as a new, honest gap. |
| Dashboard KPIs / global search | Implied by `blueprint.md`, **not** in `P018` | None | N/A | **Out of scope** — no backend aggregate/search endpoint exists to back one honestly; would violate "no business-critical data hardcoded/invented in the frontend" |
| Live third-party error-tracking service | `observability_requirements` calls for it | None | Real provider wiring | **Partially implemented** — real `ErrorBoundary` + `reportError()` interface shipped; live provider (Sentry/equivalent) unreachable from this sandbox (same class of gap as P1-6/P1-8), documented as a staging task, not faked |

## Non-goals (explicit, this phase)

- Storefront (`apps/storefront`), PWA (`apps/pwa`), mobile (`apps/mobile`)
  — untouched, CP-020/CP-022's own scope.
- Any new backend route, use case, or migration — `database_requirements: []`
  is taken literally; zero schema changes this phase.
- RBAC administration UI, dashboard, global search, live error-tracking
  provider — see Scope matrix above.
- CP-017's own SMS/OTP customer flow — admin auth is the separate
  password+2FA path (CP-004), not touched by this phase.

## Dependencies

`CP-015` (VALIDATED, merged to `develop`) and `CP-016` (VALIDATED,
unmerged) — both satisfy phase-governance's "≥ IMPLEMENTED" Definition-
of-Ready bar. **Not** `CP-017` — the canonical dependency graph never
lists it, and this phase's own branch is cut from
`16-feature-platform-reliability`'s tip specifically to avoid pulling in
CP-017's own not-yet-`VALIDATED` work, matching this phase's own
non-negotiable rule 19 ("do not change CP-017's status unless CP-017
evidence is actually revalidated") by simply not touching it at all.

## Acceptance criteria (restated as verifiable checks)

1. Every button/action in the admin UI calls an endpoint that existed,
   RBAC-gated, before this phase started — verified by the evidence
   table in `docs/product/phase-018-audit.md`.
2. No permission list, price, or status vocabulary is hardcoded in the
   frontend — permissions come from `GET /me/permissions`; prices come
   from each DTO's own field, formatted via `Money.formatToman()`;
   statuses are typed against `@iecp/types`'s own string-union exports.
3. A logged-out request to any `(app)/*` route redirects to `/login`; a
   logged-in request without a given permission never sees that
   action's button — proven by a real, unmocked 403 from the API when
   the same route is hit directly (component test), not merely a hidden
   button (this phase's own Phase 8 rule: "a test that only checks a
   button is hidden is NOT an authorization test").
4. `pnpm --filter @iecp/admin build` produces a real production bundle.
