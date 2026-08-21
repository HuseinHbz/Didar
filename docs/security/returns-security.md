# Returns / refunds / credit-notes security (Phase 012)

This document is `docs/security/README.md`'s "In place today" table,
expanded for the module Phase 012 added. Read
[`README.md`](./README.md) first for what applies service-wide (rate
limiting, secrets, dependency scanning, ...); this document only covers
what's specific to the return/refund/credit-note domain. Full rationale:
[`docs/adr/ADR-012-returns-refunds-credit-notes.md`](../adr/ADR-012-returns-refunds-credit-notes.md).

Same two-model split `docs/security/order-security.md` documents — see
`docs/api/returns.md`'s "Auth" section for the exact route grouping.

## Two auth models, not one

- **`returns/*`** — customer/guest-facing, same `ActorResolverGuard`
  `cart-checkout` established (reused directly, imported from
  `CartCheckoutModule`, never reimplemented). Ownership is per-resource:
  `ReturnService`'s own ownership check compares the return's
  `customerId`/`guestToken` against the caller's resolved actor, the
  same shape `OrderService.assertOwnership()` uses.
- **`admin/returns/*`** / **`admin/credit-notes/*`** — RBAC, behind the
  service's global `JwtAuthGuard` + `AuthorizationGuard`, gated per-route
  by `@RequirePermission`.

## RBAC model

9 new permissions, matching exactly what every controller checks
(`docs/api/returns.md` has the full route-to-permission mapping):

| Permission          | Meaning                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `return.read`       | Read/search any return (admin/support scope)                                                                        |
| `return.approve`    | Approve a requested return                                                                                          |
| `return.reject`     | Reject a return                                                                                                     |
| `return.receive`    | Record a return as physically received at a warehouse/location                                                      |
| `return.inspect`    | Record inspected condition + computed refund amount per item                                                        |
| `return.refund`     | Approve a return for refund (gates the restock step) and trigger the actual settlement — one permission, two routes |
| `credit_note.read`  | Read any credit note                                                                                                |
| `credit_note.issue` | Manually issue a still-`DRAFT` credit note (crash-recovery path)                                                    |
| `credit_note.void`  | Void a `DRAFT`/`ISSUED` credit note                                                                                 |

`return.cancel`/`credit_note.create`/`inventory.restock.return` are
**deliberately not created** — no route consumes them (customer
cancellation is ownership-gated, not RBAC; a credit note is only ever
created as a side effect of `return.refund`; restock has no standalone
route) — following the same "do not register a permission without a
real route consumer" rule every prior phase's RBAC section already
applies.

Two new roles, real least-privilege boundaries, not labels:

- **`returns_manager`** — every `return.*`/`credit_note.*` permission,
  the department-head shape `order_manager` established.
- **`returns_clerk`** — `return.read`, `return.receive`, `return.inspect`
  only, the warehouse-floor shape `fulfillment_clerk` established: can
  handle the physical intake and inspection, cannot approve, reject,
  trigger a refund, or touch a credit note.

`finance_auditor` gains `credit_note.read` alongside its existing
`refund.read`/`reconciliation.read` — the same read-only
financial-visibility role, naturally extended. `admin` continues to
receive every `return.*`/`credit_note.*` permission alongside its
existing grants — no separate carve-out.

## IDOR protection on the customer/guest-facing routes

`ReturnService`'s ownership check runs on every read/mutation under
`returns/*`:

- An authenticated customer may only read/cancel/ship a return whose
  `customerId` matches their own.
- A guest may only read/cancel/ship a return whose `guestToken` matches
  the one `ActorResolverGuard` resolved from `X-Cart-Token`.
- A mismatch is a plain `403`, thrown directly — not routed through
  `ReturnDomainExceptionFilter` (see `docs/api/returns.md`'s "Errors"
  section).

Proven, not just declared: `test/return.e2e-spec.ts` asserts a
mismatched customer gets `403` on both `GET /returns/:id` and
`POST /returns/:id/cancel`, and the real owner succeeds on the same
routes.

## A return can only ever be created against real, delivered, still-eligible order lines

