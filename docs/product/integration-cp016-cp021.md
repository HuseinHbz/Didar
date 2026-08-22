# Integration: CP-016 + CP-021 into `develop`

**This is a governance/integration operation, not a new canonical phase.**
No new CP number, no roadmap rewrite, no phase renaming. It records exactly
what was merged into `develop`, why, and what evidence backs the merge —
the same purpose `integration-reconciliation.md` served for CP-012/013/014.

## Why this happened

After CP-015 merged CP-012/013/014, `develop` stayed frozen at that same
commit (`c311267`) while four more phases were implemented, validated, and
pushed on their own branches: CP-016, CP-017, CP-018, CP-021. None were
ever merged — the exact "implemented but invisible to the platform's own
trunk" pattern CP-015 itself was created to fix for CP-012/013 had
recurred. Evidence (`git merge-base --is-ancestor <branch> origin/develop`
for each): CP-016/017/018/021 all returned `false` before this operation.

Per explicit instruction, **only CP-016 and CP-021 are merged here.**
CP-017 (IMPLEMENTED, not VALIDATED — live SMS delivery never verified
against real network egress) and CP-018 (VALIDATED but deliberately held
back) remain unmerged. CP-019/020/022+ are untouched — CP-019 stays
BLOCKED, CP-020/022 stay NOT_STARTED.

## Dependency verification (before merging)

- CP-016 depends on CP-015 only. CP-015 is on `develop`. ✓
- CP-021 depends on CP-015 only (verified independently during CP-021's
  own implementation — branched directly off `develop`, never touched
  CP-016/017/018). ✓
- Neither CP-016 nor CP-021 depends on the other. Merge order (016 then 021) was arbitrary but deterministic — chosen to match numeric order.

## VALIDATED status verification (`phase-governance.md`'s own criteria)

| CP     | Own branch's `roadmap.json` status | Own audit doc conclusion          | Evidence                                                                                                                                                                       |
| ------ | ---------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CP-016 | `VALIDATED`, 90%                   | `phase-016-audit.md`: "VALIDATED" | Real Redis CI service, bounded startup preflight in 3 services, `/health/ready` split, failure-injection proof against real Redis (twice), 4 unit-test files + 7-case e2e spec |
| CP-021 | `VALIDATED`, 95%                   | `phase-021-audit.md`: "VALIDATED" | Supplier + PurchaseOrder lifecycle, 17 domain unit + 18 e2e (incl. 20-way-concurrent idempotent-receive proof), migration UP/DOWN/UP verified                                  |

## Merge mechanics

```
git checkout -B develop origin/develop        # c3112671
git merge --no-ff origin/16-feature-platform-reliability   # 7328e67, clean, no conflicts
git merge --no-ff origin/21-feature-procurement             # e5d0034, 2 conflicts (governance docs only)
```

