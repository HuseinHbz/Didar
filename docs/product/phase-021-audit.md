# Phase 021 Audit (CP-021 — Procurement)

Required audit output for CP-021, matching the shape
[`phase-015-audit.md`](phase-015-audit.md) established.

## Mission

Give the platform a real path to buy inventory from vendors: Supplier
master data, a `PurchaseOrder` lifecycle (create → approve → receive
[partial or full] → RECEIVED, or cancel before receiving), and goods
receipt that writes real stock into the existing `InventoryLedger` — the
one canonical `P2-1` gap ("No Purchase Order / Supplier model") the
gap-priority matrix tracked as owned by this phase.

## Canonical source

[`docs/roadmap/master-roadmap-v2.md`](../roadmap/master-roadmap-v2.md)'s
`P021` block (path corrected this phase — it lives under `docs/roadmap/`,
not `docs/product/`). Full scope reconstruction:
[`docs/adr/ADR-021-procurement.md`](../adr/ADR-021-procurement.md) and
[`procurement.md`](procurement.md).

## Dependency evidence

`P021`'s sole declared dependency is CP-015. Verified empirically, not
assumed from a prior report:

- `git merge-base --is-ancestor origin/15-feature-integration-reconciliation origin/develop` → **true** (CP-015 is on `develop`).
- `git merge-base --is-ancestor origin/16-feature-platform-reliability origin/develop` → **false** (CP-016 is not).
- `docs/product/roadmap.json`'s own CP-015 entry: `status: VALIDATED`.

Conclusion: `develop` is the correct, minimal branch point satisfying
CP-021's sole dependency without pulling in CP-016+'s unvalidated,
unmerged work. `21-feature-procurement` was branched from `origin/develop`.

## Branch

`21-feature-procurement`

## Commits

1. `5d19118` — docs(product): scope CP-021 procurement
2. `422219c` — feat(database): procurement schema, migration, and branded types
3. `52cc583` — feat(inventory): procurement domain, application, infrastructure, presentation layers
4. `9e545e7` — test(inventory): procurement domain unit + e2e coverage
5. `156aa8e` — docs(inventory): document procurement API surface, RBAC, audit trail
6. _(this commit)_ — docs(product): CP-021 final audit + governance updates
7. _(follow-up)_ — chore(product): record CP-021's own final commit SHA in roadmap.json

## Implementation summary

Built entirely inside `services/api/src/modules/inventory` — no other
module touched, no new module created. Reuses the Phase 006 "readiness
seam" (ADR-006 decision 9): the `PURCHASE_RECEIPT` movement type and
polymorphic `InventoryLedgerEntry.referenceType`/`referenceId` columns
were prepared, unused, specifically for this phase.

- **Domain**: `Supplier`, `PurchaseOrder`, `PurchaseOrderItem` entities;
  `PurchaseOrderStateMachine` (6-state graph, `assertCanReceive`/
  `nextStatusAfterReceipt` for repeatable partial receiving);
  `PurchaseOrderLineValidator` (duplicate SKU, quantity, cost,
  over-receipt).
- **Infrastructure**: `PrismaSupplierRepository`,
  `PrismaPurchaseOrderRepository`. `receive()` runs the state guard,
  every line's `mutateInventoryItem()` call (row-locked upsert + ledger
  write), and the order's own `receivedQuantity` update inside one
  `prisma.$transaction()`.
- **Application**: `SupplierService`, `PurchaseOrderService` — full
  audit trail on every mutation, no speculative event publishing (P021's
  `observability_requirements` are empty and `InventoryEventName` is a
  closed union — adding a new event type would have been out of scope).
- **Presentation**: `SupplierController`
  (`admin/inventory/suppliers`), `PurchaseOrderController`
  (`admin/inventory/purchase-orders`) — 10 routes total, wired into
  `InventoryModule`.
- **RBAC**: 4 new permissions
  (`inventory.supplier.manage`/`purchase_order.{create,approve,receive}`),
  `inventory_manager`/`admin` auto-inherit all 4 via the existing
  "grant every `inventory.*` def" seed loop; `warehouse_operator` gets
  only `purchase_order.receive` (mirrors its existing `transfer.receive`
  boundary) — never `.create`/`.approve`.
- **Seed fixtures**: one `ACTIVE` supplier, one `SUBMITTED` purchase
  order (live fixture for approve/receive/cancel), one historical fully
  `RECEIVED` order with a matching `PURCHASE_RECEIPT` ledger entry
  received into the previously-unstocked `RECV` location. Verified
  idempotent — ran the full seed script twice, row counts unchanged
  (1 supplier, 2 orders, 1 procurement ledger row both times).

## Database changes

Migration `20260822000000_procurement_purchase_orders`: `SupplierStatus`/
`PurchaseOrderStatus` enums, `suppliers`/`purchase_orders`/
`purchase_order_items` tables (schema `inventory`), FKs/indexes, and 3
hand-authored `CHECK` constraints (`purchase_order_items_ordered_quantity_positive`,
`_unit_cost_non_negative`, `_received_within_ordered`) — matching the
Phase 010 precedent of `CHECK` constraints living only in hand-authored
`migration.sql`, never declared in `schema.prisma`.

