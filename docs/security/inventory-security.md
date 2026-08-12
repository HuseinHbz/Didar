# Inventory security (Phase 006)

This document is `docs/security/README.md`'s "In place today" table,
expanded for the one module Phase 006 added — the 13 `inventory.*`
permissions and the four roles that hold them. Read
[`README.md`](./README.md) first for what applies service-wide (rate
limiting, secrets, dependency scanning, ...); this document only covers what's
specific to the inventory domain.

No new auth mechanism was built for this module — every control below is
Phase 004's identity/RBAC infrastructure (`JwtAuthGuard`,
`AuthorizationGuard`, `PermissionResolver`, `system.AuditLog`), reused, not
reinvented (ADR-006 decision 11). If you're looking for how JWTs, sessions,
2FA, or the permission-resolution algorithm itself work, see
`services/api/src/modules/identity/README.md` and this document's parent —
this file is scope-limited to what inventory checks and why.

## Permission registry

All 13 registered in `packages/database/prisma/seed.ts`'s `permissionDefs`,
each namespaced `inventory.<action>` and checked via `@RequirePermission` on
exactly the controller method named. Read/list endpoints use the coarser
`@RequireModule('inventory')` instead (any `inventory.*` permission is
enough to read) — see [`docs/api/inventory.md`](../api/inventory.md) for the
full endpoint-to-guard mapping.

| Permission                    | Enforced on                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `inventory.read`              | Coarse read grant (role membership check, not a route guard by itself — routes use `@RequireModule`) |
| `inventory.create`            | Coarse write grant held by `warehouse_operator`                                                      |
| `inventory.update`            | `PUT /admin/inventory/low-stock/threshold`                                                           |
| `inventory.adjust`            | `POST /admin/inventory/adjustments`                                                                  |
| `inventory.transfer.create`   | `POST /admin/inventory/transfers`                                                                    |
| `inventory.transfer.approve`  | `POST /admin/inventory/transfers/:id/approve`                                                        |
| `inventory.transfer.dispatch` | `POST /admin/inventory/transfers/:id/dispatch`                                                       |
| `inventory.transfer.receive`  | `POST /admin/inventory/transfers/:id/receive`                                                        |
| `inventory.count.create`      | `POST /admin/inventory/counts`, `POST .../:id/submit`                                                |
| `inventory.count.approve`     | `POST /admin/inventory/counts/:id/approve`, `POST .../:id/reject`                                    |
| `inventory.ledger.read`       | `GET /admin/inventory/ledger`, adjustments/transfers/counts list+detail                              |
| `inventory.warehouse.manage`  | `POST`/`PATCH /admin/inventory/warehouses`, `POST /admin/inventory/locations`                        |
| `inventory.low_stock.read`    | `GET /admin/inventory/low-stock` — held by all four inventory roles                                  |

## Roles

| Role                 | Grant                                                                                                                                                                                            | Seed user       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| `admin`              | Every `inventory.*` permission (looped grant over `permissionDefs`, `module === 'inventory'`) — same role Phase 004/005 gave every `identity.*`/`catalog.*` permission to                        | `+989120000001` |
| `inventory_manager`  | Every `inventory.*` permission — a department-head role with full module access, distinct from `admin` (no `identity.*`/`catalog.*`)                                                             | `+989120000005` |
| `warehouse_operator` | `read`, `create`, `transfer.dispatch`, `transfer.receive`, `count.create`, `low_stock.read` — day-to-day floor operations; **no** `adjust`, no `transfer.approve`, no `count.approve`            | `+989120000006` |
| `store_manager`      | `read`, `adjust`, `transfer.receive`, `count.create`, `count.approve`, `low_stock.read` — store-level authority to adjust and reconcile counts; **no** `transfer.approve`, no `warehouse.manage` | `+989120000007` |
| `inventory_auditor`  | `read`, `ledger.read`, `low_stock.read` — read-only, no mutation permission of any kind                                                                                                          | `+989120000008` |

## "Warehouse operators cannot approve their own sensitive adjustments"

