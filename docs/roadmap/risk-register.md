# Risk register — Phase 014 audit

Ranked by severity. Each risk names the evidence, the blast radius, and a
concrete, bounded mitigation — not a vague "improve X." See
[`master-roadmap-audit.md`](master-roadmap-audit.md) for the full
evidence behind each.

## CRITICAL

### R1 — Phases 012/013 (returns/refunds/settlement) are not on `develop`

**Evidence:** `git merge-base origin/develop origin/12-feature-...` ≠ tip of
that branch; same for 013. **Blast radius:** the platform's own
integration branch cannot process a return, refund, or credit note at all.
Every claim in those phases' final reports about "production-ready" applies
to code nobody can reach from `develop`. **Mitigation:** merge (or fast-
forward) 012 then 013 into `develop`, run the full CI pipeline for real
against them, resolve whatever surfaces. Bounded, no design work — see
[`critical-path.md`](critical-path.md) item 1.

### R2 — CI's `test` job has no Redis; the app has no fail-fast when Redis is unreachable

**Evidence:** `ci.yml` defines only a `postgres` service; `REDIS_URL`
defaults to `localhost:6379` and is never overridden; live reproduction in
this audit showed the compiled app retrying `ECONNREFUSED` indefinitely
with no crash, no boot completion, no `timeout-minutes` bound in the
workflow to catch it. **Blast radius:** either CI has been silently
tolerating this since Phase 006 (unlikely, would have been noticed) or it
genuinely hangs for hours per run — either way it's an unverified,
un-owned failure mode sitting under every single CI run since the first
BullMQ queue was registered. **Mitigation:** add a `redis:7-alpine` service
to the `test` job (mirrors the existing `postgres` service pattern
exactly), and separately give every `BullModule.forRootAsync` a bounded
`maxRetriesPerRequest`/`retryStrategy` so a genuinely-down Redis fails an
individual request instead of hanging the whole process forever. Two small,
independent, low-risk changes.

## HIGH

### R3 — No rate limiting anywhere in `services/api`

**Evidence:** grepped, zero `ThrottlerModule` or equivalent; only
referenced as an open item in identity's own README. **Blast radius:** OTP
request endpoints, login, and every public route are unbounded — credential
stuffing and OTP-exhaustion cost money (SMS) and are a real abuse vector
the moment this is internet-facing. **Mitigation:** `@nestjs/throttler`
(or equivalent) at the global guard level, tighter per-route override on
`/auth/otp/request` and `/auth/login`. Small, well-precedented addition —
does not touch existing RBAC/JWT guards.

### R4 — Every notification provider is a stub; OTP/order-confirmation delivery is fake in any real deployment

**Evidence:** all 6 adapters in `services/notification-worker` are
self-labeled "⚠️ Stub" — `send()` logs and returns a synthetic "sent"
result, no provider is actually called. **Blast radius:** if this were
deployed today, no customer would ever receive an OTP SMS, order
confirmation, or shipping notice — silent total failure of every customer
communication, indistinguishable from success in the logs unless someone
reads the "[stub]" log line. **Mitigation:** wire one real Iranian SMS
provider (Kavenegar or Ghasedak, per blueprint §43's own suggested
options) behind the existing `NotificationChannelPort` — the interface is
already correct, only the adapter body needs a real HTTP call. This alone
would retire the highest-impact single stub.

### R5 — Customer domain (account beyond auth, prescription, family, loyalty, wallet) is schema-only

**Evidence:** `customer.FamilyMember`/`LoyaltyAccount`/`WalletAccount`
have zero application-code references anywhere; no `Prescription` model
exists at all. **Blast radius:** none yet (nothing depends on these
tables), but this is the single largest gap between "backend commerce
platform" and "eyewear commerce platform" — prescriptions are the
category-defining feature and do not exist as a domain concept anywhere in
the codebase, only as an unreviewed value-range validator. **Mitigation:**
scope a dedicated Prescription phase (owner: Product + an actual optometry
domain reviewer per the existing `TODO` — do not build this without that
review) before customer-facing checkout claims to support eyewear-specific
ordering.

