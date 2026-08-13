# Payment orchestration architecture (Phase 008)

Full design rationale: [`docs/adr/ADR-008-payment-orchestration.md`](../adr/ADR-008-payment-orchestration.md).
Full layering/scope detail: [`services/api/src/modules/payment/README.md`](../../services/api/src/modules/payment/README.md).
This document is the short "where does payment fit in the system" view —
read it alongside [`docs/architecture/README.md`](README.md), which it
extends rather than replaces.

## Where it sits

```
storefront / admin / pwa / mobile
                │
        services/api (NestJS)
                │
        modules/payment           ← Phase 008, this document
   (domain → application → infrastructure/presentation)
        │                    │
   modules/cart-checkout     real ZarinPal adapter
   (real service injection:  (infrastructure/providers/zarinpal.adapter.ts)
    CheckoutService only —          │
    markConverted() on          ZarinPal's real REST API
    verified payment)          (request.json / verify.json /
        │                       reverse.json / StartPay redirect)
   BullMQ queues (in-process — payment_verification_retry,
        │          reconciliation, refund_status_sync)
   packages/database (Prisma)      Redis (queues only — never
        │                           authoritative for payment state)
   PostgreSQL
   commerce schema (payment_*/refunds/reconciliation_records tables)
```

Same shape every other domain module in `services/api` follows — the
fifth full clean-architecture example after `modules/identity` (Phase
004), `modules/catalog` (Phase 005), `modules/inventory` (Phase 006), and
`modules/cart-checkout` (Phase 007). It follows cart-checkout's own
"composed from another module's real service" shape (ADR-007 decisions
4-5's precedent): this module imports `CartCheckoutModule` for its
exported `CheckoutService`, never re-deriving checkout state itself.

## PostgreSQL is the single source of truth; the real network call is the one genuine external boundary

Redis is used **only** for the three BullMQ sweep queues, never to answer
"is this payment verified" — every such read goes to Postgres. Unlike
every prior phase, this module has one real external dependency this
codebase does not control: ZarinPal's own API. `PaymentProviderAdapter`
is the single boundary that crosses it — no application-layer code
anywhere else in this module makes an HTTP call.

## What changed outside `modules/payment` itself

- **`packages/database/prisma/schema.prisma`** — the Phase 003 placeholder
  `Payment`/`Refund`/`PaymentStatus`/`RefundStatus` (keyed on the
  nonexistent `Order`) dropped and replaced with the real subtree: 5 new
  enums, 7 new tables (`PaymentProvider`, `PaymentIntent`,
  `PaymentAttempt`, `PaymentTransaction`, `PaymentCallback`, `Refund`,
  `ReconciliationRecord`) — see `docs/database/payment-erd.md`.
- **`packages/types`** — 7 new branded IDs, 5 new enum unions, and the
  `PaymentProviderAdapter` interface's shared return-shape contracts
  (`PaymentProviderIntentResult`/`StartResult`/`VerifyResult`/
  `RefundResult`, `ParsedPaymentCallback`, `PaymentProviderHealthResult`).
- **`services/api/app.module.ts`** — registers `PaymentModule`.
- **`services/api/src/modules/cart-checkout/application/checkout.service.ts`**
  — additive `markConverted(checkoutId)` method (ADR-008 decision 10),
  reserved by ADR-007 for exactly this phase.
- **`services/api/src/modules/cart-checkout/cart-checkout.module.ts`** —
  additive `exports: [CheckoutService, ActorResolverGuard, ...]`; the
  guard's own dependency chain (`CUSTOMER_LOOKUP_PORT`, a re-exported
  `IdentityModule`) also had to be exported — found by actually booting
  the app with `PaymentModule` wired in, not assumed sufficient from a
  passing `tsc`/`nest build` alone (NestJS re-instantiates a
  `@UseGuards(SomeClass)` guard per consuming module; exporting the class
  token alone isn't enough).
- **`services/api/src/config/env.ts`** — `PAYMENT_ZARINPAL_MERCHANT_ID`,
  `PAYMENT_ZARINPAL_CALLBACK_BASE_URL` (real, valid sandbox defaults so
  `.env.example` boots without an extra step).
- **RBAC data** — 5 new `payment.*` permissions, two new roles
  (`payment_manager`, `finance_auditor`) — see
  `docs/security/payment-security.md`.

Nothing in `modules/cart-checkout`'s own domain/pricing/reservation logic
changed beyond the additive `markConverted()`/`exports` changes above —
both behavior-preserving, verified by re-running Phase 007's own e2e
suite unchanged (99/99 across the full suite, including this phase's
own 19 tests).

## Frontend: deliberately not built this phase

Same precedent every prior backend phase set. `GET /payments/callback/
:providerCode` answers ZarinPal's redirect with JSON describing the
outcome rather than a browser redirect to an order-confirmation page —
there is no storefront page to redirect to yet.

## This sandboxed environment cannot reach ZarinPal — documented, not hidden

Outbound HTTPS from this development container goes through a proxy
whose policy does not allow `sandbox.zarinpal.com` (confirmed via `curl`:
the gateway answers the CONNECT with a 403, "policy denial or upstream
failure"). `ZarinpalAdapter` is written against ZarinPal's real,
documented v4 REST contract and its request/response shapes were
verified against that real (blocked) boundary during development — the
`healthCheck()` method itself was tightened as a direct result of this
finding (see "Concurrency, proven not assumed" precedent below — this is
the same "verify by running, not by assuming" discipline applied to a
network boundary instead of a database race). `test/payment.e2e-spec.ts`
substitutes a `FakePaymentProviderAdapter` satisfying the exact same
interface for its own e2e run, documented in that file's own doc comment.
A live-sandbox integration check is a real gap this phase leaves for a
staging environment with real outbound network access.

## Concurrency, proven not assumed

The mandatory concurrency suite
(`services/api/test/payment.e2e-spec.ts`'s "concurrency" section) proved
three real races, not just declared them safe on paper: concurrent
intent creation for the same checkout collapses to exactly one
`PaymentIntent` (`P2002` on `checkoutSessionId`, caught and re-read); a
redelivered callback dedupes to exactly one `PaymentCallback` and one
`PaymentTransaction` (`P2002` on `dedupeKey` and
`(providerId, providerReference)` respectively); concurrent verification
calls for the same attempt collapse into one `PaymentTransaction` row the
same way. All three genuinely raced during the actual test run (visible
in the captured Prisma error log — real unique-constraint collisions,
not fabricated).
