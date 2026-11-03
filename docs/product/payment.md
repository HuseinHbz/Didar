# Payment Orchestration — Phase 008 scope

Full architectural rationale: [`docs/adr/ADR-008-payment-orchestration.md`](../adr/ADR-008-payment-orchestration.md).
Full endpoint/permission reference: [`docs/api/payment.md`](../api/payment.md) /
[`docs/security/payment-security.md`](../security/payment-security.md).
Business/product framing this phase implements: `docs/product/blueprint.md`
§67, §75. This document says what's real **today** versus still
aspirational — same convention as `docs/product/cart-checkout.md`.

## What this phase is

A provider-independent payment orchestration layer sitting on top of Phase
007's checkout engine: create a payment intent for a `READY_FOR_PAYMENT`
checkout session, start payment against a real Iranian gateway (ZarinPal),
verify the result server-side (never trusting a redirect's own claim),
record an immutable transaction once verified, mark the checkout session
`CONVERTED`, support full/partial refunds, and reconcile local records
against the provider's own settlement report — without creating an `Order`
row (a later phase) or building a second gateway adapter.

## Domain model at a glance

```
PaymentProvider (code UK e.g. "zarinpal", isActive, isSandbox, config)
  │
PaymentIntent (CREATED|AWAITING_PAYMENT|PROCESSING|SUCCEEDED|FAILED|EXPIRED|CANCELLED)
  │  checkoutSessionId UK (-> commerce.checkout_sessions.id, unenforced)
  │  amount/currency fixed from CheckoutSession.grandTotal at creation
  ├──< PaymentAttempt (INITIATED|REDIRECTED|RETURNED|ABANDONED|EXPIRED)
  │      one per redirect round trip — a retried checkout is a new attempt
  ├──< PaymentTransaction (PENDING|VERIFIED|FAILED)
  │      created only from a server-side verifyPayment() call, immutable
  │      once VERIFIED
  │      └──< Refund (PENDING|PROCESSING|COMPLETED|FAILED|REJECTED)
  └──< PaymentCallback (append-only raw inbox, signatureValid, dedupeKey)

ReconciliationRecord (MATCHED|AMOUNT_MISMATCH|STATUS_MISMATCH|MISSING_LOCAL|MISSING_REMOTE)
  compares PaymentTransaction rows against the provider's own report —
  records a finding, never silently rewrites a transaction
```

## What's real (Phase 008)

- **Payment intent creation**: one per `READY_FOR_PAYMENT` checkout
  session, amount/currency fixed at creation from the session's own
  `grandTotal` (never re-read live, never accepted from the client),
  idempotent (`checkoutSessionId` unique, race-safe under real concurrent
  duplicate submission — the same `P2002`-catch-and-reread pattern Phase
  007's own concurrency suite found and fixed).
- **A real Iranian gateway adapter (ZarinPal)**: `createPaymentIntent`,
  `startPayment` (redirect URL), `verifyPayment` (server-to-server,
  amount+reference checked exactly), `queryPayment`, `refundPayment`,
  `parseCallback`, `healthCheck` — implemented against ZarinPal's actual
  documented REST contract, not a mock.
- **Provider-independent architecture**: `PaymentProviderAdapter` is a
  real interface; adding a second gateway is implementing it again and
  registering a second `PaymentProvider` row — zero application-layer
  branching on "which gateway."
- **Verification discipline**: a redirect return never itself proves
  payment succeeded — only a real `verifyPayment()` call, matching amount
  and provider reference exactly, creates a `VERIFIED` `PaymentTransaction`.
  Duplicate callbacks are idempotent (`dedupeKey` unique); a verified
  transaction is never updated again.
- **Checkout conversion**: a successfully verified transaction calls back
  into Phase 007's real `CheckoutService` to mark the source
  `CheckoutSession` `CONVERTED` — never a raw write against
  `commerce.checkout_sessions`.
- **Refunds**: full and partial, against an immutable `VERIFIED`
  transaction, validated to never exceed the transaction's own amount
  across all prior non-rejected refunds, idempotent
  (`Refund.idempotencyKey`).
- **Reconciliation**: `ReconciliationRecord` rows compare local
  `PaymentTransaction`s against the provider's own settlement report —
  a mismatch is recorded for human resolution, never silently corrected.
- **Async work via BullMQ**: `payment_verification_retry` (a
  `PENDING` transaction whose first verify attempt didn't resolve),
  `reconciliation` (a scheduled sweep), `refund_status_sync` (polling a
  `PROCESSING` refund's real status from the provider).

## What's explicitly not real yet

- **`Order` creation.** This module's furthest reach is
  `CheckoutSession.status = CONVERTED` plus a `VERIFIED`
  `PaymentTransaction` — no `commerce.orders` row is created here. Phase
  009's job.
- **A second real gateway adapter.** The interface is proven correct
  against exactly one real implementation this phase; architecture-ready
  for more, not built.
- **Automatic multi-provider failover/routing.** One active provider is
  selected (config-driven, not hardcoded) — no "try gateway A, fall back
  to gateway B" logic.
- **Wallet/store-credit as a payment method.** `customer.WalletAccount`
  exists (Phase 003) but this module doesn't integrate with it — every
  payment this phase handles goes through a real gateway.
- **Chargeback/dispute handling** beyond what reconciliation's own
  `MISSING_REMOTE`/`STATUS_MISMATCH` findings surface.
- **Refund-triggered inventory restock or Order-status transition** — both
  are `Order`-lifecycle concerns.
- **KMS-backed rotation for provider credentials.** Environment variables
  only, same gap `docs/security/README.md` already tracks service-wide.

## What CP-031 changed for the business (refund sending hardened)

Rationale: [`docs/adr/ADR-031-payment-order-consistency.md`](../adr/ADR-031-payment-order-consistency.md).
Finance should read this section before go-live.

- **A customer who is still on the gateway page when the 20-minute checkout hold would have run out
  keeps both the checkout and the stock** — the checkout is now held until the payment window closes
  plus five minutes. (Before this, that customer's payment succeeded and no order existed.)
- **Every partial refund must be settled by hand while ZarinPal is the only gateway.** ZarinPal's
  `reverse.json` takes no amount, so the system now refuses to send a partial refund (it used to send
  it as a reversal of the _whole_ transaction). The refund request is still recorded, ends
  `REJECTED` with a reason, and appears in finance's queue —
  `GET /admin/payments/refunds?status=REJECTED`. Only a refund of the whole transaction (for
  example an order cancelled before anything shipped) is sent automatically. Procedure:
  [`docs/operations/refund-manual-settlement-runbook.md`](../operations/refund-manual-settlement-runbook.md).
- **A refund is sent to the gateway at most once.** Two people (or a person and the background sweep)
  can no longer both send the same refund, and a refund whose send may have been lost
  (`?status=PROCESSING`) is never re-sent automatically — finance checks it at the gateway first.
  `POST /admin/payments/refunds/:id/process` on such a refund now answers `409` (release-note item).

**Not built yet (owned by CP-040, `BLOCKED` on the Q9 owner decision):** the system does not record
that finance settled a `REJECTED` refund by hand — no payout reference, no second approver — so the
order's `refundedTotal` reflects the _request_, not the payout (P1-16); a payment that completes
after the payment intent itself expired is never verified (P1-20); and a refund stuck in
`PROCESSING` has no automatic recovery (P1-19). Whether ZarinPal offers an amount-bearing refund
call this adapter can use is unverified from this sandbox (P1-6).