The brief's own explicit rule, enforced the simplest way that's still a real
boundary: `warehouse_operator` is **never granted** `inventory.adjust`. There
is no runtime "is this your own adjustment" check layered on top, because
there doesn't need to be — the role that performs floor operations
(dispatch, receive, count submission) structurally cannot create an
adjustment at all, self-authored or otherwise. `store_manager` holds
`inventory.adjust` (a store manager legitimately corrects their own store's
stock) but not `inventory.transfer.approve` — the same asymmetry applied to
a different sensitive action. This isn't a hypothetical boundary — it's
exactly what `test/inventory.e2e-spec.ts`'s "Stock adjustment RBAC" and
"Stock transfer lifecycle + RBAC" suites log in as `warehouse_operator`/
`store_manager`/`inventory_auditor` to prove: each denied action returns a
real `403`, not a silent no-op and not "untested."

## What's proven, not just declared

- **Unauthenticated access is rejected.** Every `admin/inventory/*` and
  `internal/inventory/*` route 401s with no token — `JwtAuthGuard` is
  global, this module registers no `@Public()` opt-out on any admin/internal
  controller.
- **Under-privileged access is rejected**, proven directly in
  `test/inventory.e2e-spec.ts`, not inferred from the permission table above:
  `warehouse_operator` cannot create a warehouse or an adjustment;
  `store_manager` cannot approve a transfer; `inventory_auditor` cannot
  create an adjustment. Every case asserts a real `403`.
- **Illegal state transitions are rejected**, distinctly from permission
  checks — even a caller holding every relevant permission gets a `409` from
  `InventoryDomainExceptionFilter` for an out-of-order transfer/reservation
  transition. This is a domain-layer guard (`TransferStateMachine`/
  `ReservationRules`), independent of RBAC — the two are layered, not
  substitutes for each other.
- **Overselling is rejected under real concurrency**, not just on paper —
  the mandatory 100-simultaneous-reservations-against-10-units test
  (`test/inventory.e2e-spec.ts`'s "Concurrency safety (mandatory)" suite)
  proves exactly 10 succeed and the final on-disk state is consistent.
- **No client ever mutates inventory state directly.** There is no PUT/PATCH
  endpoint on `InventoryItem`'s quantity fields anywhere in this module —
  every mutation goes through a domain operation (reserve/release/convert,
  transfer approve/dispatch/receive, adjustment, count approve) that writes
  a ledger entry in the same transaction.

## Audit logging

Inventory is the **second** real writer of `system.AuditLog` in this repo
(catalog was first, Phase 005). Every mutation that changes stock state or
its authorization boundary writes one:

| Action                            | Audit event                     |
| --------------------------------- | ------------------------------- |
| `POST .../adjustments`            | `INVENTORY_ADJUSTMENT_CREATED`  |
| `POST .../transfers/:id/approve`  | `INVENTORY_TRANSFER_APPROVED`   |
| `POST .../transfers/:id/dispatch` | `INVENTORY_TRANSFER_DISPATCHED` |
| `POST .../transfers/:id/receive`  | `INVENTORY_TRANSFER_RECEIVED`   |
| `POST .../counts/:id/approve`     | `INVENTORY_COUNT_APPROVED`      |

`InventoryLedger` itself is the parallel, append-only **stock-history**
trail (what changed, before/after quantities, why, correlation id) — the two
records serve different audiences, same split `docs/security/catalog-security.md`
documents for `PriceHistory` vs. `AuditLog`: the ledger is "what was the
stock at time T and why," `AuditLog` is "who changed it and when," scoped to
the RBAC-relevant subset of actions.

## Deliberately not built this phase

Same list as `services/api/src/modules/inventory/README.md`'s "Deliberately
out of scope," security-relevant subset:

- **No separate service-to-service auth** for `/internal/inventory/*` — those
  routes are behind the same `JwtAuthGuard`/`AuthorizationGuard` as every
  admin route (`@RequireModule('inventory')`), not a distinct machine-to-
  machine credential. A future cart/checkout/POS caller authenticates the
  same way an admin user does today.
- **No field-level permission on inventory data** — Phase 004 built the
  mechanism (`identity.users.view_contact`) and proved it once; inventory
  doesn't reuse it for anything (no inventory field is sensitive enough to
  need it yet).
- **No rate limiting specific to inventory writes** — same blanket nginx
  `limit_req_zone` as everything else, see `docs/security/README.md`'s
  "Not yet" list.
- **No two-person four-eyes approval** anywhere in this module (a single
  `inventory.transfer.approve`/`inventory.count.approve` holder can approve
  alone) — the same still-unbuilt blueprint §57-§58/§105 pattern
  `docs/security/catalog-security.md` documents.
