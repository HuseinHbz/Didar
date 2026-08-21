# Returns / refunds / credit-notes API (Phase 012)

Endpoint reference for `services/api/src/modules/return`. This document
follows [`README.md`](./README.md)'s conventions (`/api/v1` base path,
whitelist validation, no GraphQL) — read that document first for what
applies to every endpoint in the service, not just this module's. For the
generated, always-in-sync spec, run the service and open `/api/v1/docs`;
the tables below are a hand-maintained companion for reviewing scope
without booting anything. Full rationale:
[`docs/adr/ADR-012-returns-refunds-credit-notes.md`](../adr/ADR-012-returns-refunds-credit-notes.md).

Module-level design detail (layering, the state machines, what's
deliberately not built): [`services/api/src/modules/return/README.md`](../../services/api/src/modules/return/README.md).
Auth model: [`docs/security/returns-security.md`](../security/returns-security.md).

## Auth: two models, split by who calls each route

- **`returns/*`** reuses `cart-checkout`'s own `ActorResolverGuard`
  directly (imported, not reimplemented) — a return's owner is exactly
  its originating order's owner. See `docs/api/cart-checkout.md`'s
  "Auth" section for the exact guest/authenticated resolution rules;
  they apply unchanged here. `cancel`/`ship` consume no RBAC permission
  — the customer's own withdrawal/shipping-notice actions,
  ownership-gated by `ReturnService` itself.
- **`admin/returns/*`** / **`admin/credit-notes/*`** are permission-gated
  admin routes behind the service's global `JwtAuthGuard` +
  `AuthorizationGuard`, exactly like every other `admin/*` route in this
  service. No `@Public()`, no guest path.

## Returns (customer/guest)

| Method | Path                  | Auth               | Notes                                                                                   |
| ------ | --------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| POST   | `/returns`            | Actor (owner only) | Create a return request against one or more of the caller's own delivered order items   |
| GET    | `/returns`            | Actor (owner only) | List the caller's own returns                                                           |
| GET    | `/returns/:id`        | Actor (owner only) | Read one return, its items, and its status history                                      |
| POST   | `/returns/:id/cancel` | Actor (owner only) | Withdraw a return still `REQUESTED`/`APPROVED`/`CUSTOMER_SHIPPING` — gone once received |
| POST   | `/returns/:id/ship`   | Actor (owner only) | Customer's own shipping notice — `APPROVED -> CUSTOMER_SHIPPING`                        |

## Returns (admin)

| Method | Path                                | Permission       | Notes                                                                                                                                     |
| ------ | ----------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/returns`                    | `return.read`    | List/search any return — `status`, `orderId`, `requestedFrom`/`requestedTo` (any combination, real `WHERE` clauses)                       |
| GET    | `/admin/returns/:id`                | `return.read`    | Read one return, no ownership check                                                                                                       |
| POST   | `/admin/returns/:id/approve`        | `return.approve` | `REQUESTED -> APPROVED`                                                                                                                   |
| POST   | `/admin/returns/:id/reject`         | `return.reject`  | `REQUESTED`/`APPROVED`/`INSPECTING -> REJECTED`, requires a `reason` — never restocks                                                     |
| POST   | `/admin/returns/:id/receive`        | `return.receive` | `CUSTOMER_SHIPPING -> RECEIVED` — captures the real `warehouseId`/`locationId` the goods physically arrived at                            |
| POST   | `/admin/returns/:id/inspect`        | `return.inspect` | `RECEIVED -> INSPECTING` — records each returned item's `condition`; computes and stores `refundAmount` at this step                      |
| POST   | `/admin/returns/:id/approve-refund` | `return.refund`  | `INSPECTING -> APPROVED_FOR_REFUND` — restocks resalable items exactly once, drafts a `CreditNote` if `resolution === CREDIT_NOTE`        |
| POST   | `/admin/returns/:id/refund`         | `return.refund`  | `APPROVED_FOR_REFUND -> REFUNDED` — requests the settlement (a real `Refund` or the drafted `CreditNote`'s issuance) before transitioning |

`approve-refund` and `refund` share one permission (`return.refund`) —
two routes, one permission, the same shape `order.shipment.deliver`
being its own dedicated permission does _not_ preclude two routes
sharing one grant elsewhere in this schema.

## Credit notes (admin)

| Method | Path                            | Permission          | Notes                                                                                                                                                                                            |
| ------ | ------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/admin/credit-notes`           | `credit_note.read`  | List by `orderId` or `returnRequestId` (exactly one filter; neither given returns an empty list)                                                                                                 |
| GET    | `/admin/credit-notes/:id`       | `credit_note.read`  | Read one credit note and its lines                                                                                                                                                               |
| POST   | `/admin/credit-notes/:id/issue` | `credit_note.issue` | `DRAFT -> ISSUED` — manual recovery path for the documented crash window between `approve-refund` and `refund`, not the normal flow (a `DRAFT` note is issued automatically as part of `refund`) |
| POST   | `/admin/credit-notes/:id/void`  | `credit_note.void`  | `DRAFT`/`ISSUED -> VOID`, requires a `reason`                                                                                                                                                    |

There is no standalone "create an ad-hoc credit note" route — a `DRAFT`
note is only ever created as a side effect of `POST
/admin/returns/:id/approve-refund` when the return's `resolution` is
`CREDIT_NOTE`.

## Return settlements (admin, Phase 013)

