# Integration: CP-018 into `develop`

**This is a governance/integration operation, not a new canonical phase.**
No new CP number, no roadmap rewrite, no phase renaming. It records exactly
what was merged into `develop`, why, and what evidence backs the merge —
the same purpose `integration-reconciliation.md` served for CP-012/013/014
and `integration-cp016-cp021.md` served for CP-016/CP-021.

## Why this happened

After the CP-016+CP-021 integration, `develop` sat at `30cb1f3` while
CP-018 (Admin Panel MVP) remained fully implemented, VALIDATED (95%,
`docs/product/phase-018-audit.md`), and pushed on its own branch
(`18-feature-admin-panel-mvp`) but never merged — deliberately deferred by
that operation's own scope. Per this operation's explicit instruction,
**only CP-018 is merged here.** CP-017 (IMPLEMENTED, not VALIDATED — live
SMS delivery never verified against real network egress), CP-019
(BLOCKED on domain-expert review), CP-020 and CP-022 (both NOT_STARTED,
still missing satisfied dependencies) are untouched.

## Branch analysis (before merging)

- `git merge-base --is-ancestor origin/18-feature-admin-panel-mvp
origin/develop` → `false` before this operation (confirming CP-018 was
  not yet on `develop`).
- Ancestry: `develop`(=CP-015) → CP-016 → {CP-017, CP-018} — CP-017 and
  CP-018 are siblings built on CP-016's tip, **not** stacked on each
  other (`git merge-base --is-ancestor origin/17-feature-real-notification-delivery
origin/18-feature-admin-panel-mvp` → `false`, and vice versa). CP-018's
  own `roadmap.json`, read from its branch tip, records its sole
  dependencies as CP-015 and CP-016 — both already on `develop` before
  this merge (CP-016 landed in the prior integration operation).
- `git log --oneline origin/16-feature-platform-reliability..origin/18-feature-admin-panel-mvp`
  — 7 commits (`5920d54`, `5d40ef2`, `d010b29`, `6a38a70`, `4fd59c4`,
  `a940f6a`, `7eb3ef0`).
- `git diff --stat origin/develop...origin/18-feature-admin-panel-mvp` (taken
  before merging, against `develop` as it stood after the CP-016+CP-021
  integration) — 80 files changed, 6512(+)/100(-), **zero** files under
  `packages/database/prisma/migrations/`. CP-018 is a zero-migration
  phase: it adds `apps/admin` (Next.js operator console), 12 new shared
  primitives in `packages/ui`, and a minimal `services/api` change (CORS
  origin widened from a single hard-coded origin to a comma-split
  allowlist, still not a wildcard — see Security Review below) plus
  `tsconfig(.build).json` `scripts/` path additions and a new
  `e2e:set-admin-password` npm script.

## VALIDATED status verification (`phase-governance.md`'s own criteria)

| CP     | Own branch's `roadmap.json` status | Own audit doc conclusion          | Evidence                                                                                                                                                               |
| ------ | ---------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CP-018 | `VALIDATED`, 95%                   | `phase-018-audit.md`: "VALIDATED" | Real operator UI over the pre-existing RBAC-gated backend; 12/12 Playwright e2e (auth, direct-API authorization, operator smoke) + 16/16 unit tests, on its own branch |

## Merge mechanics

```
git checkout develop                                # 30cb1f3 (post CP-016+021 integration)
git merge --no-ff --no-commit origin/18-feature-admin-panel-mvp
# conflicts: PROJECT_STATUS.md, docs/product/project-progress.md
# ... resolved, committed as 7f988a7, later amended to 12d55ac to fold in
# a prettier-formatting fix on docs/product/project-progress.md
```