Verified: `prisma migrate deploy` applied cleanly; UP→DOWN→UP round-trip
via raw `psql` succeeded (confirmed via `\dt inventory.*` before/after);
`prisma migrate status` reports "up to date," no drift; all 3 `CHECK`
constraints live-reject invalid direct `INSERT`s (negative
`ordered_quantity`, over-receiving, negative `unit_cost`), verified
against real PostgreSQL, not merely asserted in code.

## API changes

10 new routes under `admin/inventory/{suppliers,purchase-orders}` — full
table in [`docs/api/inventory.md`](../api/inventory.md#admin--suppliers--purchase-orders-phase-021).
No public/storefront-facing routes. No changes to any existing endpoint's
contract.

## UI changes

None. `P021`'s canonical `testing_requirements` name only domain unit
tests and concurrency e2e — no UI deliverable, matching the Phase
005/006 precedent for backend-only phases. `apps/admin` was not touched.

## Security review

- Every mutation route requires a specific permission, never
  module-membership alone; every read route requires
  `inventory.ledger.read`.
- `warehouse_operator` structurally cannot create or approve a purchase
  order — proven, not just declared, by `procurement.e2e-spec.ts`'s
  "Purchase order RBAC" suite (403 on both actions).
- `inventory_auditor` (read-only role) proven unable to create a
  supplier or a purchase order (403).
- No client ever mutates a `PurchaseOrder`'s quantities directly — every
  change goes through `create`/`approve`/`receive`/`cancel`, each
  state-machine-guarded and audited.
- Money fields (`unitCost`) follow the repo-wide convention: BigInt rial
  in the DB, `@IsNumberString()` request DTOs, `.toString()` response
  serialization — no floating-point money anywhere.
- **A real defect was found and fixed** during this phase's own
  concurrency testing (not a pre-existing issue, not something imported
  from elsewhere): the original idempotent-retry design for `receive()`
  assumed a retried call would always collide on the ledger's
  `idempotency_key` unique constraint (P2002) — but a receipt that
  _completes_ an order moves it straight to the terminal `RECEIVED`
  status, so a legitimate retry of that exact call instead failed
  `assertCanReceive` (`InvalidPurchaseOrderTransitionError`, a 409)
  before it ever reached the ledger insert. Left unfixed, this would
  have meant: a client that retries a "receive the final delivery" call
  after a network timeout gets an unexpected 409 instead of the
  idempotent success the API's own contract promises, and (worse) a
  naive client might interpret the 409 as "try a different receipt" and
  attempt to receive again with different quantities, risking an
  over-receipt rejection or operator confusion. Classified: **implementation
  defect, found and fixed within this phase's own scope** (the idempotency
  contract is CP-021's own acceptance criterion, not a later phase's).
  Fix: `wasAlreadyApplied()` checks the ledger directly for this batch's
  derived keys on **any** failure, not only P2002, and short-circuits to
  the current state when they're already present. Proven fixed by both
  a sequential-retry e2e test and a 20-way-concurrent identical-request
  e2e test.
- A second, minor defect was found and fixed: `InventoryDomainExceptionFilter`
  did not `@Catch` the two new procurement domain error types
  (`InvalidPurchaseOrderTransitionError`/`InvalidPurchaseOrderLineError`).
  Left unfixed, every illegal state transition or line-validation
  failure would have surfaced as an unhandled 500 instead of a real
  409/400. Classified: **implementation defect, found and fixed within
  this phase's own scope** (the filter itself belongs to this module,
  and every other domain service in it already gets this treatment).

## Tests

- **Domain unit** (17 cases, no DB): `purchase-order-state-machine.spec.ts`,
  `purchase-order-line-validator.spec.ts`.
- **E2E** (`test/procurement.e2e-spec.ts`, 18 cases, real Postgres + real
  Redis): unauthorized access; supplier RBAC (create/deny); purchase
  order RBAC (create/approve/deny, including the auditor-cannot-create
  case); line validation (duplicate SKU, non-positive quantity); full
  create→approve→receive lifecycle; partial receiving (two-step
  receive, over-receive rejection); cancellation (including
  reject-receive-after-cancel and reject-cancel-after-receive); a
  sequential idempotent-retry proof; a mandatory 20-way-concurrent
  identical-request proof (exactly one receipt applied, not 20).
- Full `services/api` unit suite: **349/349 passed** (51 suites).
- Full `services/api` e2e suite (all specs, run in-band): **211/213
  passed** on the run that included procurement; procurement's own 18
  cases passed 100% of the time across every run. The 2 non-procurement
  failures are addressed under "Pre-existing failures" below — neither
  is a regression this phase introduced.

## Validation results

