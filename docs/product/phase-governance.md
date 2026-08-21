# Phase Governance

The process every future `CP-XXX` phase (CP-015 onward) follows, start to
finish. Retroactively, CP-000 through CP-013 already followed something
very close to this shape informally (every one of them shipped an ADR,
tests, and documentation before being called done) — this document makes
it explicit and mandatory going forward, and is what
[`phase-audit-checklist.md`](phase-audit-checklist.md) checks against.

## Definition of Ready (before a phase may start)

A phase may not begin implementation until all of the following exist:

1. **Scope** — a one-paragraph objective and an explicit list of what is
   and is not in scope (matching the `master-roadmap-v2.md`/
   `canonical-roadmap.md` phase_format fields: objective, business_value,
   deliverables).
2. **Acceptance criteria** — testable, specific, not "make it better."
3. **Dependencies declared and satisfied** — every phase this one depends
   on (per [`phase-dependency-graph.md`](phase-dependency-graph.md)) is
   itself at least `IMPLEMENTED` status, or the dependency is explicitly
   waived with a written reason.
4. **Risk register entry** — at minimum, the phase's own `risk` field
   from its roadmap definition, expanded if new risks surface during
   scoping.
5. **A dedicated branch**, named per the established convention
   (`NN-feature-<slug>`, two-digit, matching CP-015 onward's actual git
   phase number — not the CP-ID itself, which is a separate, stable
   identifier that survives even if a branch is re-cut).
6. **No open P0 gap that this phase's own dependencies don't already
   close** — re-checked against the live [`gap-priority-matrix.md`](gap-priority-matrix.md)
   at start time, not just at the time the matrix was written.

A phase that starts without all six is out of process — flag it, don't
proceed silently.

## Definition of Done (before a phase may be marked Completed)

A phase is **Completed** only when **all** of the following are true —
this is the same bar `canonical-roadmap.md` already applies
retroactively to CP-000–011:

1. **Implementation** — real code, not scaffolding, matching the phase's
   own acceptance criteria.
2. **Test** — domain unit tests (pure, no I/O) for business logic;
   repository/concurrency integration tests against real PostgreSQL for
   anything touching money or inventory; e2e coverage including negative/
   authorization cases. No mocks for financial concurrency proofs — this
   project's own established, unbroken convention.
3. **Integration** — merged into `develop` (or the phase's designated
   integration target), and a real CI run (not a sandbox validation gate)
   has passed against it. **This is the specific bar CP-012/013 currently
   fail** — implementation and tests are real, integration is not, hence
   `Partial` not `Completed`.
4. **Documentation** — at minimum: an ADR, an architecture doc section, a
   security doc section (if the phase touches auth/RBAC/data exposure), a
   module README update, and a `project-progress.md` entry. Matches the
   file set every phase from CP-004 onward has already produced.
5. **Audit** — the phase has been run through
   [`phase-audit-checklist.md`](phase-audit-checklist.md) and the result
   is recorded. **A phase without a recorded audit cannot be marked
   Completed, full stop** — this is the literal rule from
   `no_phase_is_complete_without_audit` in this phase's own kickoff, and
   it is not negotiable per-phase.

## What happens when a phase can't meet Definition of Done

It stays whatever status it actually is (`Partial`, `Blocked`, etc.) —
`canonical-roadmap.md`'s status model exists specifically so an honestly
incomplete phase has a name for its actual state rather than being forced
into a binary complete/incomplete that would pressure someone into
mis-reporting it. CP-012/013 are the working example: genuinely
high-quality implementation, correctly not called `Completed` because
Integration isn't met yet.

## Governance ownership

This document, `canonical-roadmap.md`, `project-progress.md`, and
`roadmap.json` are the joint responsibility of whichever phase most
recently touched them — currently CP-014. Any future phase that changes
scope, discovers a new gap, or completes a deliverable **updates
`project-progress.md` and `roadmap.json` as part of its own Definition of
Done**, item 4 (Documentation) above — this is not a separate governance
phase's job to do retroactively, specifically so the roadmap never again
drifts as far from reality as blueprint-vs-execution had before CP-014's
audit caught it.
