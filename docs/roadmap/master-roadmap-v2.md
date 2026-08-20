# Master Roadmap V2

Produced by the Phase 014 audit. Supersedes the ad hoc "Phase 001–013"
engineering numbering as the forward-looking plan — that numbering is
preserved as history (every ADR/README/`CLAUDE.md` reference to it stays
correct and unchanged), but **new phases do not continue it blindly**, per
this audit's own mandate. New phases are numbered `P015` onward and
organized into named tracks with explicit gates, because the audit found
that flat sequential numbering was part of why 10 of 15 original blueprint
phases went unaddressed while three gate-level defects (unmerged branches,
CI/Redis, no rate limiting) sat unnoticed under active development.

Evidence for every claim below: [`master-roadmap-audit.md`](master-roadmap-audit.md).
Scores/status: [`phase-status-matrix.md`](phase-status-matrix.md).
Sequencing rationale: [`critical-path.md`](critical-path.md).

## Structure

- **Gate phases** (`P015`–`P016`) — must complete, in order, before any
  track below starts. These are fixes to what already exists, not new
  scope.
- **Tracks** — parallelizable once the gates close. Dependencies are
  stated per phase. A track is not a strict phase-number sequence; phases
  within different tracks can run concurrently once their own
  dependencies are met.

---

## Gate phases

### P015 — Integration Reconciliation

```
phase_id: P015
name: Integration Reconciliation
objective: Merge Phases 012 and 013 into `develop`, run the real CI
  pipeline against the merged result for the first time, and remove stale
  duplicate git refs.
business_value: Everything built in Phases 012/013 (returns, refunds,
  credit notes, settlement recovery) becomes actually usable from the
  branch this repository treats as truth. Without this, "the platform
  supports returns" is false for anyone who checks out `develop`.
dependencies: []
deliverables:
  - 12-feature-returns-refunds-credit-notes merged into develop
  - 13-feature-return-settlement-reconciliation merged into develop
  - Real GitHub Actions run (not sandbox validation) green on the result
  - 8 stale duplicate feature/* branches deleted
acceptance_criteria:
  - develop's own README.md/CLAUDE.md self-describe the return module
    without further edits being needed (they already do, from 012/013's
    own branches — the merge just needs to not regress them)
  - CI's test job passes for real against the merged develop
  - No PR opened unless explicitly requested (repo convention)
security_requirements:
  - No security regression from the merge itself (return module's own
    RBAC/permission set already reviewed in Phase 012/013)
database_requirements:
  - Migration order preserved (013's migration correctly follows 012's)
  - Zero drift confirmed against the real CI-provisioned database, not
    just the sandbox
testing_requirements:
  - Full CI suite green, for real, for the first time on this code
observability_requirements: []
documentation_requirements:
  - None beyond what 012/013 already shipped
rollback_requirements:
  - Standard git revert if the merge itself surfaces a real regression;
    no new rollback mechanism needed
estimated_complexity: S
risk: LOW (the risk is in *not* doing this, not in doing it)
status: NOT_STARTED
score: 0
```

### P016 — Platform Reliability Foundation

```
phase_id: P016
name: Platform Reliability Foundation
objective: Close the CI/Redis blind spot and the missing fail-fast
  behavior; add the security/observability minimums required before any
  phase exposes public traffic.
business_value: Prevents CI hangs of unknown real-world duration, and
  closes the rate-limiting/observability gaps before they matter — cheap
  now, expensive to discover in production later.
dependencies: [P015]
deliverables:
  - redis:7-alpine service added to ci.yml's test job
  - Bounded maxRetriesPerRequest/retryStrategy on all BullModule.forRootAsync
    call sites (one shared helper, not five separate patches)
  - timeout-minutes set on CI's test job
  - Global rate limiting (ThrottlerModule or equivalent), tighter bound on
    OTP-request/login routes specifically
  - /metrics endpoint wired to the existing prometheus.yml scrape target
  - Minimum 3-alert set: 5xx rate, queue lag, DB connection saturation
  - Health check split into liveness (process) vs. readiness (DB + Redis)
  - Husky pre-commit hook (format:check + typecheck subset, or lint-staged)
acceptance_criteria:
  - Killing Redis locally produces a fast, legible failure (not an
    indefinite retry loop) — re-run this audit's own empirical
    reproduction and confirm the new behavior
  - CI's test job fails within minutes, not hours, if Redis is
    unreachable
  - A scripted burst of OTP requests against one number/IP is rejected
    after a documented threshold
  - /metrics returns real data under load
security_requirements:
  - Rate limiting must not weaken existing RBAC/JWT checks — additive only
database_requirements: []
testing_requirements:
  - A new test (unit or e2e) proving the rate limit actually triggers
  - Re-run this audit's Redis-down reproduction as a regression check
observability_requirements:
  - This phase's own primary deliverable
documentation_requirements:
  - docs/deployment/ci-pipeline.md updated with the Redis service
  - docs/security/README.md's "Not yet" list updated to remove rate
    limiting once real
rollback_requirements:
  - Feature-flaggable rate-limit thresholds (config, not code) so a
    too-aggressive limit can be relaxed without a redeploy
estimated_complexity: M
risk: MEDIUM (touches every module's queue registration, but each change
  is small and independently testable)
status: NOT_STARTED
score: 0
```