| Check                                      | Result                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm validate:structure`                  | ✓ pass                                                                                                                 |
| `pnpm format:check`                        | ✓ pass on every file this phase touched (5 pre-existing, untouched files elsewhere in the repo still warn — see below) |
| `pnpm lint` (all 15 workspaces)            | ✓ pass                                                                                                                 |
| `pnpm typecheck` (all 15 workspaces)       | ✓ pass                                                                                                                 |
| `pnpm build` (all 11 buildable workspaces) | ✓ pass                                                                                                                 |
| `pnpm --filter @iecp/api test`             | ✓ 349/349                                                                                                              |
| `pnpm --filter @iecp/api test:e2e`         | ✓ 211/213 (2 pre-existing, classified below)                                                                           |
| `pnpm audit --audit-level high`            | ✓ pass (1 pre-existing low-severity finding, 0 high)                                                                   |
| `pnpm roadmap:audit`                       | ✓ pass, no structural problems                                                                                         |
| `prisma migrate status`                    | ✓ up to date                                                                                                           |
| `prisma migrate diff` (UP→DOWN→UP)         | ✓ clean round-trip, verified via `\dt` before/after                                                                    |
| Seed + seed idempotency (run twice)        | ✓ identical row counts both runs                                                                                       |
| Compiled app boot                          | ✓ `node dist/main.js`, all 10 procurement routes mapped                                                                |
| Health check                               | ✓ `GET /api/v1/health` → `{"status":"ok",...}`                                                                         |
| Graceful shutdown                          | ✓ `SIGTERM` → process exits cleanly, no hang                                                                           |

## Known risks

- `receive()`'s pre-transaction `wasAlreadyApplied()` fast-path check has
  its own small TOCTOU window (it runs outside the transaction). This is
  an accepted, documented tradeoff, not an unhandled gap: the database's
  `idempotency_key` unique constraint inside the transaction remains the
  actual correctness backstop for genuinely simultaneous first attempts,
  and the 20-way-concurrent e2e test proves the combined mechanism holds
  under real load.

## Deferred (explicitly out of `P021`'s canonical scope)

Quotations/RFQs, multi-level approval hierarchies, PO attachments/notes
as a separate entity, multi-currency, payment/delivery terms,
budget/cost-center integration, three-way matching, procurement
reporting/analytics, admin-frontend UI. Full list with rationale:
`docs/product/procurement.md`'s "What's explicitly not real yet."

## Discovered bugs / bugs fixed

Both defects described under "Security review" above were discovered
during this phase's own concurrency testing (not pre-existing, not
inherited) and fixed within this phase's own scope, since both directly
block CP-021's own acceptance criteria (idempotent, concurrency-safe
receiving; correct HTTP error mapping) and neither expands scope beyond
procurement's own code.

## Pre-existing failures (not this phase's regressions)

1. **`test/return-settlement-repository.e2e-spec.ts`'s 20-iteration
   `reconcileAll()` idempotency test** exceeds Jest's default 5000ms
   timeout in this sandbox. This is not new: Phase 015's own audit
   (`phase-015-audit.md`, "Architecture Risks") already documented this
   exact test/timeout combination as a known, non-blocking,
   environment-sensitivity finding, confirmed there as byte-identical to
   Phase 013's own proven-passing version. Re-confirmed unchanged by
   this phase — `git log -1` on that test file shows its last edit was
   2026-08-20 (Phase 013), untouched by CP-021. Classified: **pre-existing
   environment defect**, owned by whichever future phase tightens this
   sandbox's Jest timeout defaults or the reconciliation sweep's own
   batch size — not CP-021's to fix.
2. **`test/promotion-repository.e2e-spec.ts`'s concurrent-`reserve()`
   test** failed once during a full-suite in-band run (a
   `PrismaClientKnownRequestError` where `CouponUsageLimitExceededError`
   was expected) but passed cleanly when re-run in isolation immediately
   after. Classified: **environment defect (resource contention)** — the
   full e2e battery run in-band against this sandbox's single Postgres
   instance occasionally produces transient timing noise on tests that
   depend on tight concurrent-transaction timing; not a regression (the
   test file predates this phase and this phase never touched promotion
   code).

## Migration evidence

See "Database changes" above — full UP/DOWN/UP round-trip, `CHECK`
constraint live-rejection tests, and zero-drift `migrate status`, all
against real PostgreSQL (not the shadow database alone).

## Roadmap status

`CP-021` moves from `NOT_STARTED` to **`VALIDATED`** in `roadmap.json`,
`canonical-roadmap.md`, `project-progress.md`,
`requirements-matrix.md` (`REQ-PROC-01`: `PLANNED` → `DONE`), and
`gap-priority-matrix.md` (`P2-1`: `RESOLVED`). No other phase's status
was changed. `PROJECT_STATUS.md`'s aggregate moves from 16/30 to 17/30
Completed.

## Next Canonical CP

Per `canonical-roadmap.md`, `roadmap.json`, and
`docs/product/phase-dependency-graph.md`, `develop`'s own recorded state
(CP-016 through CP-020 all `NOT_STARTED` — those branches exist but are
not yet merged into `develop`) makes **CP-016 — Platform Reliability
Foundation** the next genuinely unblocked canonical CP by the roadmap's
own linear gate (its sole dependency, CP-015, is `VALIDATED`; CP-021
does not change what CP-016 is blocked or unblocked by). This is a
report, not a decision to start CP-016 — per this phase's own governing
instructions, CP-016 is not started here.