**Conflicts, and how they were resolved:** `PROJECT_STATUS.md` and
`docs/product/project-progress.md` each had a "what's the current phase"
header/table that CP-016's branch and CP-021's branch had independently
edited from their own (single-phase) perspective. Resolved conservatively
by combining both: the "still not started" table now excludes both
CP-016 and CP-021 (with a note explaining why), CP-017/018 are shown as
implemented-but-unmerged rather than NOT_STARTED (accurate — the code
exists, just isn't on `develop`), and the aggregate counts were
recomputed by hand (16 baseline + CP-016 + CP-021 = 18 completed, 12
planned) since neither branch's own edit had visibility into the other's
increment. `docs/product/roadmap.json`'s per-phase objects merged
automatically with no conflict (each phase is its own JSON object); only
its scalar `aggregate` block needed the same by-hand recomputation.
No functionality, test, or documentation from any other completed phase
was lost — every file in the diff belongs to CP-016 or CP-021's own known
scope (verified by inspecting `git status --short` after each merge
before committing).

## Validation gate (run against the merged `develop`, real infrastructure)

| Check                                                                    | Result                                                                                                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm validate:structure`                                                | ✓ pass                                                                                                                                                      |
| `pnpm format:check`                                                      | ✓ pass on every file this operation touched (5 pre-existing, unrelated files elsewhere still warn — unchanged by this operation)                            |
| `pnpm lint` (15 workspaces)                                              | ✓ pass                                                                                                                                                      |
| `pnpm typecheck` (15 workspaces)                                         | ✓ pass                                                                                                                                                      |
| `pnpm build` (11 buildable workspaces)                                   | ✓ pass                                                                                                                                                      |
| `pnpm test` (unit, all workspaces)                                       | ✓ pass — `@iecp/api` 353/353, `@iecp/worker` 3/3, `@iecp/notification-worker` 4/4 (includes CP-016's real Redis-unreachable-then-reachable bootstrap proof) |
| `pnpm audit --audit-level high`                                          | ✓ pass (1 pre-existing low-severity finding, 0 high)                                                                                                        |
| `pnpm roadmap:audit`                                                     | ✓ pass — 0 structural problems, CP-016/CP-021 both show `branch=true`, aggregate 18/0/0/12/30                                                               |
| `prisma migrate status`                                                  | ✓ up to date (12 migrations — CP-016 added none, CP-021 added 1)                                                                                            |
| `prisma migrate diff` (schema vs. applied)                               | ✓ no difference detected                                                                                                                                    |
| Seed, run twice                                                          | ✓ identical fixture summary both runs (idempotent)                                                                                                          |
| Full e2e suite (`services/api`, 220 cases), run 1                        | 219/220 — 1 pre-existing failure, see below                                                                                                                 |
| Full e2e suite, run 2                                                    | 218/220 — 2 pre-existing failures (1 recurring, 1 transient), see below                                                                                     |
| `procurement.e2e-spec.ts` + `redis-reliability.e2e-spec.ts` in isolation | ✓ 25/25                                                                                                                                                     |
| Compiled app boot (`node dist/main.js`)                                  | ✓ all CP-021 procurement routes mapped                                                                                                                      |
| `GET /api/v1/health`                                                     | ✓ `{"status":"ok",...}`                                                                                                                                     |
| `GET /api/v1/health/ready` (CP-016's split readiness endpoint)           | ✓ `{"status":"ok","database":"up","redis":"up"}`                                                                                                            |
| Graceful shutdown (`SIGTERM`)                                            | ✓ process exits cleanly, no hang                                                                                                                            |

### Pre-existing failures (not caused by this integration)

1. **`return-settlement-repository.e2e-spec.ts`'s 20-iteration
   `reconcileAll()` idempotency test** exceeds Jest's 5000ms default
   timeout in this sandbox. Documented as a known, non-blocking,
   environment-sensitivity finding as far back as `phase-015-audit.md`;
   re-confirmed unchanged (file's last edit predates both CP-016 and
   CP-021 — 2026-08-20, Phase 013). Not touched by this integration.
2. **`promotion-repository.e2e-spec.ts`'s concurrent-`reserve()` test**
   failed on run 2 only (`PrismaClientKnownRequestError` where
   `CouponUsageLimitExceededError` was expected) — the same transient,
   full-battery-resource-contention flakiness already classified during
   CP-021's own validation; passes cleanly in isolation. Neither CP-016
   nor CP-021 touches promotion code.

## Governance files updated by this operation

`PROJECT_STATUS.md`, `docs/product/project-progress.md`,
`docs/product/roadmap.json` (status + aggregate), `docs/product/canonical-roadmap.md`,
`docs/product/requirements-matrix.md`, `docs/product/gap-priority-matrix.md`
— all updated to reflect **only** CP-016 and CP-021 as merged/VALIDATED.
CP-017/018/019/020/022+ statuses were **not** changed by this operation
(CP-017 remains its own branch's honest `IMPLEMENTED, 80%`; CP-018
remains VALIDATED-but-unmerged; CP-019 remains BLOCKED; everything else
remains NOT_STARTED). The canonical dependency graph
(`phase-dependency-graph.md`) was **not** modified.

## A genuine, pre-existing defect found during this operation's own audit pass

Live-reproduced against the merged `develop` (not a code change made
here — documented for the record, per the instruction to surface, not
silently fix, discovered issues outside the current operation's scope):
`POST /internal/inventory/reservations/:id/release` called twice on the
same reservation returns a real **HTTP 500** (`InventoryReservation`'s
repository throws a raw `Error`, not `InvalidReservationOperationError`,
so `InventoryDomainExceptionFilter` never catches it — it falls through
to NestJS's default 500 handler). Present in the codebase since CP-006
(inventory core); confirmed present on `develop` before this integration
too (`git show origin/develop:...prisma-inventory-reservation.repository.ts`).
Not introduced by CP-016 or CP-021, and out of scope for this
integration-only operation. **Assigned to whichever future phase next
touches the inventory reservation module's error handling** — no
canonical CP currently owns it; flagging it here is the recorded
discovery, not a fix.

## Result

| CP     | Implemented | Validated              | Pushed | Merged to `develop` (before) | Merged to `develop` (after) |
| ------ | ----------- | ---------------------- | ------ | ---------------------------- | --------------------------- |
| CP-016 | ✓           | ✓                      | ✓      | NO                           | **YES**                     |
| CP-017 | ✓           | IMPLEMENTED only (80%) | ✓      | NO                           | NO                          |
| CP-018 | ✓           | ✓                      | ✓      | NO                           | NO                          |
| CP-021 | ✓           | ✓                      | ✓      | NO                           | **YES**                     |

**Current canonical CP:** CP-021 (most recently merged); CP-016 merged in
the same operation. **Last CP merged into `develop` before this
operation:** CP-015. **First unblocked canonical CP still requiring
implementation:** none — CP-016 and CP-021 are now both implemented and
merged; CP-017 needs live-SMS verification before it can become
VALIDATED (not new implementation); CP-018 needs a separate merge
decision (deferred, not part of this operation); CP-019 remains blocked
on domain-expert review; CP-020/022+ are genuinely not started.
**Exact next action:** either (a) verify CP-017's live SMS path and/or
merge CP-018 (both integration/verification work, not new features), or
(b) begin implementation on the first genuinely NOT_STARTED, unblocked
phase once the CP-018/019/020 sequencing is resolved — a decision this
document does not make, per the instruction not to invent scope.