**Conflicts, and how they were resolved:** the same recurring pattern as
the CP-016+CP-021 merge — `PROJECT_STATUS.md`'s header/summary block and
`docs/product/project-progress.md`'s "Planned phases" table had each been
independently edited by CP-018's branch from a single-phase perspective
(unaware of the CP-016+CP-021 integration that had already landed on
`develop`). Resolved conservatively: the combined header now states
CP-018 as the current phase alongside CP-016 and CP-021 (all three
merged), CP-018 is removed from the "still not started" table with a
cross-reference to `phase-018-audit.md`, CP-017/019/020/022 are left
exactly as their own evidence shows (no status invented or changed), and
the "Overall Progress"/`## Aggregate` counts were hand-recomputed (18 → 19
completed, 12 → 11 planned) since neither branch's own edit could see the
other's increment. `docs/product/roadmap.json`'s per-phase objects merged
automatically with zero conflict (CP-018's own object already correctly
showed `VALIDATED`, 95%, `branch=18-feature-admin-panel-mvp`); only its
scalar `aggregate` block needed the same by-hand fix, applied for the
third time this session using the identical procedure. No functionality
from CP-016 or CP-021 was lost — verified via `git status --short` after
the merge (only CP-018's own known files plus the two governance-doc
conflicts appeared) and via the post-merge validation gate re-confirming
both phases' own test suites still pass.

## Database verification

**No new migration exists for CP-018 to verify.** `packages/database/prisma/migrations/`
is unchanged by this merge (confirmed both by the pre-merge `git diff
--stat` above and by `git status --short` after merging — zero files
under that path). `prisma migrate status` against the sandbox's real,
continuously-reused Postgres instance (`iecp` database, same instance
reused since the start of this session — **not** rebuilt fresh for this
operation) reports: `12 migrations found in prisma/migrations` /
`Database schema is up to date!` — the same migration count as before
this merge, as expected for a zero-schema-change phase. This is
repository migration state plus a check against the existing reused
sandbox database, explicitly **not** a fresh-database verification — no
fresh-DB round-trip was performed for this operation because there is no
new migration to round-trip. (The one fresh-DB UP/DOWN/UP round-trip
performed this session was for CP-021's own single migration, recorded in
`phase-021-audit.md`; it remains valid and is not re-claimed here.)

## Full validation gate (run against the merged `develop`, real infrastructure)

