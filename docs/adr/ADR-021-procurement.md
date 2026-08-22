# ADR-021 — Procurement (Suppliers + Purchase Orders)

**Status**: Accepted
**Phase**: **021** (`services/api/src/modules/inventory` — additive; no other module touched)

## 1. Problem

The canonical roadmap (`docs/roadmap/master-roadmap-v2.md`, block `P021`)
identifies procurement as the one Phase-4 gap the gap-priority matrix
tracks as `P2-1`: "No Purchase Order / Supplier model" — nothing writes
new stock into the system except the Phase 006 seed fixtures and returns
restocking (ADR-012). A real e-commerce operation needs to buy inventory
from vendors and receive it into a warehouse; that path didn't exist.

`P021`'s canonical scope is deliberately narrow: **Supplier master data +
a `PurchaseOrder` lifecycle state machine + goods receipt that writes to
the existing `InventoryLedger`**. It explicitly excludes quotations,
multi-level approval hierarchies, attachments/notes, multi-currency,
payment/delivery terms, budget/cost-center integration, three-way
matching, and reporting — all left for a later phase if the roadmap ever
schedules one. `estimated_complexity: M`, `risk: LOW`.

## 2. The Phase 006 "readiness seam" (ADR-006 decision 9)

Re-reading the inventory module before designing anything new found that
Phase 006 had already deliberately prepared for this phase:

- `InventoryMovementType` already has a `PURCHASE_RECEIPT` value — unused
  until now.
- `InventoryLedgerEntry.referenceType`/`referenceId` are untyped/
  polymorphic specifically so a future `PurchaseOrder` id could be
  written there with zero schema change.
- `InventoryItemRepositoryPort.receiveStock()` is a fully transactional,
  idempotent (P2002-catch-and-reread) "receive new stock" primitive with
  a doc comment literally calling itself "the readiness seam for a
  future Procurement phase's goods receipt."

This phase uses that seam rather than inventing a parallel stock-writing
path: `PurchaseOrder` receiving writes `PURCHASE_RECEIPT` /
`referenceType: 'PURCHASE_ORDER'` ledger rows through the same
`mutateInventoryItem()` function every other inventory mutation in this
module funnels through (called directly, not via `receiveStock()` itself
— see Decision 4 below).

## 3. Domain entities

- **`Supplier`** — vendor master data. `code` (unique), `name`, optional
  contact fields, `status` (`ACTIVE`/`INACTIVE`). No lifecycle beyond
  active/inactive — same shape `Warehouse` already establishes for
  master data in this module.
- **`PurchaseOrder`** — `poNumber` (unique, server-generated), links to
  one `Supplier` and one `Warehouse`, a `status` (see Decision 4),
  `createdBy`/`approvedBy` (user references), `approvedAt`/`cancelledAt`/
  `receivedAt` timestamps, optional `notes`.
- **`PurchaseOrderItem`** — one line per `(purchaseOrderId, productSkuId)`
  (unique), `orderedQuantity`, `receivedQuantity` (starts at 0,
  incremented by each receipt), `unitCost` (BigInt rial, matching the
  repo-wide money convention).

No `Quotation`, no `SupplierContact` as a separate entity, no approval
hierarchy beyond a single `approvedBy` — none of these are in `P021`'s
canonical scope.

## 4. State machine

```
DRAFT ──assertTransition──> SUBMITTED ──> APPROVED ──> PARTIALLY_RECEIVED ──> RECEIVED
                                │                │
                                └──> CANCELLED <─┘
```

`PurchaseOrder.create()` writes the row directly into `SUBMITTED` — it
never persists a `DRAFT` row. This mirrors `StockTransfer.create()`'s
own precedent exactly (`StockTransfer` never persists `DRAFT` either);
`DRAFT` exists only as the conceptual starting point
`PurchaseOrderStateMachine.assertTransition('DRAFT', 'SUBMITTED')`
asserts against.

Receiving is **not** a simple table lookup: a real delivery rarely
arrives in one shipment, so `receive()` is callable more than once while
an order is `APPROVED` or `PARTIALLY_RECEIVED`. `assertCanReceive` guards
the starting state; `nextStatusAfterReceipt(allLinesFullyReceived)`
computes the destination — `RECEIVED` only if every line's
`receivedQuantity >= orderedQuantity`, `PARTIALLY_RECEIVED` otherwise.
Cancellation is only reachable from `DRAFT`/`SUBMITTED`/`APPROVED` — the
same "once something real happened physically, it's a new inverse
operation, not a status flip" rule `StockTransfer` enforces past
`DISPATCHED`.

## 5. Invariants enforced

Line-level (`PurchaseOrderLineValidator`, checked in the application
layer _and_ backstopped by database `CHECK` constraints):

