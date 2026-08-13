# ADR-008 — Payment Orchestration & Iranian Gateway Integration

**Status**: Accepted
**Phase**: 007 → **008** (`services/api/src/modules/payment`)

## Context

Phase 007 gave this repo a real checkout engine reaching `CheckoutSession`
`READY_FOR_PAYMENT` — a fixed, reproducible `grandTotal`, a frozen address/
shipping snapshot, and every cart line reserved. Nothing pays for it yet.
Phase 008 builds a provider-independent payment orchestration layer on top
of that seam: create a payment intent, start payment against a real
Iranian gateway, verify the result server-side (never trusting a redirect
alone), record an immutable transaction once verified, support refunds,
and reconcile against the provider's own record — explicitly stopping
short of `Order` creation (Phase 009) and multi-provider routing/failover
logic beyond the adapter interface itself.

## Decision 1 — `PaymentIntent` keys off `CheckoutSession`, not `Order`

`commerce.Order` still requires a non-nullable `customerId` and is created
by nothing in this codebase — Phase 009's job, explicitly out of scope
here. The existing Phase 003 placeholder `Payment` model (`orderId`
required) is unusable as-is: there is no `Order` row to point at when a
customer is ready to pay. `commerce.PaymentIntent.checkoutSessionId`
(`@unique` — one intent per checkout session) is the real anchor instead,
pointing at the artifact that actually exists and actually carries a
fixed, reproducible amount (`CheckoutSession.grandTotal`/`currency`,
frozen in `pricingSnapshot` once `READY_FOR_PAYMENT`). Kept in the same
`commerce` schema `Order`/`Cart`/`CheckoutSession` already live in (not
`finance`, which holds `ProductPrice`/`Invoice` — a different concern:
order-value accounting, not payment execution). The placeholder
`Payment`/`Refund`/`PaymentStatus`/`RefundStatus` models are removed
entirely and replaced by the richer subtree this ADR describes — the same
"placeholder identified, replaced with the real thing" precedent every
prior phase (Cart/CartItem, InventoryItem, Product) already set.

## Decision 2 — `PaymentIntent` → `PaymentAttempt` → `PaymentTransaction`, three levels, not one