| Check                                                                    | Result                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm validate:structure`                                                | ✓ pass — 14 workspaces, 5 infra dirs, 5 doc dirs, 9 root files                                                                                                                                        |
| `pnpm format:check`                                                      | ✓ pass on every file this operation touched (5 pre-existing, unrelated files still warn: 3 auto-generated `next-env.d.ts`, 2 payment docs — identical set flagged before this merge, unchanged by it) |
| `pnpm lint` (15 workspaces)                                              | ✓ pass                                                                                                                                                                                                |
| `pnpm typecheck` (15 workspaces)                                         | ✓ pass — `apps/admin` re-verified with a stale, gitignored `.next/` build cache removed first (see Notes below)                                                                                       |
| `pnpm build` (11 buildable workspaces, incl. `apps/admin`)               | ✓ pass                                                                                                                                                                                                |
| `pnpm test` (unit, all workspaces)                                       | ✓ pass — `@iecp/api` 353/353, `@iecp/admin` 16/16 (nav-config, money formatting, app-shell, token-store)                                                                                              |
| `pnpm audit --audit-level high`                                          | ✓ pass (1 pre-existing low-severity finding, 0 high)                                                                                                                                                  |
| `pnpm roadmap:audit`                                                     | ✓ pass — 0 structural problems; CP-016/CP-018/CP-021 all show `VALIDATED, branch=true`                                                                                                                |
| `prisma migrate status`                                                  | ✓ up to date — 12 migrations (unchanged by CP-018, see Database verification)                                                                                                                         |
| Full `services/api` e2e suite (220 cases), run 1                         | 219/220 — 1 pre-existing failure, see below                                                                                                                                                           |
| Full `services/api` e2e suite, run 2                                     | 218/220 — 2 pre-existing failures (1 recurring, 1 transient), see below                                                                                                                               |
| CP-018 Playwright e2e (`apps/admin`, 12 cases), run 1                    | ✓ 12/12                                                                                                                                                                                               |
| CP-018 Playwright e2e, run 2                                             | ✓ 12/12 — identical to run 1, no test-isolation or persistent-state problems across repeated runs                                                                                                     |
| Compiled app boot (`node dist/main.js`, real Postgres + real Redis)      | ✓ boots cleanly, all routes mapped (including the pre-existing admin/order/return/inventory routes CP-018's UI calls)                                                                                 |
| `GET /api/v1/health`                                                     | ✓ `{"status":"ok","info":{"database":{"status":"up"}},...}`                                                                                                                                           |
| `GET /api/v1/health/ready` (CP-016's split readiness endpoint)           | ✓ `{"status":"ok","info":{"database":{"status":"up"},"redis":{"status":"up"}},...}`                                                                                                                   |
| Auth: `POST /auth/login` with real seeded admin credentials              | ✓ `200`, real JWT issued                                                                                                                                                                              |
| Authorization: protected route with no token                             | ✓ `401`                                                                                                                                                                                               |
| Authorization: protected route with a malformed/garbage token            | ✓ `401`, not `500`                                                                                                                                                                                    |
| Authorization: protected route with a valid token holding the permission | ✓ `200`                                                                                                                                                                                               |
| Graceful shutdown (`SIGTERM`)                                            | ✓ process exits cleanly within 3s, no hang, no forced kill needed                                                                                                                                     |

### Pre-existing failures (not caused by this integration)

Identical to the two already classified during the CP-016+CP-021
integration — re-confirmed unchanged by re-running the full suite twice
against the CP-018-merged `develop`:

1. **`return-settlement-repository.e2e-spec.ts`'s 20-iteration
   `reconcileAll()` idempotency test** exceeds Jest's 5000ms default
   timeout in this sandbox. File's last edit predates CP-016, CP-018, and
   CP-021 (Phase 013, 2026-08-20). Not touched by this integration.
2. **`promotion-repository.e2e-spec.ts`'s concurrent-`reserve()` test**
   — the same transient, full-battery resource-contention flakiness
   already classified during CP-021's own validation and again during the
   CP-016+CP-021 integration; passes cleanly in isolation. CP-018 touches
   no promotion code.

No failure in either run is attributable to CP-018: CP-018 adds zero
backend business logic beyond the CORS widening, which is exercised
successfully by every e2e request in both suites (all of which depend on
CORS-independent direct HTTP/Playwright `request` calls, not
browser-origin-gated fetches, so this is also confirmed structurally, not
just by absence of new failures).

## Runtime verification notes

`apps/admin`'s own Playwright suite (`playwright.config.ts`) already
boots both `services/api` (port 4000) and `apps/admin` (port 3001) via
its `webServer` array and health-checks each before running, so the
12/12 pass (twice) already constitutes a live runtime proof of: admin
panel boot, backend boot, `/login` reachability, authenticated
navigation, and the full RBAC-gated operator flows (order/return/
inventory read and mutate). The additional manual boot
(`node dist/main.js`) and curl-based auth/RBAC/health checks above were
performed as an explicit, separate verification per this operation's own
instruction not to rely only on TypeScript compilation or on the
Playwright suite's implicit coverage.

## Security review

CP-018 adds no new backend business logic and no new data model — its
entire attack surface is (a) a browser client added on a second CORS
origin, and (b) that client's own auth/permission handling. Reviewed
against this operation's checklist:

- **Authentication boundaries / authorization / RBAC / privilege
  escalation**: enforced entirely by the pre-existing CP-004 backend
  (`AuthorizationGuard`, `@RequirePermission`/`@RequireModule`) — CP-018
  invented no new guard or permission-check mechanism. Proven live, not
  just by design review: `e2e/authorization.spec.ts` (part of the 12/12
  suite, re-run twice this pass) calls `services/api` directly via
  Playwright's `request` fixture — bypassing the UI entirely — and
  confirms a `catalog_editor` fixture (verified via its own real `GET
