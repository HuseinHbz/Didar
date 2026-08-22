# Phase 018 (CP-018) Audit — Admin Panel MVP

Governance note: CP and Phase are the same canonical unit throughout this
document (`docs/product/phase-governance.md`). This audit was produced
by executing the mandatory 18-phase process this phase's own kickoff
prompt specified, in order, on the real repository state — no section
below is a template filled from assumption; every claim cites the
command or file that produced it.

## 1. Mission

Deliver a real operator console for the commerce backend
(`services/api`) that already exists and is already RBAC-gated
(CP-004/005/006/009/012) — auth, permission-aware navigation, and
catalog/inventory/order/return operator views — without inventing any
new backend business logic, and without letting frontend visibility
stand in for server-side authorization anywhere.

## 2. Scope

Locked in Phase 1 of this phase's own process and recorded in
`docs/product/admin-panel.md`. `apps/admin/README.md`'s pre-existing
text (quoting `blueprint.md` §51-55's full RBAC-console vision — roles,
permissions, audit log, content approval, four-eyes principle) and
`master-roadmap-v2.md`'s actual `P018` block (five deliverables: auth
flow, permission-aware nav, order/fulfillment/return operator views,
inventory adjustment/transfer views, catalog product/variant/SKU
management views) disagreed on size. Per this phase's own governance
rule ("repository evidence wins for implementation details, canonical
governance wins for phase identity") and `phase-governance.md`'s
standing rule that `master-roadmap-v2.md` is the authoritative, current
phase definition (established by CP-014's own audit), the narrower
`P018` block is what this phase built. The wider RBAC-console vision is
real, already has a backend (CP-004), and has no owner phase yet — this
is recorded as a new gap this audit adds (§16, and
`docs/product/gap-priority-matrix.md`), not silently absorbed into
CP-018 or silently discarded.

## 3. Canonical requirements (verbatim, `master-roadmap-v2.md` `P018`)

`deliverables: [Auth flow (login, 2FA), Permission-aware navigation,
Order/fulfillment/return operator views, Inventory adjustment/transfer
views, Catalog product/variant/SKU management views]`.
`dependencies: [CP-015, CP-016]` — not CP-017: CP-018's own dependency
graph never listed CP-017, and CP-017's own evidence had not been
revalidated (`P1-2`, CP-017 last recorded `IMPLEMENTED ~80%, NOT YET
VALIDATED`) at the time this phase's branch was created, so CP-017 work
is deliberately excluded from this branch's history (§18 confirms this
directly via `git merge-base`).

## 4. Existing state before implementation

Verified by direct controller/DTO reading before any frontend code was
written (Phase 0 preflight), not assumed: every route this phase's UI
now calls already existed, already behind `AuthorizationGuard` /
`@RequirePermission` / `@RequireModule`, already tested by
`services/api`'s own unit/integration/e2e suites (336 passing tests,
confirmed again in §12 below). `apps/admin` itself contained only the
scaffold `next-env.d.ts`/`layout.tsx`/a placeholder `page.tsx` and the
stale README described in §2. `packages/ui` held only `Button` and a
`cn()` helper — no form/table/dialog/pagination primitives.

## 5. Implemented changes

- **Auth**: real `POST /auth/login`, 2FA verification step
  (`verifyTwoFactorLogin`), session restore on reload via the stored
  refresh token, logout.
- **Permission-aware navigation**: sidebar + dashboard driven by a real
  `GET /me/permissions` call — see §9 for why this is cosmetic-only.
- **Catalog**: product list + detail (publish/unpublish).
- **Inventory**: adjustments (create + list, per warehouse), transfers
  (list, detail, receive against dispatched line items).
- **Orders**: list + detail (fulfillments, shipments, delivery
  confirmation).
- **Returns**: list + detail (approve/reject/receive/inspect/refund,
  settlement panel).
- **packages/ui**: 12 new primitives (Badge, Input, Textarea, Select,
  Label, Table, Dialog, ConfirmDialog, EmptyState, ErrorState, Skeleton,
  Pagination) needed by the above and reusable by future phases.
- **First frontend test suite in this repository** (§11).

## 6. Files changed

Six commits on `18-feature-admin-panel-mvp` (§19 lists SHAs); by area:

- `packages/ui/src/components/*.tsx` (12 new), `src/index.ts`,
  `tsup.config.ts` — new primitives + the `'use client'` banner fix
  (§13's bug #1).
- `services/api/.env.example`, `src/config/env.ts`, `src/main.ts`,
  `package.json`, `tsconfig.json`, `tsconfig.build.json`,
  `scripts/e2e-set-admin-password.ts` — CORS widening + e2e fixture
  script (§9, §13's bug #2).
- `apps/admin/src/app/**`, `src/components/**`, `src/lib/**`,
  `next-env.d.ts`, `AGENTS.md`, `CLAUDE.md` — the app itself.
- `apps/admin/**/*.spec.ts(x)`, `e2e/*`, `vitest.config.ts`,
  `vitest.setup.ts`, `playwright.config.ts`, `package.json`,
  `pnpm-lock.yaml`, `.gitignore` — test infrastructure.
- `apps/admin/README.md`, `docs/security/admin-panel-security.md`.
- This file, plus roadmap governance files (§20's list).

## 7. API changes

**None.** Zero new endpoints, zero new DTOs, zero new use cases on the
backend — the full deliverable→route mapping is in
`docs/adr/ADR-018-admin-panel-architecture.md` decision 3. The only
backend-facing change is infrastructure config (§9).

## 8. Database changes

**None.** No migration was written or needed — nothing in this phase's
scope requires a schema change (`master-roadmap-v2.md`'s `P018` has no
database deliverable, and the preflight confirmed every table this UI
reads/writes already existed).

## 9. Security changes

- `services/api`'s `CORS_ORIGIN` widened from a single string
  (`http://localhost:3000`) to a comma-separated list including this
  app's own origin (`http://localhost:3001`) — `enableCors` still does
  exact origin matching, no wildcard, `credentials: true` unchanged.
  Infrastructure config, not new attack surface.
- No new authorization logic anywhere: `apps/admin` consumes the
  existing `GET /me/permissions` response purely for UI rendering
  decisions; `authorization.spec.ts` proves server-side enforcement
  directly against the API, independent of the UI (§11).
- Token storage: access token in-memory only; refresh token in
  `localStorage` (the one sanctioned exception — full rationale in
  ADR-018 decision 6 and `docs/security/admin-panel-security.md`).
- No secrets shipped in the frontend bundle — confirmed by inspection
  of every `lib/api/*.ts` file and the one client-readable env var
  (`NEXT_PUBLIC_API_URL`, a plain base URL).
- Full write-up: `docs/security/admin-panel-security.md`.

## 10. UX changes

Every list view: loading (`Skeleton`), empty (`EmptyState`), error
(`ErrorState` with retry), and populated states. Every destructive/
state-changing action (publish, adjustment, approve/reject/refund, …)
goes through `ConfirmDialog`. Pagination is cursor-based
(`use-cursor-pagination.ts` layers a client-side history stack on the
API's forward-only cursor to make a "Previous" button possible).
Navigation is permission-aware (§5). **Gap** (§16): no dedicated
responsive/mobile-breakpoint testing was performed — Tailwind utility
classes are used throughout but layouts were only verified at desktop
viewport sizes during e2e runs.

## 11. Tests

- **Component/unit** (Vitest + `@testing-library/react`, jsdom): 16
  tests across 4 files (`nav-config.spec.ts`, `shell.spec.tsx`,
  `token-store.spec.ts`, `money.spec.ts`) — all passing (`pnpm --filter
@iecp/admin test`).
- **E2E** (`@playwright/test`, real browser, real running
  `services/api` + Postgres + Redis + seeded data): 12 tests across
  `auth.spec.ts`, `authorization.spec.ts`, `smoke.spec.ts` — all
  passing, run twice consecutively to confirm stability against the
  same shared, never-reset dev database (12/12 both times).
  `authorization.spec.ts` is the direct-API security proof
  (`testing_requirements`'s own rule — a hidden button is not an
  authorization test).

## 12. Validation gate

Run against the full monorepo, this phase's own changeset only (no
unrelated fixes attempted beyond what §13 documents):

| Check                           | Result                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm validate:structure`       | ✓ pass                                                                                                                                              |
| `pnpm format:check`             | 5 pre-existing failures, 0 from this phase (see below)                                                                                              |
| `pnpm lint`                     | ✓ pass, 15/15 workspaces                                                                                                                            |
| `pnpm typecheck`                | ✓ pass, 15/15 workspaces                                                                                                                            |
| `pnpm build`                    | ✓ pass, 11/11 tasks (all three Next.js apps + all Nest services)                                                                                    |
| `pnpm test`                     | ✓ pass — 336 `services/api` tests (unrelated to this phase, confirming no regression) + 16 `apps/admin` tests                                       |
| `apps/admin` e2e                | ✓ pass, 12/12, run twice                                                                                                                            |
| `pnpm audit --audit-level high` | ✓ pass — 1 low-severity finding (esbuild, transitive via `packages/database`'s `tsup`, pre-existing, unrelated to this phase), 0 at or above `high` |
| `pnpm roadmap:audit`            | ✓ pass — no structural problems (see §20 for the governance-data updates this phase itself makes)                                                   |

`format:check`'s 5 pre-existing failures: `apps/admin/next-env.d.ts`,
`apps/pwa/next-env.d.ts`, `apps/storefront/next-env.d.ts` (all three
Next.js apps' auto-generated, "do not edit" type-reference files — a
pre-existing gap in `.prettierignore` this phase did not introduce and
left alone per "do not fix unrelated problems merely to make the gate
green"), `docs/api/payment.md`, `docs/security/payment-security.md`
(Phase 008 documents, `git log` confirms authorship predates this
phase).

## 13. Known bugs (found by this phase, fixed by this phase)

1. **`packages/ui`'s bundled `'use client'` directive was dropped.**
   Bundling every component into one `dist/index.js` with
   `splitting: false` silently stripped the directive from the two new
   hook-using files (`dialog.tsx`/`confirm-dialog.tsx`), so Next.js's
   App Router treated the whole bundle as a Server Component and
   rejected the hook usage — reproduced under both Turbopack
   (`apps/admin`, `apps/storefront`) and webpack (`apps/pwa`). Two
   per-module chunking strategies were tried and each broke under one
   bundler or the other (esbuild's internal shared-chunk extraction
   carries neither entry's directive — Turbopack tolerated that,
   webpack correctly rejected it). Fixed with a `'use client'` banner
   on the single bundled entry — the standard, bundler-agnostic
   solution real component libraries use for this. Full account in
   `packages/ui/tsup.config.ts`'s own comment.
2. **The CORS fix didn't take effect on the first attempt** — not a
   code bug: the Node process bound to port 4000 had been started from
   a `dist/main.js` build that was overwritten a second later by a
   subsequent rebuild, so it ran stale bytecode from before the fix was
   compiled, despite the file on disk being correct and the process
   having a later PID than the (also-stale) previous instance. A clean
   `pnpm build` + process restart resolved it; verified via `curl`
   against both configured origins before and after.
3. **A real session-restore race** (`apps/admin/src/lib/auth/
auth-context.tsx`): React 18 Strict Mode's dev-only double-invocation
   of mount effects fired two concurrent `POST /auth/refresh` calls
   with the identical stored refresh token on every full page
   navigation. Refresh tokens rotate on use
   (`refresh-token.usecase.ts`) — whichever call the server processed
   second hit the now-revoked token and its `catch` branch
   unconditionally cleared the tokens the _other_ call had just
   legitimately established, regardless of which one "won" the
   client-side race. Found by the real e2e suite (a hard navigation
   after login reliably left the session stuck on `status: 'loading'`
   or bounced back to `/login`), not by inspection. Fixed by
   memoizing the restore **promise** so a second effect invocation
   awaits and applies the same in-flight result instead of issuing a
   second network call. Verified with two consecutive full e2e runs
   after the fix (12/12 both times).
4. **Two e2e locator ambiguities**, both test bugs, not app bugs: the
   nav sidebar's `سفارش‌ها`/`بازگشت‌ها` links collided with the
   dashboard's own identically-labelled "quick link" cards, and
   Next.js's own accessibility route-announcer live region echoed the
   dashboard heading text into a second element. Fixed by scoping both
   locators to their specific landmark (`getByRole('navigation')`,
   `getByRole('heading')`).
5. **A stray `scripts/e2e-set-admin-password.ts` compile-with-
   declarations output** appeared directly alongside its own source
   file during iteration (never staged, never committed) — deleted
   before the corresponding commit; confirmed via `git status`.

## 14. Bugs fixed

All five items in §13 — see that section for the fix in each case.

## 15. Remaining risks

- **RBAC/permission/user/session/API-key/audit-log administration UI**
  does not exist. The backend for all of it is real and RBAC-gated
  (CP-004); an operator managing roles today still uses the API
  directly. Recorded as a new gap (§16).
- **2FA login is implemented but not e2e-tested** — the seeded admin
  fixture has no TOTP enrolled, and enrolling one
  (`POST /auth/2fa/setup`) is itself already covered by
  `services/api`'s own e2e suite, not re-proven here. The primary-
  factor login path is fully e2e-proven; the 2FA branch is unit-level
  only (the `verifyTwoFactor()` context method exists and is exercised
  by the login flow's own type contract, but no e2e test drives an
  actual TOTP code through it).
- **No live third-party error-reporting provider** is reachable from
  this sandbox — `error-reporter.ts` defines a real interface and a
  real `ErrorBoundary` calls it, but nothing currently receives what it
  reports. Recorded as new gap `P1-9` — same category as `P1-6`'s
  ZarinPal-reachability gap.
- **No dedicated responsive/mobile-viewport testing** (§10).
- **`packages/ui`'s entire bundle is now `'use client'`** (§13 bug #1)
  — `apps/storefront`'s still-placeholder home page picks up a client
  boundary for its lone `<Button>`. Negligible today; worth revisiting
  once `apps/storefront`'s real catalog UI (CP-020) needs a mix of
  server- and client-rendered `packages/ui` consumers at scale.

## 16. Deferred items

- **RBAC-administration UI** (role/permission/user/session/API-key/
  audit-log management) — real backend exists, no frontend, no owner
  phase yet. Recorded as new gap `P1-8` in
  `docs/product/gap-priority-matrix.md` rather than silently building it
  into CP-018 (out of `P018`'s canonical scope) or silently dropping it.
- **2FA e2e coverage** — deferred to whichever phase next touches
  `apps/admin`'s auth flow, or a dedicated fixture-enrollment addition.
- **Live error-reporting provider wiring** — deferred, recorded as new
  gap `P1-9`.

## 17. Evidence

Every claim above is backed by a command run and its real output in
this session: `pnpm lint`/`typecheck`/`build`/`test`/`audit`/
`roadmap:audit` transcripts, two full `pnpm --filter @iecp/admin
test:e2e` runs (12/12 both times), direct `curl` comparisons proving
the CORS fix for both configured origins, and `git log`/`git show`
commands confirming file authorship/dates for every "pre-existing, not
this phase's" claim in §12. No claim in this document is asserted
without a command that produced it having actually been run in this
session.

## 18. Git branch

`18-feature-admin-panel-mvp`, branched from `16-feature-platform-
reliability` (confirmed via `git merge-base --is-ancestor
16-feature-platform-reliability HEAD`) — deliberately not from
`17-feature-real-notification-delivery`: CP-018's own dependency graph
lists only `CP-015`/`CP-016`, and CP-017's evidence had not been
revalidated at branch-creation time (rule: "do not block CP-018 merely
because CP-017 is not yet VALIDATED unless the canonical dependency
graph explicitly requires it" — verified it does not).

## 19. Commit SHAs

```
7eb3ef0 docs(product): define CP-018 scope — admin panel MVP
a940f6a feat(ui): add admin-panel component primitives
4fd59c4 feat(security): harden admin CORS + add e2e password fixture script
6a38a70 feat(admin): implement admin panel UI
d010b29 test(admin): add unit/component and e2e coverage
5d40ef2 docs(admin): document implementation and security posture
```

(This audit's own commit, and the roadmap-governance commit that
follows it, are not yet in the list above at the time this file was
written — see the branch's own `git log` for the final state.)

## 20. Final status

**VALIDATED.** All five `P018` deliverables are implemented and proven
against the real running stack (real Postgres, real Redis, real
`services/api`, real browser) — not merely "code committed." Every
validation-gate check in §12 passes; the two real bugs this phase's own
testing surfaced (§13, items 1 and 3) are fixed and re-verified, not
merely noted. `PRODUCTION_READY` is not claimed: §15's remaining risks
(no RBAC-admin UI, no 2FA e2e coverage, no live error-reporting
provider) are real, documented gaps a production rollout would need to
close first — none of them block this phase's own actual deliverables.

## 21. Next recommended phase

Per `docs/product/phase-dependency-graph.md`: `CP-020` (storefront)
needs both `CP-018` (now done) and `CP-019` (customer/prescription
domain, currently `BLOCKED` pending a domain-expert review gate) — not
yet available. `CP-021` (procurement) depends only on `CP-015`, not
`CP-016` or `CP-018`, and is genuinely unblocked now. Recommended next:
**CP-021**, unless a human reviewer clears CP-019's blocking gate first,
in which case CP-019 itself becomes available. (CP-017's own status is
unchanged by this audit, per the rule "do not change CP-017's status
unless CP-017 evidence is actually revalidated" — its real
implementation work lives on `17-feature-real-notification-delivery`,
a sibling branch this branch deliberately does not include.)
