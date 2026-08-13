# Cart, Checkout & Pricing Resolution — Phase 007 scope

Full architectural rationale: [`docs/adr/ADR-007-cart-checkout.md`](../adr/ADR-007-cart-checkout.md).
Full endpoint/permission reference: [`docs/api/cart-checkout.md`](../api/cart-checkout.md) /
[`docs/security/cart-checkout-security.md`](../security/cart-checkout-security.md).
Business/product framing this phase implements: `docs/product/blueprint.md`
§16-§19. This document says what's real **today** versus still aspirational
— same convention as `docs/product/catalog.md` / `docs/product/inventory.md`.

## What this phase is

A real shopping cart and checkout engine sitting on top of Phase 005's
catalog and Phase 006's inventory: server-side price resolution (base
price → discount → tax → shipping → grand total, every step recomputed on
the server, never trusted from a client), guest and authenticated cart
support with a controlled merge flow, an idempotent checkout session that
validates product/inventory/price state, reserves real stock through Phase
006's reservation engine, and reaches a payment-ready result — without
implementing a payment provider (Phase 008) or the final `Order` lifecycle
(a later phase). Every total the customer is ever quoted is a real,
reproducible database row, not a transient calculation.

## Domain model at a glance

```
Cart (ACTIVE|CHECKOUT_STARTED|ABANDONED|CONVERTED|EXPIRED)
  │  guestToken (opaque, guest) or customerId (-> customer.customers.id)
  ├──< CartItem (productSkuId, quantity, unitPriceSnapshot, configurationSnapshot)
  │      └──< CartItemOption (LENS_TYPE|LENS_COATING|PRESCRIPTION_REFERENCE|CUSTOMIZATION_REFERENCE)
  ├──< CartPriceSnapshot (append-only, recomputed on every price() call)
  ├──< CartCoupon (-> marketing.coupons.id, resolved discount snapshot)
  └──< CartShippingSelection (chosen ShippingMethod, estimated cost)

CheckoutSession (OPEN|VALIDATING|READY_FOR_PAYMENT|EXPIRED|CANCELLED|CONVERTED)
  │  started from exactly one Cart, idempotencyKey unique
  ├──< CheckoutAddress (snapshotted recipient/province/city/address at checkout time)
  ├──< CheckoutTotals (append-only, one row per recalculation, full breakdown)
  ├──< CheckoutValidationResult (append-only, one row per validate() call)
  └──< CheckoutReservation (-> inventory.inventory_reservations.id, one per line)

ShippingMethod (HOME_DELIVERY|STORE_PICKUP, database-driven, never hardcoded)
```

## What's real (Phase 007)

- **Cart**: create/read/add-item/update-quantity/remove-item/delete,
  guest (opaque token) and authenticated (customer-bound), quantity
  consolidation for duplicate SKU+configuration lines, expiration, product/
  SKU-active validation on every add.
- **Guest → customer merge**: `POST /cart/merge` folds a guest cart's lines
  into the authenticated customer's cart on login, consolidating
  duplicates, never silently dropping either side's items.
- **Pricing resolution**: base price (Phase 005's `finance.product_prices`)
  → coupon discount (real `marketing.coupons` rules, snapshotted) → tax
  (the SKU's own `taxRateBasisPoints`, or a configurable system default) →
  shipping (a real, database-driven `ShippingMethod`) → subtotal → grand
  total, entirely server-side, with a full per-line breakdown returned to
  the caller and persisted (`CartPriceSnapshot`/`CheckoutTotals`).
- **Checkout session**: `OPEN → VALIDATING → READY_FOR_PAYMENT`, with
  `EXPIRED`/`CANCELLED` as terminal off-ramps and `CONVERTED` once a future
  payment/order phase claims it. Idempotent creation
  (`idempotencyKey`), idempotent reservation (deterministic key per line).
- **Inventory integration**: real calls into Phase 006's `AllocationService`
  (pick a warehouse) and `ReservationService` (reserve/release, the same
  concurrency-safe, never-oversell engine — no reimplementation). A checkout
  cancellation or expiration releases every reservation it holds.
- **Checkout expiration**: a BullMQ-scheduled sweep (same shape as Phase
  006's reservation expiration) moves an unconverted, past-`expiresAt`
  checkout to `EXPIRED` and releases its reservations.
- **Address**: snapshotted at checkout time from either a real
  `customer.customer_addresses` row or freeform guest input — never
  re-read live from the source address later.

## What's explicitly not real yet

- **Payment.** `READY_FOR_PAYMENT` is the furthest this phase goes — no
  provider call, no payment intent, nothing charges a card or opens a
  gateway redirect. That is Phase 008 in full.
- **Order.** No `commerce.orders` row is created by this phase. A
  `CheckoutSession` reaching `READY_FOR_PAYMENT` is the artifact a later
  order-creation phase converts, not an order itself.
- **Prescription validation.** No `Prescription` entity exists anywhere in
  this schema yet. `CartItemOption` accepts and stores a prescription
  reference id (never the underlying SPH/CYL/AXIS values), but "validate
  existence and ownership" is a real, unit-tested function shape that
  honestly returns `unverified` today — see ADR-007 decision 9. This is
  not fabricated compliance; it is a documented gap.
- **Full promotion engine / loyalty redemption.** One coupon per cart,
  validated against its own real rules — no stacking, no automatic
  loyalty-point application.
- **Multi-zone / carrier-integrated shipping.** One flat, database-driven
  `ShippingMethod` list with an optional province/city match — no live
  carrier rate lookups, no multi-leg zone graphs.
- **Formal Iranian tax-law compliance.** Tax is a configurable
  basis-points rate per SKU (or a configurable default) — real and
  server-side, but not a jurisdiction-aware tax engine. See ADR-007
  decision 6.
