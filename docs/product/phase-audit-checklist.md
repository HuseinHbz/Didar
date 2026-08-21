# Phase Audit Checklist

Run at the end of every future phase (CP-015 onward), before that phase
may be marked `Completed` per [`phase-governance.md`](phase-governance.md).
Each item names what "pass" actually means — not a yes/no box with no
definition, matching the evidence-based standard the Phase 014 audit
itself was held to.

## Architecture

- [ ] New/changed modules follow `domain/ → application/ → infrastructure/` + `presentation/` layering, dependency direction inward-only.
- [ ] No module reaches into another module's Prisma models directly
      instead of going through its port/service, unless narrowly
      justified and documented (the one precedent: `cart-checkout`'s
      read-only `PrismaCustomerLookupRepository`).
- [ ] No new circular module dependency introduced (verify via a real
      boot test, not just reading imports).

## Security

- [ ] Every new admin route is RBAC-gated with a real, purpose-named
      permission (not a reused unrelated one).
- [ ] Every new customer route has an explicit ownership check or is
      genuinely public, never ambiguous.
- [ ] No business-critical value trusted from client input where the
      server can compute or verify it instead.
- [ ] `pnpm audit --audit-level high` clean (or new findings explicitly
      triaged and overridden with a dated justification, matching
      `pnpm-workspace.yaml`'s existing convention).

## Database

- [ ] Migration ships a hand-authored `down.sql`.
- [ ] Real UP→DOWN→UP + fresh shadow-DB round trip performed and its
      result recorded (not asserted from memory).
- [ ] `prisma migrate status`/`prisma migrate diff` show zero drift
      against a database this phase's own CI actually provisioned fresh
      — not a long-lived sandbox database that may carry unrelated state.
- [ ] Money fields are `BigInt`, never float.
- [ ] Any new financial state transition uses a row lock
      (`SELECT ... FOR UPDATE`) or an atomic single-statement claim, not
      an application-level check-then-act.

## API

- [ ] Every new endpoint appears in the module's own API reference doc
      (matching `docs/api/*.md`'s existing table convention).
- [ ] Whitelist + `forbidNonWhitelisted` validation applies to every new
      DTO.
- [ ] Every new domain error type has a real HTTP status mapping, not a
      generic 500 for something that's actually a 409/400.

## Frontend / Mobile (when the phase touches either)

- [ ] No business-critical data hardcoded client-side.
- [ ] Every UI permission check has a real backend enforcement behind it
      — never the only layer.
- [ ] Error/loading states handled for every new API call.

## RBAC

- [ ] New permissions follow the existing `domain.resource.action` naming
      convention.
- [ ] New permissions are actually granted to the roles that need them
      in seed data — a permission that exists but is never granted to any
      role is a real gap, not a false negative.

## Validation

- [ ] Every new input DTO has explicit bounds (matching the rigor of
      existing examples like the prescription value-range validator).

## Concurrency

- [ ] Any new state machine transition is proven under real concurrent
      calls (a real integration test against real PostgreSQL, not a
      mock) — matching every prior phase's own concurrency e2e suite.

## Idempotency

- [ ] Any new externally-triggerable side effect (a queue job, a webhook
      handler, a retried admin action) is safe to run more than once.

## Observability

- [ ] New long-running or queue-driven work is visible in whatever
      metrics/logging exists at the time this phase runs (once CP-016
      lands, this becomes "emits to `/metrics`"; before that, "logs
      enough to diagnose a stuck job").

## Performance

- [ ] No new N+1 query pattern introduced (spot-checked, not exhaustively
      profiled unless the phase is explicitly a performance phase).

## Testing

- [ ] Domain unit tests exist for new business logic.
- [ ] Real-Postgres integration/concurrency tests exist for anything
      touching money or inventory.
- [ ] E2E tests cover the new surface's negative/authorization cases,
      not just the happy path.
- [ ] Full suite run twice consecutively with identical results (matching
      the "prove it's stable, not a fluke" convention established in
      earlier phases).

## Migration

- [ ] Migration applies cleanly to a fresh database (not just the
      long-lived sandbox one).

## Rollback

- [ ] `down.sql` actually reverses the migration — verified, not assumed.

## Backup

- [ ] If the phase changes what data needs backing up, `infrastructure/
postgres/scripts/` updated accordingly (n/a for most phases).

## CI/CD

- [ ] `pnpm validate:structure`, `format:check`, `lint`, `typecheck`,
      `build`, `test` all pass.
- [ ] Real GitHub Actions run (not just the sandbox) is green for this
      phase's merge — this item cannot be checked until CP-015 restores
      that capability for phases downstream of it.

## Documentation

- [ ] ADR written.
- [ ] Module README / architecture doc / security doc updated as
      applicable.
- [ ] `project-progress.md` and `roadmap.json` updated (per
      `phase-governance.md`'s ownership rule).

## Production Readiness

- [ ] Health/readiness implications of the new capability considered (does
      it add a new required dependency? does it need its own liveness
      check?).
- [ ] No new "force complete"/manual-repair endpoint introduced for any
      state machine — matches this project's own standing rule.

## Result recording

The outcome of this checklist — pass/fail per item, with evidence — is
recorded in that phase's own `phase-<CP-ID>-audit.md`, matching the shape
of [`phase-014-audit.md`](phase-014-audit.md). A phase with unresolved
`[ ]` items on this checklist is not `Completed`, per
[`phase-governance.md`](phase-governance.md)'s Definition of Done.
