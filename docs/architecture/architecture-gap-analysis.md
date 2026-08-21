# Architecture gap analysis — Phase 014 audit

Companion to [`docs/roadmap/master-roadmap-audit.md`](../roadmap/master-roadmap-audit.md)
§6. This document covers what's structurally strong and what's genuinely
missing in the backend architecture as built — not a re-explanation of
each module (see each module's own `README.md`/architecture doc for that).

## Strengths, verified (not asserted)

- **Consistent clean-architecture layering** across all 8 built modules —
  `domain/ → application/ → infrastructure/` + `presentation/`, dependency
  direction inward-only, confirmed by import-direction spot checks
  (`payment` imports `cart-checkout`'s exported service, never reverse;
  `order` composes four prior modules' exported services rather than
  duplicating their logic).
- **One concurrency-safety pattern, applied identically everywhere it's
  needed**, not reinvented per module: P2002-catch-and-reread for unique-
  constrained creates (established Phase 007, reused unmodified through
  Phase 013), `SELECT ... FOR UPDATE` + re-check-the-locked-row for status
  transitions (established Phase 009 on `Order`, extended to
  `Fulfillment`/`Shipment` in Phase 011, to `ReturnSettlement` in Phase 013
  — same technique, same shape, every time).
- **Redis is never a system-of-record read path.** Verified by grep across
  `services/api/src` — no business-state read ever queries Redis directly;
  every BullMQ queue exists purely for scheduling, with Postgres as the
  actual source of truth re-read on every tick.
- **Composition over duplication is consistent.** No module was found
  re-implementing another module's domain logic locally instead of
  importing its exported service.

## Gaps

### A1 — No bounded retry strategy on any Redis/BullMQ connection (CRITICAL)

Every `BullModule.forRootAsync({ connection: { url: REDIS_URL } })` call
(5 occurrences, one per module with queues) omits `maxRetriesPerRequest`/
`retryStrategy`. This is architecturally a single missed cross-cutting
concern, not five independent module bugs — the fix belongs in one shared
place (a `createBullConnectionOptions()` helper, or equivalent, that every
`*-queue.module.ts` imports) rather than five separate patches, so the
next module doesn't reintroduce it. See risk register R2 for the empirical
reproduction.

### A2 — No shared "external dependency unreachable" fail-fast convention

Related to A1 but broader: there is currently no repo-wide pattern for
"what does a module do when a _required_ external dependency (Redis,
eventually a real SMS provider, eventually a real payment gateway network
path) is unreachable at boot or at request time." Today the only tested
behavior is Postgres unreachability (health check reports it). Worth
deciding once, as an architectural convention, before more external
integrations (real SMS, real gateway callbacks) are added.

### A3 — In-process queues in `services/api` vs. the standalone `services/worker` — the boundary is documented but not re-examined at scale

ADR-006 decision 8 justifies keeping domain-module BullMQ processors
in-process (`services/api`) rather than in `services/worker`, because
processors share the HTTP controllers' exact domain-service/Prisma-
transaction context. This is a reasonable choice at current scale and this
audit found no evidence it's wrong — but `services/worker` exists,
scaffolded, and has never been used for anything real. Worth an explicit
decision (keep the split as "worker is for genuinely generic/CPU-bound
jobs, domain sweeps stay in-process") rather than leaving `services/worker`
as unused scaffolding indefinitely — either use it or document why it
still exists.

### A4 — `develop` branch does not reflect the architecture actually built

Not a design flaw — a process gap already covered in the audit's §3 and
the risk register (R1). Listed here because it means anyone auditing
_just_ `develop`'s architecture would materially undercount the real
system's scope (8 modules built, 7 visible on `develop`).

## Explicitly not a gap (verified during this audit, worth stating so it

isn't re-flagged later)

- Module boundary correctness: no module was found reaching into another
  module's Prisma models directly instead of going through its port/
  service — the one exception found (`cart-checkout`'s
  `PrismaCustomerLookupRepository` reading `customer.Customer` directly)
  is a deliberate, narrow, read-only lookup against a schema `cart-checkout`
  doesn't own a service for yet, not a boundary violation of an _existing_
  module's ownership.
- No circular module dependencies found (Nest's DI graph resolves cleanly
  on every phase's own boot-test evidence cited in that phase's final
  report).
