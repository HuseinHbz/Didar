# modules/payment

Phase 008's clean-architecture module for provider-independent payment
orchestration: intent creation, real Iranian gateway integration
(ZarinPal), server-side verification, refunds, and reconciliation. Same
layering convention every prior module established:

```
payment/
├── domain/
│   ├── entities/    — plain TS classes: PaymentProvider, PaymentIntent,
│   │                  PaymentAttempt, PaymentTransaction, PaymentCallback,
│   │                  Refund, ReconciliationRecord. No Prisma/NestJS
│   │                  dependency.
│   ├── ports/       — PaymentProviderRepositoryPort, PaymentIntentRepositoryPort
│   │                  (aggregate root over attempts/transactions/callbacks —
│   │                  same "child entities, no independent lifecycle"
│   │                  reasoning CheckoutSessionRepositoryPort uses),
│   │                  RefundRepositoryPort, ReconciliationRecordRepositoryPort,
│   │                  and PaymentProviderAdapter — the actual
│   │                  provider-independence boundary (ADR-008 decision 5) —
│   │                  plus PaymentProviderAdapterRegistry (code -> adapter).
│   └── services/    — pure business logic, zero I/O, unit-tested without a
│                      database (32 tests across 6 spec files):
│                        PaymentIntentStateMachine       — CREATED -> AWAITING_PAYMENT
│                                                          -> PROCESSING -> terminal,
│                                                          with a FAILED -> AWAITING_PAYMENT
│                                                          retry edge
│                        PaymentAttemptStateMachine      — one redirect round trip
│                        PaymentTransactionStateMachine  — PENDING -> {VERIFIED|FAILED},
│                                                          VERIFIED strictly terminal
│                        RefundStateMachine              — PENDING -> PROCESSING ->
│                                                          {COMPLETED|FAILED|REJECTED}
│                        RefundValidator                 — never exceeds a transaction's
│                                                          captured amount
│                        VerificationMatcher              — a provider's verify() result
│                                                          is trusted only after matching
│                                                          the intent's own amount/currency
├── application/     — PaymentIntentService, RefundService,
│                      ReconciliationService.
├── infrastructure/
│   ├── repositories/   — one Prisma-backed implementation per port.
│   ├── providers/       — ZarinpalAdapter (the one real gateway
│   │                      implementation) and
│   │                      PaymentProviderAdapterRegistryImpl.
│   ├── payment.mapper.ts — Prisma-row -> domain-entity mappers.
│   └── queues/          — BullMQ producers/consumers (see "Queues").
└── presentation/
    ├── controllers/  — PaymentIntentController (/payments/intents/*),
    │                   PaymentCallbackController (/payments/callback/*),
    │                   RefundController (/admin/payments/refunds/*),
    │                   ReconciliationController (/admin/payments/reconciliation/*).
    ├── dto/           — request/response DTOs, class-validator + @nestjs/swagger.
    └── filters/       — PaymentDomainExceptionFilter.
```

Dependency direction is one-way:
`presentation → application → domain ← infrastructure`, verified the same
way every prior module's is — `domain/services/*.spec.ts` unit-tests the
pure logic with zero DB, zero NestJS test module, zero mocks.

Full design rationale for every non-obvious decision below:
[`docs/adr/ADR-008-payment-orchestration.md`](../../../../../docs/adr/ADR-008-payment-orchestration.md).

## `PaymentIntent` keys off `CheckoutSession`, not `Order`

`commerce.Order` still requires a non-nullable `customerId` and is created
by nothing in this codebase (Phase 009). `PaymentIntent.checkoutSessionId`
(`@unique`) is the real anchor instead — the artifact that actually exists
and actually carries a fixed, reproducible amount
(`CheckoutSession.grandTotal`/`currency`, frozen in `pricingSnapshot` once
`READY_FOR_PAYMENT`). This module imports `CartCheckoutModule` and injects
its exported `CheckoutService` directly (ADR-008 decision 10) — the one
place this module reaches back into cart-checkout, and only through that
real service, never a raw Prisma write against `commerce.checkout_sessions`.

## Three levels, not one: `PaymentIntent` → `PaymentAttempt` → `PaymentTransaction`

A payment is not a single atomic thing — a customer can be redirected,
abandon the page, come back, get redirected again, and only one of those
attempts actually settles. `PaymentIntent` is the durable "customer owes
X" fact; `PaymentAttempt` is one redirect round trip (a retry creates a
new attempt, never mutates a prior one); `PaymentTransaction` is the
verified, immutable settlement record — created only by
`PaymentIntentService.verifyPayment()`, never updated again once
`VERIFIED`. See ADR-008 decision 2.

## Verification is never inferred from a redirect