`ReturnEligibilityValidator` (pure domain, zero I/O) is the single gate
`ReturnService.create()` runs before ever inserting a row: order
status must be `FULFILLED`/`COMPLETED`, order payment status must be
`PAID`/`PARTIALLY_REFUNDED`, every named `OrderItem` must actually
belong to the order and have a real `Fulfillment.deliveredAt`, and that
delivery date must be within the configurable return window. There is
no client-supplied field anywhere in this module's DTOs that names a
delivery date, an eligibility flag, or a refund amount — every one of
those is server-derived from `Order`/`Fulfillment`/`OrderItem` data the
client never controls. Proven: `test/return.e2e-spec.ts` asserts a
return request against a non-delivered `OrderItem` gets a real `409`
(`ReturnNotEligibleError`), never a silent accept.

## The return-quantity invariant cannot be forged by racing requests

`PrismaReturnRepository.create()` row-locks the target `OrderItem`
(`SELECT ... FOR UPDATE`) and re-sums already-returned quantity across
every non-`REJECTED`/non-`CANCELLED` return inside the same transaction
as the new `ReturnItem` insert — a real database-level guarantee, not an
application-layer check a genuine race could slip past. Proven, not
assumed: `test/return-repository.e2e-spec.ts`'s concurrency section
fires 4 concurrent 3-unit return requests against a line with capacity
for only 3 batches of 3 (a 10-unit line), and asserts exactly 3 succeed
(summing to 9) and the 4th is always rejected, deterministically,
regardless of which specific call wins the race. Over real HTTP:
`test/return.e2e-spec.ts` asserts a second return request against an
already-fully-returned line gets a real `409` (`OverReturnedError`).

## Refund/credit-note amounts can never be inflated by a client, and never move against the live catalog