A payment is not a single atomic thing — a customer can be redirected to
the gateway, abandon the page, come back, get redirected again, and only
one of those attempts actually settles. Collapsing "intent to pay" and
"the redirect round trip" and "the verified, immutable settlement record"
into one row (the old placeholder `Payment`'s implicit assumption) cannot
represent a retried checkout honestly. Three levels instead:

- **`PaymentIntent`** — one per `CheckoutSession`, the durable "customer
  owes `grandTotal`" fact. Status: `CREATED → AWAITING_PAYMENT →
PROCESSING → {SUCCEEDED|FAILED|EXPIRED|CANCELLED}`.
- **`PaymentAttempt`** — one per redirect round trip
  (`createPaymentIntent`+`startPayment` call to the provider). Multiple
  attempts can exist per intent (retry after abandonment/failure).
  Status: `INITIATED → REDIRECTED → RETURNED → {ABANDONED|EXPIRED}`.
- **`PaymentTransaction`** — the verified, immutable settlement record.
  Created only after a server-side `verifyPayment()` call confirms the
  provider's own reference and amount match exactly. Status:
  `PENDING → {VERIFIED|FAILED}`. Once `VERIFIED`, no application code path
  updates the row again — "successful transactions immutable," the
  brief's own explicit rule.

## Decision 3 — Verification is never inferred from a redirect

The brief's critical rule, made structural: `startPayment()`'s redirect
return (`POST /payments/:id/callback`, the customer's browser bouncing
back with query params) only ever triggers a **server-to-server**
`verifyPayment()`/`queryPayment()` call to the provider — the redirect
itself proves nothing (a forged or replayed redirect is exactly as easy
to construct as a real one). `PaymentTransaction` is created from the
verify call's own response, matching `amount`+`providerReference` against
what `PaymentIntent` expects, never from the callback's own claimed
amount. A callback whose provider-verified amount doesn't match the
intent's amount is `FAILED`, not silently accepted.

## Decision 4 — `PaymentCallback` is a raw, append-only inbox — not the trigger for state changes by itself

Every inbound callback/webhook from a provider is persisted verbatim
(`rawPayload`, `signatureValid`, `receivedAt`) before any processing
happens — an audit trail that survives even a callback the rest of the
system rejects. `dedupeKey` (provider + their own reference + a content
hash) is a real unique constraint, so a provider's well-known habit of
firing the same callback multiple times (network retries, at-least-once
delivery) is idempotent by construction: the second identical callback
upserts the same row rather than re-triggering verification work.
Processing a callback always re-derives truth by calling `verifyPayment()`
(decision 3) — the callback payload is a _trigger_, never itself the
source of truth for whether payment succeeded.

## Decision 5 — The adapter interface is the actual provider-independence boundary

`PaymentProviderAdapter` (`createPaymentIntent`/`startPayment`/
`verifyPayment`/`queryPayment`/`refundPayment`/`parseCallback`/
`healthCheck`) is implemented once for real
(`infrastructure/providers/zarinpal.adapter.ts`) against ZarinPal's actual
documented REST contract (request → `Authority` → redirect → verify →
`RefID`) — not a second Iranian gateway, and not a mock standing in for a
real one. The architecture is ready for more: `PaymentProvider` is a real
database table (`code`, `isActive`, `isSandbox`), `PAYMENT_PROVIDER_ADAPTER`
resolution is keyed off that `code`, and adding a second adapter is
implementing the same interface again and registering a second
`PaymentProvider` row — no application-layer code branches on "which
gateway," only the adapter does.

## Decision 6 — Refunds: foundation only, never exceeding the captured amount

`Refund.paymentTransactionId` points at an immutable, `VERIFIED`
transaction; `DiscountCalculator`-style guard logic (this module's own
`RefundValidator`) rejects a refund whose amount, combined with every
prior non-`REJECTED`/`FAILED` refund against the same transaction, would
exceed the transaction's own `amount` — never a silent partial
acceptance. `status: PENDING → PROCESSING → {COMPLETED|FAILED|REJECTED}`,
each transition through the real provider adapter's `refundPayment()`
call, `providerRefundReference` recorded once the provider confirms it.
Full and partial refunds are both supported; a full promotion/loyalty-
aware refund-and-restock-and-notify workflow is explicitly out of scope
(that's an `Order`-lifecycle concern, Phase 009+).

## Decision 7 — Reconciliation never silently corrects local state

`ReconciliationRecord` compares this system's own `PaymentTransaction`
rows against what the provider's own settlement report says for the same
window, one row per comparison outcome: `MATCHED`, `AMOUNT_MISMATCH`,
`STATUS_MISMATCH`, `MISSING_LOCAL` (provider has it, we don't — a lost
verify call), `MISSING_REMOTE` (we have it, provider doesn't — a bug or a
provider-side reversal). A mismatch is **recorded, not auto-corrected** —
no code path in this module rewrites a `PaymentTransaction`'s `amount`/
`status` based on a reconciliation finding; resolution requires a human
(`resolvedAt`/`resolutionNote`, set through a real admin endpoint), the
same "the ledger records, it doesn't silently fix itself" discipline
`InventoryLedger` established.

## Decision 8 — Provider secrets never live in the database, plaintext or otherwise

`PaymentProvider.config` (Json) holds only non-secret operational
settings (callback URL template, request timeout, sandbox flag) — the
actual merchant id / API key each adapter needs comes from environment
variables, namespaced per provider code (`PAYMENT_ZARINPAL_MERCHANT_ID`),
read once at adapter construction, never persisted to Postgres or
returned by any endpoint. This is the same "secrets never committed"
discipline `docs/security/README.md` already states for the whole
service, applied to a genuinely sensitive new category of secret this
phase introduces.

## Decision 9 — Idempotency, per operation, no generic store

Same precedent ADR-007 decision 4 set: idempotency is achieved through
real unique keys and state-machine no-op checks, not a speculative
generic key-value store.

- **Intent creation**: `PaymentIntent.checkoutSessionId` unique — a
  retried "start payment for this checkout" always resolves to the same
  intent (mirroring `CheckoutSession.idempotencyKey`'s own race-safety
  fix from Phase 007 — the same `P2002`-catch-and-reread pattern is
  reused here directly, not reinvented).
- **Payment start**: `PaymentAttempt.paymentIntentId` + provider call is
  naturally re-triggerable (a new attempt row), but `verifyPayment()`
  itself is idempotent by delegating to the provider — calling it twice
  for the same `providerAuthority` yields the same verified result.
- **Callback**: `PaymentCallback.dedupeKey` unique.
- **Verification / transaction creation**: `PaymentTransaction.
providerReference` unique per provider — a duplicate verified callback
  for the same reference upserts, never duplicates.
- **Refund**: `Refund.idempotencyKey` unique, same shape as intent
  creation.

## Decision 10 — Checkout conversion is this module's responsibility, not cart-checkout's

ADR-007 explicitly reserved `CheckoutSession.status = CONVERTED` for "once
that checkout reaches `READY_FOR_PAYMENT` and payment orchestration takes
over (Phase 008)." `CartCheckoutModule` now additionally exports
`CheckoutService`; `PaymentModule` imports it and calls a new
`CheckoutService.markConverted(checkoutSessionId)` method (additive, the
same "small additive `exports` change" pattern decisions 4-5 of ADR-007
set for `InventoryModule`/`CatalogModule`) the moment a `PaymentTransaction`
verifies successfully — the one place this module reaches back into
cart-checkout, and only through its real service, never a raw Prisma
write against `commerce.checkout_sessions`.

## Decision 11 — Events are derived from committed state, never the trigger for it

`payment_intent_created`, `payment_started`, `payment_verified`,
`payment_failed`, `refund_requested`, `refund_completed`,
`reconciliation_mismatch_found` are published only after the
corresponding row is committed — the same "events observe state, they
don't drive it" discipline `docs/adr/ADR-006-inventory-architecture.md`
established for inventory events, reused unmodified here.

## Consequences

- A payment can be retried (new `PaymentAttempt`) without ever risking a
  duplicate charge — `PaymentIntent`'s single durable identity plus
  provider-side idempotency (ZarinPal's own `Authority`-per-request model)
  makes that structurally true, not just tested-for.
- Reconciliation has real, inspectable data to compare against from day
  one — every verified transaction is a real row before any reconciliation
  job ever runs.
- Adding a second Iranian gateway (or a card-network-direct provider
  later) is implementing `PaymentProviderAdapter` again — zero changes to
  `PaymentIntent`/`PaymentTransaction`/the application layer's use cases.

## Deferred (explicitly out of scope this phase)

- `Order` creation from a converted checkout (Phase 009) — this module's
  furthest reach is `CheckoutSession.status = CONVERTED` plus a verified
  `PaymentTransaction`; nothing here creates an `Order` row.
- A second real gateway adapter (architecture-ready, not built).
- Multi-provider automatic failover/routing logic.
- Wallet/store-credit as a payment method (that's `customer.WalletAccount`,
  untouched this phase).
- Chargeback/dispute handling beyond what reconciliation surfaces.
- A refund-triggered inventory restock or Order-status transition (both
  are `Order`-lifecycle concerns, Phase 009+).
- KMS-backed secret rotation for provider credentials — env vars only,
  same gap `docs/security/README.md` already tracks service-wide.
