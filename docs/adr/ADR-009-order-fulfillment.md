# ADR-009 — Enterprise Order Management, Invoice & Fulfillment

**Status**: Accepted
**Phase**: 008 → **009** (`services/api/src/modules/order`)

## Context

Phase 008 gave this repo a real payment orchestration layer that ends at a
verified `PaymentTransaction` and `CheckoutSession.status = CONVERTED` —
explicitly stopping short of creating an `Order` (that ADR's own words:
"Phase 009's job"). Nothing downstream of a successful payment exists yet:
no durable commercial record survives the checkout/payment tables' own
churn (a `CheckoutSession` is a working area, not a permanent receipt), no
invoice, no fulfillment tracking, no shipment visibility. Phase 009 builds
that: a real `Order` aggregate created deterministically and idempotently
the moment a payment verifies, an invoice with server-generated numbering,
partial-fulfillment-aware fulfillment tracking, and a shipment tracking
abstraction — explicitly stopping short of a live courier integration, a
promotion/loyalty settlement pass, and any post-delivery return/dispute
workflow beyond what reconciliation (Phase 008) already surfaces.

## Decision 1 — `Order` replaces the Phase 003 placeholder; anchored on `CheckoutSession` + `PaymentIntent`, not invented from nothing

`commerce.Order`/`OrderItem`/`OrderStatusHistory` already exist as Phase
003 placeholder tables — confirmed empty (0 rows) before this migration,
confirmed unreferenced by any application code (`grep` across
`services/api/src` and `packages/types/src` before writing a line here).
Same "placeholder identified, replaced with the real thing" precedent
every prior phase (Cart/CartItem, InventoryItem, Product, Payment/Refund)
already set — this ADR drops the placeholder shape and replaces it
entirely rather than layering on top of column names chosen before
`CheckoutSession`/`PaymentIntent` existed to anchor against.

`Order.checkoutSessionId` (`@unique`, real enforced FK — same `commerce`
schema as `CheckoutSession`) and `Order.paymentIntentId` (`@unique`, real
enforced FK — same schema as `PaymentIntent`) are both the anchor and the
idempotency guarantee (Decision 4). `Order.customerId`/`Order.guestToken`
mirror `PaymentIntent`'s own nullable-pair ownership shape exactly — an
order is either a real customer's or a guest's, same IDOR-protection
pattern `CheckoutService.assertOwnership()`/`PaymentIntentService
.assertOwnership()` already established, reused verbatim by
`OrderService.assertOwnership()`.

## Decision 2 — No separate `OrderAddress`/`OrderPayment` table; JSON snapshots + a pointer, matching precedent already in this schema

The brief's own suggested table list is a menu, not a mandate ("do not
blindly use these exact names if the existing repository already has
equivalent models"). Two of its suggestions are deliberately *not* built
as separate tables:

- **`OrderAddress`** — `CheckoutSession.addressSnapshot` (Phase 007) is
  already a frozen, authoritative JSON snapshot of the shipping address at
  the exact moment the customer committed to it. `Order` copies that same
  JSON verbatim into its own `shippingAddressSnapshot` column at creation
  (never re-reads `customer.customer_addresses` live) — the placeholder
  Phase 003 `Order` already made this exact choice
  (`shippingAddressSnapshot Json`); this ADR keeps it, not invents it.
  `billingAddressSnapshot` stays nullable — nothing in this codebase
  collects a separate billing address yet (Phase 007 never asked for one),
  so it is populated only if a future phase adds that input; leaving the
  column ready is cheaper than adding it under migration pressure later.
