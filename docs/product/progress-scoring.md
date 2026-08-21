# Progress scoring model

**Purpose:** make every completion percentage in this repository
reproducible and auditable — never a count of files or commits. This
model is what `docs/product/project-progress.md` and `roadmap.json` both
compute from, and what `pnpm roadmap:audit` re-derives independently
against evidence (see [`phase-audit-checklist.md`](phase-audit-checklist.md)
for what "evidence" means per dimension).

## The weights

| Dimension            | Weight   |
| -------------------- | -------- |
| Architecture         | 10%      |
| Database             | 10%      |
| Backend/API          | 15%      |
| Frontend/Admin       | 10%      |
| Mobile               | 10%      |
| Security             | 10%      |
| Testing              | 15%      |
| Integration          | 5%       |
| Documentation        | 5%       |
| CI/CD/DevOps         | 5%       |
| Production Readiness | 5%       |
| **Total**            | **100%** |

## Per-dimension scoring rubric (0–100 within each dimension, before weighting)

Each dimension is scored 0/25/50/75/100 against a fixed rubric — never a
free-form guess:

- **0** — Not started. No evidence exists.
- **25** — Scaffolded. Structure exists (files, schema, routes) with no
  real business behavior behind it.
- **50** — Implemented. Real behavior exists but is unverified (no test)
  or unintegrated (not reachable from the rest of the system).
- **75** — Implemented + Tested + Integrated, but a known gap remains
  (documented in that phase's own gap list) that keeps it short of
  production-grade for this specific dimension.
- **100** — Implemented + Tested + Integrated + Documented, with no known
  gap for this dimension specifically.

A phase's **Completion Percentage** = Σ(dimension score × dimension
weight) across all _applicable_ dimensions, renormalized (see below) when
a dimension is N/A.

## Handling Not Applicable dimensions

A dimension is N/A for a phase **only when that capability is explicitly
owned by a different phase in the canonical roadmap**, not merely because
the phase happens not to have touched it yet. Concretely:

- **Frontend/Admin** and **Mobile** are N/A for every phase whose scope
  was deliberately backend-only (CP-001 through CP-013, and every
  backend-track phase from CP-015 onward) — ownership of those
  dimensions sits with CP-018 (Admin), CP-020 (Storefront), and CP-022
  (Mobile) respectively, per
  [`canonical-roadmap.md`](canonical-roadmap.md)'s "one owner per
  capability" table. Scoring a backend-only phase 0 on Frontend would
  double-penalize the same gap the roadmap already tracks explicitly
  under its real owner.
- When N/A dimensions are excluded, **their combined weight is
  redistributed proportionally across the remaining applicable
  dimensions** (each remaining dimension's weight scales up by the same
  factor: `remaining_weight = original_weight / (1 - excluded_weight_sum)`).
  Example: a backend-only phase excludes Frontend (10%) and Mobile (10%),
  leaving 80% of weight across 9 dimensions — each remaining dimension's
  effective weight is `original / 0.80`.
- **This redistribution is recorded per phase in `roadmap.json`'s
  `scoring.excluded_dimensions` field** — never silent. Every phase in
  `project-progress.md` states explicitly which dimensions (if any) were
  excluded and why.
- **Redistribution never happens for Testing, Security, Database, or
  Integration** — every phase that has any implementation at all is
  expected to have these; a phase skipping them scores 0 on them rather
  than having them excluded. Only Frontend/Admin and Mobile are ever
  eligible for N/A treatment under this model, because they are the only
  two dimensions this roadmap deliberately assigns to phases other than
  the one doing the backend work.

## Explicit worked example (CP-005 Catalog)

Catalog (CP-005) is backend-only by deliberate scope (ADR-005 decision 7) — Frontend/Admin and Mobile are N/A, excluded weight = 20%,
redistribution factor = `1 / 0.80 = 1.25`.

| Dimension            | Raw weight | Score (0–100)                                                                                                 | Effective weight | Contribution |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- | ---------------- | ------------ |
| Architecture         | 10%        | 100                                                                                                           | 12.5%            | 12.5         |
| Database             | 10%        | 100                                                                                                           | 12.5%            | 12.5         |
| Backend/API          | 15%        | 100                                                                                                           | 18.75%           | 18.75        |
| Frontend/Admin       | —          | N/A                                                                                                           | —                | —            |
| Mobile               | —          | N/A                                                                                                           | —                | —            |
| Security             | 10%        | 75 (RBAC real; no rate limiting yet — CP-016's job)                                                           | 12.5%            | 9.375        |
| Testing              | 15%        | 100                                                                                                           | 18.75%           | 18.75        |
| Integration          | 5%         | 100 (merged to `develop`)                                                                                     | 6.25%            | 6.25         |
| Documentation        | 5%         | 100                                                                                                           | 6.25%            | 6.25         |
| CI/CD/DevOps         | 5%         | 50 (covered by the shared pipeline, but that pipeline has the CI/Redis gap — CP-016's job, not Catalog's own) | 6.25%            | 3.125        |
| Production Readiness | 5%         | 75 (no metrics endpoint yet — CP-016's job)                                                                   | 6.25%            | 4.6875       |
| **Total**            |            |                                                                                                               |                  | **≈88**      |

This matches the audit's own independently-reasoned score for Catalog
(88, in [`phase-status-matrix.md`](../roadmap/phase-status-matrix.md)) —
the two methods converge because both were built from the same evidence,
which is the point of having a reproducible model: a different reasonable
person applying this rubric to the same evidence should land within a few
points of the same number.

## What this model deliberately does not do

It does not average "phase execution quality" with "product reachability"
into one number — a phase can legitimately score 90+ on execution (built
well, tested well, documented well) while the _product_ built by that
phase remains unreachable by any customer, because reachability is a
different phase's (CP-018/020/022's) job entirely. See
[`product-gap-analysis.md`](product-gap-analysis.md) for the
reachability-specific framing — this scoring model and that framing
answer different questions and neither substitutes for the other.