`GET /payments/callback/:providerCode` (the customer's browser bouncing
back) only ever triggers a real server-to-server `verifyPayment()` call —
the redirect itself proves nothing. `handleCallback()` records the raw
callback (append-only, `dedupeKey`-unique — decision 4), marks the
matching attempt `RETURNED`, and always re-derives the outcome through
`verifyPayment()`, which matches the provider's result against the
intent's own frozen `amount`/`currency` via `VerificationMatcher` — never
the callback's claimed status. A verified-but-mismatched amount produces
a `FAILED` `PaymentTransaction`, never a silent accept (decision 3).

## The adapter interface is the real provider-independence boundary

`PaymentProviderAdapter` is implemented once for real
(`infrastructure/providers/zarinpal.adapter.ts`) against ZarinPal's actual
documented REST contract — `request.json` → `Authority` → `/pg/StartPay/:authority`
redirect → `verify.json` → `RefID`, plus `reverse.json` for refunds. Two
real gaps in ZarinPal's own API, documented rather than hidden: `verify`/
`reverse` are keyed on `Authority`, not the settled transaction's `RefID`
(resolved via the transaction's own `paymentAttemptId`, never guessed);
and ZarinPal has no cryptographic callback signature, which is exactly
why decision 3 forbids trusting the callback alone. Two hardcoded
sandbox/production base URLs are selected only by `PaymentProvider.
isSandbox` — never from `config` JSON, the concrete SSRF-prevention
decision (see that adapter's own doc comment).

Adding a second gateway later is implementing `PaymentProviderAdapter`
again and registering it in `PaymentProviderAdapterRegistryImpl` — zero
changes to `PaymentIntent`/`PaymentTransaction`/the application layer.

## Refunds: foundation only, never exceeding the captured amount

`RefundValidator.assertRefundable()` runs before a `Refund` row is ever
written — a rejection here never reaches the repository, which is why
`RefundStateMachine` has no `PENDING -> REJECTED` edge for that case (a
provider-side decline is what `REJECTED` means). `RefundService.
processRefund()` submits to the real adapter, resolving ZarinPal's
`Authority` requirement via the transaction's own `paymentAttemptId`.

## Reconciliation never silently corrects local state

`ReconciliationService.reconcileTransaction()` compares one local
`VERIFIED` transaction against a real `queryPayment()` call and records a
`MATCHED`/`AMOUNT_MISMATCH`/`STATUS_MISMATCH` finding — the only mutator
on a finding (`resolve()`) sets `resolvedAt`/`resolutionNote`, never
`status`/`localAmount`/`remoteAmount`. `MISSING_LOCAL`/`MISSING_REMOTE`
findings need a full provider settlement-report feed this phase doesn't
have — an honestly-documented gap, not a fabricated capability.

## Queues

Three BullMQ queues, registered in-process inside `services/api` via
`infrastructure/queues/payment-queue.module.ts`:

- **`payment_verification_retry`** — every minute: expires whatever
  `PaymentIntent.expiresAt` has passed, then re-verifies any intent whose
  latest attempt was redirected more than 2 minutes ago and never
  returned (a lost/dropped callback).
- **`reconciliation`** — hourly: a real `queryPayment()` comparison
  against every `VERIFIED` transaction from the last 24h; each run writes
  its own timestamped finding, never rewriting a prior one.
- **`refund_status_sync`** — every 5 minutes: drives a `Refund` stuck
  `PENDING` more than a minute forward through the real provider call
  (e.g. a crash between `requestRefund()` and `processRefund()`).

Cannot import `PaymentModule` (would create a cycle — `PaymentModule`
imports this module), so it re-declares its own repository-port bindings
and application services as fresh instances, same precedent
`CartCheckoutQueueModule` set. It does import `CartCheckoutModule`
directly (no cycle risk there) for its exported `CheckoutService`.

## Concurrency safety, proven

Found via this module's own e2e concurrency suite
(`test/payment.e2e-spec.ts`'s "concurrency" section), not assumed:
`prisma.upsert()`/`create()` alone are not race-safe against two truly
simultaneous callers racing on the same unique key. `PrismaPaymentIntentRepository
.create()` (on `checkoutSessionId`), `.createTransaction()` (on
`(providerId, providerReference)`), `.recordCallback()` (on `dedupeKey`),
and `PrismaRefundRepository.create()` (on `idempotencyKey`) all catch the
resulting `P2002` and re-read the winner's row — the same pattern Phase
007 established for `CheckoutSession.idempotencyKey`, reused directly,
not reinvented.

## Deliberately out of scope this phase

Same list as [`docs/product/payment.md`](../../../../../docs/product/payment.md)
and ADR-008's own "Deferred" section:

- `Order` creation from a converted checkout (Phase 009) — this module's
  furthest reach is `CheckoutSession.status = CONVERTED` plus a verified
  `PaymentTransaction`.
- A second real gateway adapter (architecture-ready, not built).
- Multi-provider automatic failover/routing logic.
- Wallet/store-credit as a payment method.
- Chargeback/dispute handling beyond what reconciliation surfaces.
- A refund-triggered inventory restock or `Order`-status transition.
- KMS-backed secret rotation for provider credentials — env vars only.