- **`OrderPayment`** — money movement is Payment's concern, not Order's
  (the brief's own explicit separation: "Order owns commercial state.
  Payment owns money movement."). `Order.paymentIntentId` is the pointer;
  `Order.paidTotal`/`Order.refundedTotal` are a maintained *cache*
  (updated by `OrderService` whenever it learns of a payment/refund
  outcome — never the source of truth) of what `PaymentTransaction`/
  `Refund` rows already say authoritatively. A second `order_payments`
  table duplicating `PaymentIntent`/`PaymentTransaction` would be exactly
  the "second payment system" instruction #5 explicitly forbids.

## Decision 3 — Three status fields, not one, on purpose

`Order` carries `status` (the 8-state lifecycle machine, Decision 5),
`paymentStatus` (`UNPAID | PARTIALLY_PAID | PAID | PARTIALLY_REFUNDED |
REFUNDED` — a small cached read of what Payment/Refund already know),
and `fulfillmentStatus` (`UNFULFILLED | PARTIALLY_FULFILLED | FULFILLED`
— a small cached read of what `Fulfillment` rows already know). This is a
deliberate, acknowledged overlap: `status` already encodes fulfillment
progress in its own vocabulary (`READY_TO_FULFILL`/`PARTIALLY_FULFILLED`/
`FULFILLED`/`COMPLETED`). The two extra fields exist because `status`
alone can't answer "is this PAID order actually fully paid, or has a
partial refund landed" or "give me every partially-fulfilled order"
without a string-parse or a join — same "cache columns alongside the
authoritative history" split `CheckoutSession`'s
`subtotal`/`grandTotal`/etc. columns already use next to the append-only
`CheckoutTotals` table, and `InventoryItem`'s quantity buckets use next to
`InventoryLedger`. Neither cache field is ever written by anything except
`OrderService`/`OrderFulfillmentService` themselves, immediately after the
authoritative source (a `PaymentTransaction`, a `Refund`, a
`FulfillmentItem`) changes — never inferred independently.

## Decision 4 — Payment → Order conversion is idempotent by a real unique constraint, triggered two ways

`OrderConversionService.convertFromCheckout(checkoutSessionId)` is the
single place an `Order` gets created. It:

1. Reads the checkout's `PaymentIntent` via a new, additive
   `PaymentIntentService.findByCheckoutSessionId()` method (Phase 009's
   own reserved hook into Payment, same shape ADR-008 decision 10 reserved
   `CheckoutService.markConverted()` for Payment to call — each phase adds
   an additive method to the *previous* phase's service for itself to
   consume, never the reverse).
2. Requires `PaymentIntent.status === 'SUCCEEDED'` and a `VERIFIED`
   `PaymentTransaction` on it — an intent that hasn't actually verified
   never produces an `Order`, full stop (instruction #15's "never allow an
   Order to become paid merely because a client says so" — there is no
   code path from an HTTP request body to `Order.status = PAID`; the only
   path is through a real `PaymentTransaction.status = VERIFIED` row this
   module didn't write).
3. Creates the `Order` with `checkoutSessionId`/`paymentIntentId` both
   `@unique` — `PrismaOrderRepository.create()` catches the resulting
   `P2002` and re-reads the winner's row, the exact same
   P2002-catch-and-reread pattern every prior phase's idempotency guarantee
   uses (`CheckoutSession.idempotencyKey`, `PaymentIntent.checkoutSessionId`,
   `PaymentTransaction`'s `(providerId, providerReference)` pair). This is
   what makes "the same successful PaymentIntent must never create two
   Orders" and "two concurrent checkout conversions resolve to one order"
   true under real concurrency, not just true on paper — proven in this
   phase's own mandatory concurrency suite.
4. Reconciles each `CheckoutReservation` by calling Phase 006's real
   `ReservationService.convert()` (never a second inventory-mutation path)
   — skipped defensively for any reservation already `CONVERTED`, so a
   retried/duplicate conversion attempt (crash between steps, a second
   concurrent caller losing the `Order` race) never double-consumes stock.
5. Issues an `Invoice` synchronously in the same call (Decision 7).

**Two triggers, one idempotent method**: the `payments/callback/*` flow
(a customer's browser bouncing back) and the `order_conversion` sweep
(Decision 9) both end up calling step 1-5 above for the same checkout —
never two different code paths that could drift. This is deliberately
*not* a change to `PaymentCallbackController` or any other Payment-module
file (Payment stays ignorant of Order's existence, same one-way
dependency direction every phase reaches back with, never forward) — the
sweep exists specifically because Payment cannot call forward into Order.

## Decision 5 — Order lifecycle: the brief's 8-state minimum, no invented richness

```
PENDING_PAYMENT ──▶ PAID ──▶ PROCESSING ──▶ READY_TO_FULFILL ──┬──▶ PARTIALLY_FULFILLED ──▶ FULFILLED ──▶ COMPLETED
      │                │            │                │         └──▶ FULFILLED ────────────────▶ COMPLETED
      ▼                ▼            ▼                ▼
  CANCELLED        CANCELLED    CANCELLED        CANCELLED
```

`CANCELLED` and `COMPLETED` are strictly terminal — no edge leaves either.
`CANCELLED` is reachable from `PENDING_PAYMENT`/`PAID`/`PROCESSING`/
`READY_TO_FULFILL` only, never from `PARTIALLY_FULFILLED`/`FULFILLED`
(the brief's own explicit examples: "a shipped order must not simply
become CANCELLED," "a delivered order must not be cancelled" —
conservatively extended to `PARTIALLY_FULFILLED` too, since physical
goods are already moving once even one `Fulfillment` exists; unwinding
that is an out-of-band admin/refund action this phase doesn't automate,
not a same-state-machine transition). The three explicit test cases the
brief names all fail correctly: `PENDING_PAYMENT → FULFILLED` (no such
edge), `CANCELLED → PAID` (terminal), `COMPLETED → PROCESSING`
(terminal). The Phase 003 placeholder's 17-value enum
(`PRESCRIPTION_REVIEW`/`LENS_PRODUCTION`/`QUALITY_CONTROL`/`RETURN_*`) is
dropped — no lens-manufacturing workflow or post-delivery return workflow
exists anywhere in this codebase to drive those states honestly; inventing
them here would be exactly the "do not invent capabilities the repository
does not support" instruction warns against. `OrderStateMachine`
(domain-layer, zero I/O, unit-tested) is the only place a transition is
decided legal — no controller or service mutates `status` directly.

## Decision 6 — Order numbering: a real Postgres sequence, never application memory

`commerce.order_number_seq` — a native `CREATE SEQUENCE`, `nextval()`
called inside the same transaction that inserts the `Order` row. Format:
`ORD-YYYYMMDD-NNNNNN` (the date the sequence value was drawn, then the
raw sequence value zero-padded to 6 digits). A Postgres sequence's
`nextval()` is atomic at the database level — two truly concurrent callers
can never receive the same value, which is what "concurrent order-number
generation must be unique" requires and an in-process counter (reset on
every restart, not shared across horizontally-scaled API instances)
cannot honestly guarantee. `Invoice.invoiceNumber` reuses the identical
technique with its own `finance.invoice_number_seq` (format
`INV-YYYYMMDD-NNNNNN`) — the same mechanism, not a second one invented.
Neither number is ever accepted from a request body; both are generated
server-side inside the repository's `create()` call.

## Decision 7 — Invoice: immutable once issued, generated automatically, corrected only by superseding

`Invoice` is created in the same `convertFromCheckout()` call as `Order`
(Decision 4 step 5) — the totals it needs (`subtotal`/`discountTotal`/
`taxTotal`/`shippingTotal`/`grandTotal`) are exactly the `Order`'s own
just-computed totals, themselves copied from the checkout's already-frozen
`pricingSnapshot` (never recomputed, never trusted from a client). Minimum
lifecycle `DRAFT → ISSUED → PAID → VOID`/`CANCELLED`: an
auto-generated invoice goes `DRAFT → ISSUED` in the same call (nothing in
this phase edits a draft before issuing it — no admin invoice-authoring
UI exists), then `ISSUED → PAID` immediately since the order it belongs to
is already paid by construction. `Invoice.orderId` is `@unique` — a
second `issueInvoice()` call for the same order (a retried queue job, a
race between the synchronous path and the `invoice_generation` sweep)
resolves to the existing row via the same P2002-catch-and-reread pattern.
No repository method exposes an update path for `subtotal`/`taxTotal`/
`grandTotal`/`lines` once `ISSUED` — a correction is a `VOID` on the
original plus manual admin follow-up (out of this phase's automated
scope; no "credit note"/re-issue mechanic is built).

## Decision 8 — Fulfillment: partial by design, over-fulfillment structurally impossible

`Fulfillment` (one row per pack/ship batch — an `Order` may have many) +
`FulfillmentItem` (references a concrete `OrderItem`, never a bare SKU
string, so a fulfillment always traces back to exactly what was actually
ordered). The invariant the brief states in words —
`fulfilled_quantity ≤ ordered_quantity − already_fulfilled_quantity` — is
enforced by re-deriving "already fulfilled" as
`SUM(FulfillmentItem.quantity)` across every *non-`CANCELLED`*
`Fulfillment` for that `OrderItem`, computed inside a
`SELECT ... FOR UPDATE`-locked transaction on the `OrderItem` row (the
exact row-lock technique `mutateInventoryItem` already established for
`InventoryItem`'s own quantity buckets — reused, not reinvented) before
the new `FulfillmentItem` is written. This is what makes "two concurrent
fulfillment requests must not over-fulfill" true under real concurrency:
the loser of the race sees the row-locked, freshly-summed total and its
domain-layer invariant check fails cleanly (a real rejection, not a
silent over-write). `Order.fulfillmentStatus` flips to
`PARTIALLY_FULFILLED`/`FULFILLED` (Decision 3) the moment a `Fulfillment`
is created/updated, derived from the same per-item sums, never
independently tracked.

## Decision 9 — Reused, not reinvented: Inventory, Payment, Refund, RBAC, Audit, Identity

Per instruction #5's explicit list, this phase adds **zero** new
implementations of:

- **Pricing** — every amount `Order`/`OrderItem`/`Invoice` ever stores
  is copied from `CheckoutSession.pricingSnapshot` / `CheckoutTotals
  .breakdown` (Phase 007's own `PricingResolver` output), never
  recomputed by this module.
- **Inventory reservation** — `ReservationService.convert()`/`.release()`
  (Phase 006) are the only inventory-state mutators this module calls;
  `OrderConversionService` never writes to `inventory.*` tables directly.
- **Payment verification** — `PaymentIntentService.verifyPayment()`
  (Phase 008) is the only place a payment is ever confirmed; this module
  only *reads* its result (`PaymentIntent.status`, the linked
  `PaymentTransaction`).
- **Customer lookup** — `CUSTOMER_LOOKUP_PORT` (re-bound the same way
  every module since Phase 007 re-binds it) resolves an authenticated
  actor's `customer.customers` row; never a second lookup mechanism.
- **Authentication/authorization** — the global `JwtAuthGuard`/
  `AuthorizationGuard` (Phase 004, `APP_GUARD`) gate every admin route via
  `@RequirePermission`; customer/guest-facing routes reuse
  `ActorResolverGuard` (Phase 007) directly, imported from
  `CartCheckoutModule`, exactly as `PaymentIntentController` already does.
- **Idempotency infrastructure** — every idempotency guarantee in this
  phase (order creation, invoice issuance, cancellation, refund request,
  shipment creation) is the same real-unique-constraint +
  P2002-catch-and-reread pattern used throughout Phases 007-008, applied
  to this phase's own tables — never a new mechanism.

`OrderModule` imports `PaymentModule` (for `PaymentIntentService`,
`RefundService` — both given additive `exports`) and `CartCheckoutModule`
(for `ActorResolverGuard`, `CUSTOMER_LOOKUP_PORT`, `IdentityModule`
re-export — same chain `PaymentModule` already established) and
`InventoryModule` (for `ReservationService`). `AUDIT_LOG_REPOSITORY` is
re-bound locally inside `OrderModule`, same convention every prior module
(`catalog`, `inventory`) already set, rather than importing
`IdentityModule`'s internals.

## Decision 10 — Cancellation never issues a refund itself; it asks Payment to

`OrderService.cancel()` never calls a provider adapter or writes a
`Refund.status` transition beyond `PENDING`. For a `PAID`/`PROCESSING`/
`READY_TO_FULFILL` order being cancelled, it calls the already-exported
`RefundService.requestRefund()` (Phase 008) with a deterministic
`idempotencyKey` (`order-cancel__<orderId>`) — this only *creates* a
`PENDING` `Refund` row (Phase 008's own `RefundValidator` guards the
amount); actually submitting it to the provider is
`RefundService.processRefund()`, left for the existing admin
`payment.refund.process`-gated flow or the existing `refund_status_sync`
sweep to drive forward, exactly the separation instruction #11 states
("Order owns commercial state. Payment owns money movement."). For a
still-`PENDING_PAYMENT` order (nothing was ever charged), cancellation
short-circuits before any refund call — there is nothing to refund.
Deliberately does **not** restock inventory: by the time an `Order` row
exists at all, `OrderConversionService.convertFromCheckout()` has already
called `ReservationService.convert()` on every reservation the checkout
held, so the stock is genuinely sold, not merely held — there is nothing
left to *release*. A refund-triggered restock (crediting the sold
quantity back onto the shelf) is a real, deliberate gap, the same one
`docs/product/payment.md`'s own Phase 008 scope already declares
("A refund-triggered inventory restock or `Order`-status transition"),
not a new omission this phase introduces. `Fulfillment`-level unwind, if
any exists yet, is a separate, explicit admin action outside this phase's
automated scope.

## Decision 11 — Guest ownership, IDOR, and admin/POS-created orders

`Order.customerId`/`Order.guestToken` mirror `PaymentIntent`'s exact
ownership shape; `OrderService.assertOwnership()` is the same
verify-one-or-the-other check `CheckoutService`/`PaymentIntentService`
already run — a mismatch is a plain `403`, never a `404` that would leak
existence. `Order.source` (`STOREFRONT | ADMIN | POS`) records how the
order came to exist without changing the ownership model: an `ADMIN`/
`POS`-created order (instruction #12's explicit case) still requires a
resolved `customerId` (an admin creating an order on a walk-in customer's
behalf still needs a real `customer.customers` row — no anonymous/no-owner
order exists in this phase) and is created through the same
`OrderConversionService` path once its own `CheckoutSession`/
`PaymentIntent` chain exists — this phase does **not** build a second,
parallel "admin-creates-an-order-directly-with-a-body" endpoint that
bypasses checkout/payment entirely; that would be exactly the
"never allow an Order to become paid merely because a client says so"
rule violated for admins instead of customers. A future POS phase that
needs an offline/cash-settled order path is an explicitly deferred gap
(see "Deferred").

## Decision 12 — Shipment: a real port, one honest manual adapter, no live courier

`ShippingProvider` (domain port) mirrors `PaymentProviderAdapter`'s own
shape: `createShipment()`/`getShipmentStatus()`/`cancelShipment()`. Only
one implementation exists — `ManualShippingProvider`, an
admin-driven, no-external-network adapter (an admin/support user enters a
carrier name and tracking number directly; `getShipmentStatus()` returns
whatever the last admin-recorded `ShipmentEvent` says, never polls
anything). Same "the interface is the real boundary, one real
implementation, ready for a second" precedent `PaymentProviderAdapter`
established for ZarinPal — except here the "real" adapter is honestly a
manual one, since no courier API integration exists anywhere in this
codebase to plug in for real (blueprint's own courier-integration ambition
is explicitly not part of any phase to date). Documented as a real gap,
not hidden behind a fake success response.

## Deferred (explicitly out of scope this phase)

- **A live courier API integration** — `ManualShippingProvider` only
  (Decision 12).
- **Post-delivery returns/RMA/dispute workflow** — `Refund` (Phase 008)
  and reconciliation cover money-side correction; a customer-initiated
  return request/approval flow is not built.
- **Per-`OrderItem` partial cancellation** — only whole-order cancellation
  (Decision 5/10) is implemented; cancelling one line of a multi-line
  order while keeping the rest is not.
- **A refund-triggered inventory restock** (Decision 10) — cancelling a
  paid order asks Payment for a refund but never credits the sold
  quantity back onto the shelf; the same gap
  `docs/product/payment.md`'s own Phase 008 scope already declares.
- **A credit-note/re-issue mechanic for a `VOID`ed invoice** — voiding
  records the fact; a corrected replacement invoice is a manual follow-up.
- **An admin "create order directly" endpoint bypassing checkout/payment**
  (Decision 11) — every order, including admin/POS-sourced ones, still
  flows through a real `CheckoutSession`/`PaymentIntent` chain.
- **Loyalty/wallet settlement on order completion** — `customer.wallet_*`/
  `loyalty_*` tables exist from Phase 001-003 scaffolding; nothing in this
  phase credits them on `COMPLETED`.
- **A frontend** — same precedent every backend phase has set; `apps/*`
  remain untouched.