---

## Track: Communications (unblocks real customer contact)

### P017 — Real Notification Delivery

```
phase_id: P017
name: Real Notification Delivery
objective: Replace the SMS adapter's stub with a real Iranian SMS
  provider integration (Kavenegar/Ghasedak, per blueprint §43), keeping
  the existing NotificationChannelPort contract unchanged.
business_value: Highest value-per-effort item in this roadmap — OTP,
  order confirmation, and shipping notices currently reach nobody in any
  real deployment. Every later customer-facing phase silently assumes
  this already works.
dependencies: [P016]
deliverables:
  - One real SmsAdapter implementation behind the existing port
  - Provider credentials handled via existing secret-management convention
  - Telegram/WhatsApp/Email/Push remain stubs, explicitly, this phase —
    do not scope-creep into all six channels at once
acceptance_criteria:
  - A real OTP request results in a real SMS delivered to a real Iranian
    number in a staging environment with real network egress
  - Existing NotificationDispatcherService fallback logic requires zero
    changes (proves the port abstraction was correct)
security_requirements:
  - Provider API credentials never logged, never committed
database_requirements: []
testing_requirements:
  - Provider adapter tested against a sandbox/test credential if the
    provider offers one; contract test against NotificationChannelPort
observability_requirements:
  - Delivery success/failure rate visible via P016's metrics wiring
documentation_requirements:
  - docs/product/*.md notification section updated from "stub" to "real"
rollback_requirements:
  - Adapter swap is a single DI binding change — trivial rollback to stub
    if the provider integration misbehaves
estimated_complexity: S
risk: LOW
status: NOT_STARTED
score: 0
```

---

## Track: Frontend (admin-first, then storefront)

### P018 — Admin Panel MVP

```
phase_id: P018
name: Admin Panel MVP
objective: Build the first real business features in apps/admin,
  covering the operator workflows the 8 backend modules already support
  end-to-end (catalog management, inventory adjustment, order/fulfillment
  view, return/settlement review once P015 lands).
business_value: Makes eight already-hardened backend modules operable by
  an actual human for the first time. Lower risk than storefront (internal
  users, no public exposure, no need to wait for P016's rate limiting to
  be bulletproof).
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
    feature description, matching the convention every backend module's
    README already follows
rollback_requirements:
  - Standard frontend deploy rollback (previous build artifact)
estimated_complexity: L
risk: MEDIUM
status: NOT_STARTED
score: 0
```

### P020 — Storefront MVP

```
phase_id: P020
name: Storefront MVP
objective: Build the first real customer-facing features in
  apps/storefront — catalog browse/search, cart, checkout, order
  history, return request.
business_value: The platform's first actual customer-reachable surface.
dependencies: [P016, P018, P019]
deliverables:
  - Catalog browse/PDP/search UI against the real catalog API
  - Cart/checkout UI against the real cart-checkout + payment APIs
  - Order history + return-request UI
  - Guest + authenticated flows (dual-auth, matching ActorResolverGuard)
acceptance_criteria:
  - A real end-to-end purchase (browse → cart → checkout → ZarinPal
    redirect → order confirmation) completes in a staging environment
    with real network egress
  - Rate limiting (P016) verified to not block legitimate traffic
    patterns during load testing
security_requirements:
  - No business-critical pricing/discount logic duplicated client-side —
    every total is server-computed, matching the existing
    "never trust a client-supplied total" invariant
database_requirements: []
testing_requirements:
  - Full checkout-flow e2e test against a staging environment
observability_requirements:
  - Real user monitoring / conversion funnel basics
documentation_requirements:
  - apps/storefront/README.md rewritten, matching P018's convention
rollback_requirements:
  - Standard frontend deploy rollback
estimated_complexity: XL
risk: MEDIUM
status: NOT_STARTED
score: 0
```

---

## Track: Customer domain

### P019 — Customer Domain & Prescription