- At least one line per order.
- `orderedQuantity > 0`, `unitCost >= 0`.
- No duplicate SKU within one order (combine into a single line instead).
- A receipt's `receivedQuantity` is positive and never exceeds what's
  still outstanding on that line (`orderedQuantity - receivedQuantity`)
  — backstopped by the `purchase_order_items_received_within_ordered`
  `CHECK` constraint.

State-level (`PurchaseOrderStateMachine`): every transition above; no
approving/receiving/cancelling a `RECEIVED` or `CANCELLED` order; no
receiving a not-yet-`APPROVED` order.

## 6. Idempotent, transactional receiving

`PrismaPurchaseOrderRepository.receive()` runs the whole batch — the
state guard, every line's `mutateInventoryItem()` call (row-locked
`InventoryItem` upsert + `PURCHASE_RECEIPT` ledger write), and this
order's own `PurchaseOrderItem.receivedQuantity` increments — inside one
`prisma.$transaction()`. A partial failure on line 2 of 3 rolls line 1
back too; nothing is ever left half-applied.

`mutateInventoryItem()` is called directly (not `receiveStock()` itself,
which opens its own internal transaction) specifically so this order's
own row-updates share one transaction with the ledger write — genuine
cross-entity atomicity, not two separate commits that could observe each
other torn apart.

Each line's ledger write carries a derived idempotency key
(`${idempotencyKeyPrefix}__${productSkuId}`, when the caller supplies
one) against `InventoryLedger.idempotencyKey`'s existing
`@unique`constraint (added by Phase 013). **A defect was found and fixed
during this phase's own validation**: the original design assumed a
retried call would always collide on that unique constraint (the same
P2002-catch-and-reread pattern `receiveStock()` itself uses) — but a
receipt that _completes_ an order moves it straight to the terminal
`RECEIVED` status, so a legitimate retry of that exact call instead fails
`assertCanReceive` (an `InvalidPurchaseOrderTransitionError`) before it
ever reaches the ledger insert that would have raised the P2002. The fix
(`wasAlreadyApplied()`) checks the ledger directly for this batch's keys
on **any** failure, not only P2002, and short-circuits to the current
state when they're already present — covering both failure shapes with
one recovery path. Verified with both a sequential-retry e2e test and a
20-way-concurrent identical-request e2e test (`procurement.e2e-spec.ts`).

## 7. RBAC

New `inventory.*` permissions, following the module's existing naming
convention exactly:

| Permission                         | Grants                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `inventory.supplier.manage`        | Create/edit suppliers (one permission for read+write, same shape `warehouse.manage` already establishes for master data) |
| `inventory.purchase_order.create`  | Create or cancel a purchase order                                                                                        |
| `inventory.purchase_order.approve` | Approve a submitted order                                                                                                |
| `inventory.purchase_order.receive` | Record a goods receipt                                                                                                   |

Read routes (`GET .../purchase-orders`, `GET .../purchase-orders/:id`)
reuse the existing `inventory.ledger.read` permission — the same choice
`TransferController`/`AdjustmentController` already made for their own
read routes (a purchase order's history is, structurally, ledger-
adjacent). `inventory_manager` auto-inherits every new permission via its
existing "grant every `inventory.*` def" seed loop; `admin` auto-
inherits them the same way. `warehouse_operator` gets only
`purchase_order.receive` — the same floor-level "receive the physical
goods" boundary it already has for `transfer.receive` — never
`.create`/`.approve` (the "floor role can't approve its own sensitive
action" rule this module enforces everywhere else).

## 8. Deliberately deferred (out of `P021`'s canonical scope)

Quotations/RFQs, multi-level approval chains, PO attachments/notes as a
separate entity, multi-currency, payment/delivery terms, budget/cost-
center linkage, three-way matching (PO vs. receipt vs. invoice),
procurement reporting/analytics, and any admin-frontend UI (the canonical
brief's `testing_requirements` names only domain unit tests and
concurrency e2e — no UI deliverable, matching the precedent Phase 005/006
set for "backend-only, defer UI" phases).

## Consequences

Positive: reuses every existing abstraction (state machine shape,
P2002-catch-and-reread idempotency, `mutateInventoryItem`, pagination,
RBAC naming, audit conventions) — no new infrastructure, no new
observability stack, no speculative endpoints. The Phase 006 readiness
seam paid off exactly as ADR-006 anticipated.

Accepted limitation: `receive()`'s pre-transaction idempotency check
(`wasAlreadyApplied`) has its own small TOCTOU window (it runs outside
the transaction as a fast-path); the database's unique constraint inside
the transaction remains the actual correctness backstop for genuinely
simultaneous first attempts. This mirrors the same acknowledged-and-
accepted-elsewhere shape (e.g. `InventoryReservation`'s own optimistic
checks) rather than introducing a new pattern.