`RefundAmountCalculator` computes every refundable amount from
`OrderItem`'s own immutable snapshot (`lineTotal - discountAmount +
taxAmount`) — no route in this module accepts a refund amount, a
discount, or a tax figure from the client. `CreditNoteValidator`
(`assertLinesSumToSubtotal`/`assertGrandTotalConsistent`/
`assertWithinRefundableAmount`) re-verifies every server-computed
credit-note total before the row is ever created — its three error
types are mapped to `500`, not `400`, precisely because they can only
ever fire on an internal-consistency bug, never a malformed client
request (see `docs/api/returns.md`'s "Errors" section).

## Inventory restock cannot double-fire under racing requests, and never fires on a rejected or merely-requested return

`ReturnService.approveForRefund()` transitions the return
(`INSPECTING -> APPROVED_FOR_REFUND`) first, and only calls
`AdjustmentService.receiveReturnedStock()` when that transition reports
`transitioned: true` — the same "skip side-effects on a losing racer"
rule `FulfillmentService` already established in Phase 011. Proven, not
assumed: `test/return-repository.e2e-spec.ts` fires 20 concurrent
identical approve-for-refund calls against one return and asserts
exactly one real transition — the exact gate the restock call relies
on. Over real HTTP: `test/return.e2e-spec.ts` asserts a `DAMAGED`-
condition return that gets `REJECTED` leaves warehouse stock completely
unchanged (verified by a direct stock-level read before and after, not
merely an HTTP status code) — restock is never reachable from
`REQUESTED`, `RECEIVED`, or `REJECTED`, only from a real
`INSPECTING -> APPROVED_FOR_REFUND` transition.

## Return/credit-note status transitions cannot be corrupted by racing requests

`PrismaReturnRepository.updateStatus()`/`PrismaCreditNoteRepository
.updateStatus()` row-lock the target row (`SELECT ... FOR UPDATE`) and
re-check `ReturnStateMachine`/`CreditNoteStateMachine` against the
_locked_ row before writing — the exact technique Phases 009/011 already
proved for `Order`/`Fulfillment`/`Shipment`, applied here from the
start rather than retrofitted after a bug was found. Proven:
`test/return-repository.e2e-spec.ts` fires 20 concurrent identical
`approve()` calls and, separately, 20 concurrent `DRAFT -> ISSUED`
credit-note calls, asserting exactly one real transition each; a third
test asserts a transition no longer legal once the lock is held throws
a real `409`, not a silent no-op.

## There remains exactly one refund pathway

`RefundService.requestRefund()`/`processRefund()` (Phase 008, unchanged)
is still the only place a `Refund` row is ever created or submitted to
a payment provider. `ReturnService.refund()` calls `requestRefund()`
with a deterministic idempotency key
(`return-refund__${returnRequestId}`) — the same pattern
`OrderService.cancel()`/`.requestPartialRefund()` already established —
and never calls a payment provider adapter directly, never bypasses
`RefundValidator`. Proven: `test/return-repository.e2e-spec.ts` fires 10
concurrent `Refund.create()` calls sharing that deterministic key and
asserts exactly one real `Refund` row is ever created.

## Audit logging

Every privileged mutation in this module writes a `system.AuditLog`
entry (reusing `AUDIT_LOG_REPOSITORY`, the same convention
`catalog`/`inventory`/`order` already use): `RETURN_REQUESTED`,
`RETURN_APPROVED`, `RETURN_REJECTED`, `RETURN_CANCELLED`,
`RETURN_CUSTOMER_SHIPPED`, `RETURN_RECEIVED`, `RETURN_INSPECTED`,
`RETURN_APPROVED_FOR_REFUND`, `RETURN_REFUNDED`, `CREDIT_NOTE_DRAFTED`,
`CREDIT_NOTE_ISSUED`, `CREDIT_NOTE_VOIDED` — 12 distinct actions. Every
one of these only fires on a real transition (`transitioned: true`),
the same duplicate-audit-row avoidance Phase 011's own new
`Fulfillment`/`Shipment` status-update methods established, applied
here from the start.

## Idempotency and replay

See `docs/api/returns.md`'s "Idempotency" table for the full
per-operation mechanism. The security-relevant property: every one of
those keys/locks (`ReturnRequest.idempotencyKey`, the return-quantity
row lock, the return/credit-note status row locks,
`Refund.idempotencyKey`) is a real unique database constraint or row
lock, not an application-level cache a restart or a race could bypass —
and every one of them is proven race-safe under real concurrent
duplicate submissions by this module's own mandatory concurrency suite,
not only sequential retries.

## What's proven, not just declared

- **The two RBAC roles are a real fixture, not a paper matrix.**
  `test/return.e2e-spec.ts` logs in as `returns_clerk`
  (`+989120000016`) via the real OTP flow and asserts it gets `403` on
  `approve`/`reject`/`approve-refund` but a real `201` on
  `receive`/`inspect`; a plain customer token gets `403` on
  `GET /admin/returns/:id`.
- **IDOR is rejected** on `returns/*` for both `GET` and
  `POST .../cancel`, for a mismatched customer; the real owner succeeds
  on the same routes.
- **The return-quantity invariant and the restock gate are proven
  closed**, not assumed — see the two sections above for the exact
  repository-level concurrency tests, plus their real-HTTP counterparts.
- **A rejected return never restocks** — proven via a direct stock-level
  read, not merely an HTTP status code.
- **Refund and credit-note double-creation are proven closed** under
  real concurrent duplicate calls, not only sequential retries.

## Deliberately not built this phase

- **No inventory restock on cancellation.** Unchanged from ADR-011
  decision 8 — this module's restock-on-return capability is a
  structurally different, better-defined problem and does not
  retroactively close that gap.
- **No rate limiting specific to return mutation** — same blanket nginx
  `limit_req_zone` as everything else in this service (see
  `docs/security/README.md`'s "Not yet" list).
- **No return-shipment/tracking-number sub-model** — `CUSTOMER_SHIPPING`
  is a plain status; no courier webhook ingestion this phase, the same
  gap `order-security.md`'s own "Deliberately not built" section
  documents for forward shipments.
- **A crash between the `APPROVED_FOR_REFUND` transition and the restock
  call completing** is a documented, known limitation, not silently
  swallowed — see `docs/architecture/returns.md`'s "Known, deliberate
  gaps" section.