### R6 — No production observability

**Evidence:** `infrastructure/monitoring/prometheus.yml` exists with no
service in the codebase emitting `/metrics`; no alerting rules; no
runbook; no incident-response doc anywhere in `docs/`. **Blast radius:** if
something breaks in a real deployment, there is currently no way to know
except a customer complaint or a manual log tail. **Mitigation:** wire
`@willsoto/nestjs-prometheus` (or equivalent) in `services/api` behind the
existing health-check pattern, point the existing `prometheus.yml` at it,
add the minimum viable alert set (5xx rate, queue-lag, DB connection
saturation) before any phase that adds public traffic.

### R7 — No client application exists

**Evidence:** all four `apps/*` are unmodified scaffolds, zero business
`.tsx`/`.dart` files. **Blast radius:** none of the eight backend modules
built so far — including the deeply-hardened commerce core — is reachable
by an actual customer or admin operator. This is a deliberate, repeatedly-
reaffirmed sequencing choice (documented eight times in `CLAUDE.md`), not
an accident, but it caps _product_ completion regardless of backend depth.
**Mitigation:** see [`master-roadmap-v2.md`](master-roadmap-v2.md)'s
Frontend track — scope admin-panel-first (internal users, lower risk) before
storefront.

## MEDIUM

### R8 — Inventory lacks Purchase Order / Supplier management

**Evidence:** blueprint PHASE 4 names both explicitly; neither exists in
`schema.prisma` or `services/api/src/modules/inventory`. **Blast radius:**
stock can be adjusted manually but there's no real procurement lifecycle —
fine for launch-with-manual-restocking, a real gap for scale.
**Mitigation:** scope as its own phase, extending `inventory`'s existing
domain rather than a new module (same warehouse/ledger primitives apply).

### R9 — Payment gateway network path never verified live

**Evidence:** documented in Phase 008's own architecture doc — sandbox
cannot reach `sandbox.zarinpal.com`, confirmed directly, not assumed.
**Blast radius:** the adapter is written against ZarinPal's real
documented contract and unit-tested against that contract, but a live
staging run has never actually round-tripped a real request. **Mitigation:**
first action in any staging environment with real network egress — not a
code change, a verification task.

### R10 — 8 stale duplicate git branches

**Evidence:** `feature/*` unnumbered branches are byte-identical to their
numbered replacements (§3 of the audit). **Blast radius:** none
functionally, minor confusion risk for anyone browsing branches.
**Mitigation:** delete the 8 stale refs. Zero-risk, five-minute cleanup.

### R11 — Husky installed but no hook files configured

**Evidence:** `.husky/` contains only the `_` shim directory, no
`pre-commit`/`pre-push`. **Blast radius:** local commits can skip lint/
format/typecheck entirely; CI is the only real gate today. **Mitigation:**
add a `pre-commit` hook running `lint-staged` or a lightweight
`pnpm format:check && pnpm typecheck` subset — cheap, no architecture
impact.

## LOW

### R12 — No Jalali calendar support anywhere

**Evidence:** zero Jalali/Persian-calendar library in the dependency tree
or source. **Blast radius:** presentation-layer only — all data is stored
correctly (UTC), so this is additive whenever a client is built, not a
backend rework. **Mitigation:** pick a Jalali formatting library
(`dayjs` + `jalali-plugin`, or similar) when the first client phase adds
date display, not before.

### R13 — 10 `eslint-disable` occurrences not individually justified

**Evidence:** present, not yet audited one-by-one for whether each is
still necessary. **Blast radius:** low — the count is small and the
codebase is otherwise exceptionally clean (1 TODO, 0 `as any`, 0
`@ts-ignore` in the entire tree). **Mitigation:** a 30-minute pass during
the next phase that touches nearby code; not worth a dedicated phase.
