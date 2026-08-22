# Procurement (Suppliers + Purchase Orders) — Phase 021 scope

Full architectural rationale: [`docs/adr/ADR-021-procurement.md`](../adr/ADR-021-procurement.md).
Full endpoint/permission reference:
[`docs/api/inventory.md`](../api/inventory.md) /
[`docs/security/inventory-security.md`](../security/inventory-security.md)
(procurement lives inside `services/api/src/modules/inventory` — it is
not a separate module). This document says what's real **today** versus
still aspirational — same convention as `docs/product/inventory.md`.

## What this phase is

The minimum real procurement path the canonical roadmap (`P021` in
`docs/roadmap/master-roadmap-v2.md`) scopes: vendor master data
(`Supplier`), a `PurchaseOrder` with line items and a real 6-state
lifecycle (`DRAFT → SUBMITTED → APPROVED → PARTIALLY_RECEIVED/RECEIVED`,
or `CANCELLED` before receiving starts), and goods receipt that writes
real stock into the existing `InventoryLedger` via the Phase 006
"readiness seam" (`PURCHASE_RECEIPT` movement type,
`InventoryItemRepositoryPort`'s row-locked mutation primitive). This is
the first phase that puts new stock into the system through anything
other than seed fixtures or a return restocking.

## Domain model at a glance

```
Supplier (ACTIVE|INACTIVE) ──< PurchaseOrder ──< PurchaseOrderItem
                                   │
                                   status: DRAFT(conceptual only) → SUBMITTED
                                     → APPROVED → PARTIALLY_RECEIVED → RECEIVED
                                                 ↘ CANCELLED (only pre-receipt)
```

Receiving a `PurchaseOrderItem` writes one `InventoryLedger` row per SKU
per receive() call (`movementType: PURCHASE_RECEIPT`,
`referenceType: 'PURCHASE_ORDER'`, `referenceId` = the purchase order's
id) and increments that item's `receivedQuantity` — both inside the same
database transaction.

## What's real (Phase 021)

- Supplier CRUD (create/update/list/get), one permission for read+write
  (`inventory.supplier.manage`), matching `Warehouse`'s own master-data
  RBAC shape.
- `PurchaseOrder` create (multi-line, validated: no duplicate SKU,
  positive quantities, non-negative cost), approve, receive (partial or
  full, repeatable while `APPROVED`/`PARTIALLY_RECEIVED`), cancel
  (only before any receiving has happened).
- A real state machine (`PurchaseOrderStateMachine`) — every transition
  asserted, illegal transitions rejected with a 409, not silently
  accepted or 500ing.
- Database `CHECK` constraints backstopping the line invariants
  (`ordered_quantity > 0`, `unit_cost >= 0`,
  `received_quantity <= ordered_quantity`) independent of the
  application layer.
- Idempotent, transaction-atomic receiving: a client-supplied
  idempotency key on `POST .../receive` makes a retried call
  (network timeout, double-click, or genuinely concurrent duplicate
  request) resolve to the already-applied state instead of double-
  crediting stock — proven with both a sequential-retry and a
  20-way-concurrent e2e test.
- Full audit trail: `PURCHASE_ORDER_CREATED`/`_APPROVED`/`_RECEIVED`/
  `_CANCELLED` audit events, each carrying the actor, the order id, and
  the resulting status.
- RBAC: `inventory.purchase_order.create`/`.approve`/`.receive`, split
  the same way `transfer.approve`/`.dispatch`/`.receive` already are —
  no role can approve or receive without the specific permission for
  that action; read routes reuse `inventory.ledger.read`.

## What's explicitly not real yet

- **Quotations / RFQs** — a purchase order today has no "requested
  price from N suppliers, compare, pick one" step; `unitCost` is entered
  directly by whoever creates the order.
- **Multi-level approval** — one `approvedBy`, no approval chain/
  threshold-based routing.
- **Attachments, notes-as-a-thread** — `PurchaseOrder.notes` is a single
  free-text field, not a separate entity with history.
- **Multi-currency, payment terms, delivery terms** — `unitCost` is
  always integer rial, matching every other money field in this repo;
  no currency/FX handling, no NET-30-style terms.
- **Budget / cost-center integration** — no linkage to any
  finance/budget concept.
- **Three-way matching** (PO vs. receipt vs. supplier invoice) — this
  phase stops at "goods received," it does not reconcile against an
  invoice (there is no supplier-invoice concept in this repo at all).
- **Procurement reporting/analytics** — no spend-by-supplier, no
  lead-time tracking, nothing beyond the raw `PurchaseOrder`/
  `InventoryLedger` rows themselves.
- **Admin frontend UI** — backend-only, matching the precedent Phase
  005/006 already set for phases whose canonical brief lists domain +
  e2e testing requirements but no UI deliverable. `apps/admin` has no
  procurement screens yet.

Any of the above, if a later phase needs it, belongs to that later
phase's own scope — none of it was silently folded into `P021`.