```
phase_id: P019
name: Customer Domain & Prescription
objective: Build a real Customer domain beyond auth — profile, address
  management (extending the existing thin lookup), and a real
  Prescription entity — gated on the existing TODO's optometry-domain
  review, not built ahead of it.
business_value: Closes the single largest gap between "backend commerce
  platform" and "eyewear commerce platform." Prescription handling is
  the category differentiator this platform is named for.
dependencies: [P015, P016]
deliverables:
  - Prescription domain entity + migration (does not exist today)
  - Prescription CRUD scoped to the owning customer, following the same
    ownership-check pattern cart-checkout/order already use
  - Real optometry-domain review of packages/validation/src/prescription.ts's
    numeric bounds — BLOCKING, must happen before this phase's Prescription
    entity ships, not after
  - Family member linkage (using the existing customer.FamilyMember table
    — first real code to touch it)
  - Loyalty/Wallet: explicitly OUT of scope for this phase (separate,
    smaller follow-on) — do not scope-creep
acceptance_criteria:
  - A customer can attach a reviewed, valid prescription to an order line
  - The domain-expert review is a named, dated sign-off in the ADR for
    this phase — this phase does not ship without it
security_requirements:
  - Prescription data is the most sensitive personal data this platform
    will hold — ownership checks reviewed with the same rigor as
    financial data, encryption-at-rest evaluated explicitly
database_requirements:
  - New Prescription model, migration + rollback, same discipline as
    every prior phase (hand-authored down.sql, UP/DOWN/UP verified)
testing_requirements:
  - Domain unit tests for the (now-reviewed) validation bounds
  - Ownership/authorization e2e tests matching the pattern established
    by returns/orders
observability_requirements: []
documentation_requirements:
  - New ADR specifically citing the domain-expert review and its outcome
rollback_requirements:
  - Standard migration down.sql
estimated_complexity: M
risk: HIGH (the domain-expert-review dependency is a real, non-technical
  blocker — do not let engineering timeline pressure ship without it)
status: BLOCKED
score: 0
```

---

## Track: Inventory extension

### P021 — Procurement (Purchase Orders / Supplier)

```
phase_id: P021
name: Procurement
objective: Extend the existing inventory module with Purchase Order and
  Supplier management, reusing existing warehouse/ledger primitives.
business_value: Closes blueprint PHASE 4's remaining gap; enables real
  restocking workflows beyond manual adjustment.
dependencies: [P015]
deliverables:
  - Supplier model + CRUD
  - PurchaseOrder lifecycle (state machine, matching the existing
    convention every other domain in this repo uses)
  - Receiving a PO writes to the existing InventoryLedger (a new
    movement-vocabulary value, not a parallel ledger)
acceptance_criteria: [same rigor bar as Phase 006 — concurrency-safe
  receiving, no duplicate ledger entries under retry]
security_requirements: [RBAC permissions following the existing
  inventory.* naming convention]
database_requirements: [new migration extending inventory schema,
  down.sql, round-trip verified]
testing_requirements: [domain unit + concurrency e2e, matching every
  prior inventory-adjacent phase]
observability_requirements: []
documentation_requirements: [ADR + module README update]
rollback_requirements: [standard down.sql]
estimated_complexity: M
risk: LOW
status: NOT_STARTED
score: 0
```

---

## Deferred tracks (explicitly not started — listed for completeness, not detailed to the same depth, per the audit's own rule against inflating readiness with speculative planning)

| Track                                                             | Nearest blueprint phase | Depends on                                     | Rationale for deferral                                                                                                  |
| ----------------------------------------------------------------- | ----------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Mobile app real features                                          | PHASE 9                 | P018, P020 (build the UX once on web first)    | Flutter SDK isn't even bootstrapped; sequencing behind proven web UX avoids building the same product twice in parallel |
| CMS                                                               | PHASE 6                 | P018 (admin needed to manage content)          | Zero customer value without an admin UI to author content and a storefront to render it                                 |
| CRM beyond coupons (segmentation, campaigns, referral, support)   | PHASE 7                 | P019 (customer domain), P020                   | Segmentation needs real customer data to segment                                                                        |
| Store / POS / omnichannel                                         | PHASE 8                 | P018, P021                                     | Large, separate operational model (physical retail) — do not start until the online core is stable                      |
| AI (stylist, recommendations, smart search)                       | PHASE 10                | P020 (needs real usage data)                   | Building recommendation features against zero real traffic is speculative by definition                                 |
| Advanced Analytics                                                | PHASE 12                | P020                                           | Same reasoning — no analytics value without real volume                                                                 |
| Security Hardening completion (pentest, threat model, OWASP pass) | PHASE 13                | P016 (minimums), before P020 goes fully public | Must land before storefront is genuinely public, not before                                                             |
| Production readiness (load test, DR, runbook)                     | PHASE 14                | P016 (observability minimums)                  | Must land before any phase claims "production-ready"                                                                    |

## Testing strategy (applies to every phase above)

Unchanged from the established, proven convention: domain unit tests
(pure, no I/O) + repository/concurrency integration tests against real
PostgreSQL for anything touching money or inventory + e2e coverage
including negative/authorization cases. No mocks for financial
concurrency proofs — this has held for 8 modules and should hold for all
of the above.

## Documentation strategy (applies to every phase above)

Unchanged convention: an ADR per phase, a product scope doc, an
architecture doc section, a security doc section, an ERD update where the
schema changes, a module README, and a `CLAUDE.md`/root `README.md`
status update — the same file set every phase from 004 onward has
produced, verified accurate by this very audit.

## Explicit non-negotiables carried into every phase above

PostgreSQL remains sole source of truth. Redis never becomes a durable
business-state store. Every financial mutation stays idempotent and
concurrency-proven. Every admin mutation stays RBAC-gated. No provider-
specific logic leaks into any domain layer. No new framework or
infrastructure technology unless a phase's own audit demonstrates a
concrete requirement — none of the phases above requires one.
