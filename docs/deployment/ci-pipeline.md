# CI Pipeline & Branch Strategy

Workflow file: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
This document explains what it does, why it's shaped the way it is, and what
still needs a human with repo-admin access to finish (branch protection isn't
configurable from inside this repo — see below).

## Branch strategy

```
main         — production. Protected. Only receives merges from `develop`
               (normal releases) or `hotfix/*` (urgent production fixes).
develop      — integration. Protected. `feature/*` and `bugfix/*` branches
               merge here; this is what the next release is cut from.
feature/*    — new work, branched from `develop`, merged back to `develop`.
bugfix/*     — non-urgent fixes, branched from `develop`, merged back to `develop`.
hotfix/*     — urgent production fixes, branched from `main`, merged to
               **both** `main` and `develop` (so the fix isn't lost on the
               next release cut from `develop`).
```

```
main    ──●───────────────────●───────────●──         (production)
           \                 / \         /
            \               /   \       /
develop ──●──●──●──●──●──●──●────●──●──●──            (integration)
            \    /  \    /         \
             \  /    \  /           \
    feature/* ●        ●  bugfix/*   ● hotfix/* (branched from main, not develop)
```

Commit convention: [Conventional Commits](https://www.conventionalcommits.org)
(`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `ci:`, `security:`)
— see root `CONTRIBUTING.md`.

### ⚠️ Manual step required: branch protection rules

Nothing in this repo can configure GitHub's branch protection settings — that's
a repo-admin action in GitHub itself (Settings → Branches), not something
expressible in a workflow file or committed config. Once someone with admin
access is available, set on both `main` and `develop`:

- Require a pull request before merging (no direct pushes).
- Require the **`quality gate`** status check to pass before merging (see
  below — this one check gates on all four CI jobs, so it's the only one that
  needs to be listed).
- Require branches to be up to date before merging.
- (Recommended) Require at least one approving review.

## The four CI jobs

| Job        | What it runs                                                                                                                                                                                                                                                                                       | Why these two together                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`     | repo structure validation, ESLint, Prettier check, `tsc --noEmit`                                                                                                                                                                                                                                  | All static analysis, no artifacts, fast fail                                                                                                                              |
| `test`     | unit tests, then a real Postgres service container is bootstrapped (schemas + least-privilege roles, same `infrastructure/postgres/init/*.sql` every environment uses), migrated (`prisma migrate deploy`), and seeded — then `services/api`'s e2e suite runs against it under the `iecp_app` role | Unit tests need nothing external; the integration suite specifically needs a reachable, migrated, least-privilege-enforced DB — see `docs/database/README.md`             |
| `security` | `pnpm audit --audit-level high` (dependency scan), [gitleaks](https://github.com/gitleaks/gitleaks) (secret scan)                                                                                                                                                                                  | Both are "did we introduce something we shouldn't have," independent of whether the code itself works                                                                     |
| `build`    | `apps/*` (frontend) then `services/*` (backend), as two separate steps                                                                                                                                                                                                                             | Turbo's dependency graph builds the shared `packages/*` each depends on automatically either way; splitting the steps just makes it obvious which side broke if one fails |

`apps/mobile` (Flutter) isn't in the `build` job — the Flutter SDK isn't part
of this pipeline yet, and there's nothing to build without it. See
`apps/mobile/README.md`.

## The quality gate

A fifth job, `quality-gate`, depends on all four (`needs: [lint, test,
security, build]`) and fails if any of them failed or was cancelled. This is
the one check branch protection should require — a single required check that
transitively depends on everything, rather than four separate ones to keep in
sync if a job is ever renamed or added.

### About "minimum score: 98"

The Phase 002 task that specified this pipeline set a `quality_gate.minimum_score`
of 98, echoing the scoring convention `docs/product/blueprint.md` uses for
architecture/scope reviews (§127, §135: each "Gate" needs ≥98/100). That
document's own author explicitly caveats those numbers as a self-assessed
design-scope score, not a literal computed metric (§127: _"من این را امتیاز
طراحی معماری/Scope می‌دانم، نه ادعای اینکه نرم‌افزار ساخته‌شده 99.1 است"_).

This pipeline does **not** compute a weighted 0–100 score from lint warning
counts, coverage percentages, etc. — that would be reverse-engineering a
formula to justify a number decided in advance, not a real measurement.
Instead, the gate is binary and unambiguous: **all four required jobs must
pass, with zero tolerance.** That's the honest operational meaning of "quality
gate" here. If a genuinely quantitative score is wanted later (e.g., test
coverage percentage as one input among several), design it as its own
explicit, reviewable metric — not retrofitted to hit a pre-chosen number.

## Local equivalents

Every CI step has a local command — see root `README.md` and `CONTRIBUTING.md`:

```bash
pnpm validate:structure && pnpm lint && pnpm format:check && pnpm typecheck   # lint job
pnpm test                                                                     # test job, part 1 (no DB needed)
psql ... -f infrastructure/postgres/init/01-schemas.sql   # test job, part 2 — needs local Postgres, see
psql ... -f infrastructure/postgres/init/02-roles.sql     # infrastructure/postgres/README.md for the one-time setup
pnpm --filter @iecp/database migrate:deploy                                  # (as iecp_migrator)
pnpm --filter @iecp/database seed                                            # (as iecp_migrator)
pnpm --filter @iecp/api test:e2e                                             # (as iecp_app — DATABASE_URL points at it)
pnpm audit --audit-level high                                                 # security job (dependency half)
pnpm turbo run build --filter="./apps/*" && pnpm turbo run build --filter="./services/*"   # build job
```

Gitleaks (the secret-scan half of `security`) has no `pnpm` equivalent —
install it locally (`brew install gitleaks` or see the
[gitleaks releases](https://github.com/gitleaks/gitleaks/releases)) and run
`gitleaks detect` from the repo root if you want to check before pushing.