| Method | Path                                  | Permission                    | Notes                                                                                                                                                         |
| ------ | ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/returns/settlements`          | `return.settlement.read`      | Every settlement not yet `COMPLETED`/`FAILED_TERMINAL`/`MANUAL_REVIEW` (the default "active" view); `?status=MANUAL_REVIEW` for the escalated-for-review view |
| GET    | `/admin/returns/:id/settlement`       | `return.settlement.read`      | Read one return's settlement — worker/queue metadata (`attempts`, `lastError`) included, admin-only; 404 if no settlement row exists yet                      |
| POST   | `/admin/returns/:id/settlement/retry` | `return.settlement.retry`     | Manually re-drive a stuck or `MANUAL_REVIEW` settlement through the same idempotent methods the sweep uses; real 409 if `FAILED_TERMINAL`                     |
| POST   | `/admin/returns/:id/reconcile`        | `return.settlement.reconcile` | Runs the same global `reconcileAll()` engine every sweep tick runs, returns only this return's own findings                                                   |

No "force complete" route exists, or ever will — every mutation above
is a real, row-locked, state-machine-validated transition, or a call
into the same idempotent methods `beginRestock()`/`requestSettlement()`
the synchronous `approve-refund`/`refund` routes above already use.
Full account: [`docs/security/returns-security.md`](../security/returns-security.md)'s
own Phase 013 section.

## Return reasons, resolutions, and item conditions

```
ReturnReason           DAMAGED | DEFECTIVE | WRONG_ITEM |
                         NOT_AS_DESCRIBED | CHANGED_MIND |
                         SIZE_FIT_ISSUE | OTHER
ReturnResolution        REFUND | CREDIT_NOTE   (default REFUND)
ReturnItemCondition     UNOPENED | OPENED_UNUSED | USED | DAMAGED |
                         DEFECTIVE
```

Only `UNOPENED`/`OPENED_UNUSED` items are restocked at `approve-refund`
— `USED`/`DAMAGED`/`DEFECTIVE` items are recorded (with their own
computed `refundAmount`, still refunded/credited) but never returned to
sellable inventory.

## Idempotency

| Operation                                 | Mechanism                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Return creation                           | Optional client-supplied `idempotencyKey`, `@unique` — same P2002-catch-and-reread pattern `Fulfillment.idempotencyKey` established in Phase 011                                                                    |
| Return-quantity invariant                 | `SELECT ... FOR UPDATE` row lock on the target `OrderItem` row(s) inside the same transaction as the new `ReturnItem` insert, re-summing every non-`REJECTED`/non-`CANCELLED` return                                |
| Return/credit-note status transitions     | `SELECT ... FOR UPDATE` row lock, re-checking the state machine against the locked row — a retried identical transition is a safe no-op, never a duplicate history row                                              |
| Refund creation                           | `Refund.idempotencyKey = return-refund__${returnRequestId}`, `@unique` — a retried/racing `refund()` call never double-refunds                                                                                      |
| Credit-note issuance                      | No separate key — the `DRAFT` row is only ever created once, structurally guarded by the same `APPROVED_FOR_REFUND` row lock; `CreditNoteStateMachine.isNoOp` makes any retried `DRAFT -> ISSUED` call a safe no-op |
| Inventory restock                         | No separate key — unreachable a second time once the return is `APPROVED_FOR_REFUND` (see the transitioned-gate above)                                                                                              |
| Restock (Phase 013, per item)             | `InventoryLedger.idempotencyKey = return-restock__${returnItemId}`, `@unique` — `beginRestock()` re-driven any number of times (synchronous path, recovery sweep, reconciliation) restocks each item at most once   |
| `Order.refundedTotal` update (Phase 013)  | `ReturnSettlement.refundRecordedAt`, claimed via a single atomic `UPDATE ... WHERE refund_recorded_at IS NULL RETURNING id` — at most one caller ever records a given return's refund against the order total       |
| Settlement status transitions (Phase 013) | `SELECT ... FOR UPDATE` row lock, re-checking `ReturnSettlementStateMachine` against the locked row — same pattern as return/credit-note transitions above                                                          |
| Reconciliation runs (Phase 013)           | No separate key — `reconcileAll()` only ever calls the same idempotent methods above; running it any number of times converges to the same end state, never duplicates a side effect                                |

## Errors

Twelve domain error types get a real HTTP mapping via
`ReturnDomainExceptionFilter` (`APP_FILTER`, scoped `@Catch()`):

| Domain error                                         | HTTP status |
| ---------------------------------------------------- | ----------- |
| `InvalidReturnTransitionError`                       | 409         |
| `OverReturnedError`                                  | 409         |
| `ReturnNotEligibleError`                             | 409         |
| `InvalidCreditNoteTransitionError`                   | 409         |
| `InvalidReturnSettlementTransitionError` (Phase 013) | 409         |
| `NonPositiveReturnQuantityError`                     | 400         |
| `CreditNoteLineSumMismatchError`                     | 500         |
| `CreditNoteGrandTotalMismatchError`                  | 500         |
| `CreditNoteExceedsRefundableAmountError`             | 500         |
| `NonPositiveCreditNoteAmountError`                   | 500         |
| `MissingImmutableSnapshotError` (Phase 013)          | 500         |
| `NonPositiveRestockQuantityError` (Phase 013)        | 500         |

The six 500-mapped errors only ever fire against server-computed
values, never client input, so if one ever throws it means a genuine
internal-consistency bug, not a bad request. `InvalidReturnSettlementTransitionError`
is 409 — a premature settlement action (e.g. requesting the refund
before restock has completed), the same "real conflict, not a bad
request" shape every other transition error here already gets.

Ownership violations on `returns/*` (an actor reading/cancelling/shipping
a return that isn't theirs) are a plain `403 Forbidden`, thrown directly
by `ReturnService`'s own ownership checks — not routed through the
domain exception filter above, same convention `docs/api/order.md`'s
"Errors" section documents for its own module.

This is intentionally narrower than `docs/api/README.md`'s noted-as-future
general error-shape standardization — it covers exactly this module's
domain-layer error types, not a service-wide `{success, error, requestId}`
envelope.