/me/permissions` call to lack `catalog.products.publish`) gets a real
  `403` from a publish attempt, and gets `403` from module-gated
  order/return reads, while the `admin` fixture (which does hold
  `order.read`) gets a real `200` on the same route — proving these are
  genuine permission checks, not a global lockout or a rubber-stamp
  pass-through. See `docs/security/admin-panel-security.md`'s "Proof, not
  assertion" section for the full account; re-verified live in this pass,
  not re-derived from documentation alone.
- **Admin-only endpoints / tenant/data isolation**: unchanged — CP-018
  calls only pre-existing, already-RBAC-gated admin routes; no new route
  was added to `services/api` by this phase.
- **Input validation / mass assignment / IDOR**: unchanged — all writes
  (stock adjustments, order/return actions) go through the same DTOs and
  domain validation CP-006/009/012/013 already enforce; the admin UI adds
  no parallel write path.
- **Sensitive data exposure / token storage**: the access token is held
  in a module-level JS variable (`apps/admin/src/lib/auth/token-store.ts`),
  never written to `localStorage`, `sessionStorage`, or a cookie — an
  explicit, documented tradeoff (lost on hard refresh, traded for XSS
  token-theft resistance) recorded in `docs/security/admin-panel-security.md`
  and `docs/adr/ADR-018-admin-panel-architecture.md`. Not re-litigated
  here; cited as existing evidence.
- **Audit logging**: every mutation CP-018's UI can trigger passes
  through the same backend routes CP-004's audit-log use cases already
  cover; CP-018 added no new mutation path that could bypass it.
- **Rate-limit dependency**: CP-018's `/auth/login` call rides on the
  same un-rate-limited endpoint every other client already uses (P1-1,
  gap-priority-matrix.md — pre-existing, explicitly deferred by CP-016's
  own non-goals, not introduced or worsened by CP-018).
- **Secrets/configuration handling**: no new secret introduced. The one
  config change, `CORS_ORIGIN`, is a plain, non-secret allowlist string
  (`services/api/src/config/env.ts:14`), applied via
  `origin.split(',').map(o => o.trim())` into Nest's `enableCors({
origin })` (`main.ts:32-34`) — confirmed by direct source read to be an
  explicit array allowlist, **not** a wildcard (`origin: '*'` would be
  the actual CORS regression to watch for; it is not present).

**No new security defect was found or introduced by CP-018.** The one
genuine, pre-existing security-relevant defect already on record — the
`InventoryReservation` double-release/double-convert operation returning
a raw HTTP `500` instead of a mapped `409`/`400` (present since CP-006,
first surfaced during the CP-016+CP-021 integration's own audit pass, see
`integration-cp016-cp021.md`'s "A genuine, pre-existing defect" section)
— is unrelated to CP-018's scope (CP-018 has no reservation-release UI)
and remains undocumented-as-fixed by design: it is cross-referenced here,
not re-fixed, per this operation's explicit instruction to document and
classify rather than silently patch unrelated code.

## Notes: environmental gotcha, not a defect

Immediately after merging, `apps/admin`'s typecheck failed with `error
TS2307: Cannot find module '../../src/app/page.js'` from
`.next/types/validator.ts`. Root cause: a stale, **gitignored**
`.next/` Next.js build-cache directory left over from a pre-merge dev-server
run, still referencing `src/app/page.tsx` — a file CP-018's merge
legitimately replaced with a `(app)/`/`(auth)/` route-group structure.
Confirmed via `git check-ignore apps/admin/.next` (gitignored, not
tracked); fixed by deleting the stale cache (`rm -rf apps/admin/.next`)
and re-running typecheck clean. Classified as build-cache staleness, not
a CP-018 code defect — recorded per this operation's "do not hide, do not
misclassify" instruction even though it required no source change.

## Governance files updated by this operation

`PROJECT_STATUS.md`, `docs/product/project-progress.md`,
`docs/product/roadmap.json` (status + aggregate). Checked and found
already correct, requiring no further edit: `docs/product/canonical-roadmap.md`,
`docs/product/requirements-matrix.md` (CP-018's `REQ-FE-01` row already
reads `VALIDATED (CP-018)`), `docs/product/gap-priority-matrix.md` (P1-3
already cites CP-018 as resolving the `apps/admin` slice of "zero client
application business features"; P1-8's admin role-management-UI gap is
already explicitly recorded as "Unassigned — real, deliberately out of
CP-018's canonical scope, not silently folded into CP-018"). CP-017,
CP-019, CP-020, CP-022 statuses were **not** changed by this operation.
The canonical dependency graph (`phase-dependency-graph.md`) was **not**
modified.

## Result

| CP     | Implemented | Validated              | Pushed | Merged to `develop` |
| ------ | ----------- | ---------------------- | ------ | ------------------- |
| CP-016 | ✓           | ✓                      | ✓      | **YES** (prior op)  |
| CP-017 | ✓           | IMPLEMENTED only (80%) | ✓      | NO                  |
| CP-018 | ✓           | ✓                      | ✓      | **YES** (this op)   |
| CP-019 | —           | BLOCKED                | —      | NO                  |
| CP-020 | —           | NOT_STARTED            | —      | NO                  |
| CP-021 | ✓           | ✓                      | ✓      | **YES** (prior op)  |
| CP-022 | —           | NOT_STARTED            | —      | NO                  |

## Final decision

- **Current canonical CP:** CP-018 (most recently merged; CP-016 and
  CP-021 also merged, in the prior integration operation).
- **Last CP merged into `develop`:** CP-018 (this operation) — merge
  commit `12d55ac` (`7f988a7` amended to fold in one governance-doc
  prettier fix), `develop` HEAD now `12d55ac`.
- **Last CP validated:** CP-018, CP-016, and CP-021 are all VALIDATED and
  all merged; no ordering distinction among them is meaningful beyond
  merge sequence.
- **First genuinely executable canonical CP:** none is both
  fully-unblocked-by-dependency and not-yet-implemented right now.
  CP-017 needs live-SMS verification (a verification task on existing
  code, not new implementation) before it can become VALIDATED and
  mergeable. CP-019 remains BLOCKED on domain-expert review — no
  amount of engineering work unblocks it. CP-020 depends on CP-019
  (blocked). CP-022 depends on CP-020 (not started).
- **Blocked CPs:** CP-019 (domain-expert review gate); CP-020 (transitively,
  via CP-019); CP-022 (transitively, via CP-020).
- **Integration debt remaining:** CP-017 sits IMPLEMENTED-but-unvalidated
  and unmerged on its own branch — the same "invisible to develop"
  pattern already fixed for CP-012/013/014/016/018/021, now the last
  unresolved instance of it.
- **Genuine unresolved gaps:** the `InventoryReservation`
  double-release/convert HTTP `500` defect (pre-existing since CP-006,
  cross-referenced above, not fixed — out of scope); P1-8 (no
  role/permission/session/API-key admin UI — deliberately out of CP-018's
  scope, unassigned to any phase); P1-1 (no rate limiting, deferred since
  CP-016); P1-6/P1-9 (live ZarinPal/error-reporting network paths,
  blocked by this sandbox's network policy, not missing code).
- **Exact next action:** either (a) verify CP-017's live SMS delivery
  path against real network egress so it can become VALIDATED and then
  merged (a verification task, not new implementation), or (b) obtain the
  domain-expert review CP-019 is blocked on so CP-020 can eventually
  start. Neither is started by this document — this operation is
  integration-only, per its own scope, and does not select or begin the
  next implementation unit.

No new roadmap. No new phase. No new CP. No unrelated implementation.
