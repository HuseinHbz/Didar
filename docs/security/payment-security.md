# Payment security (Phase 008)

This document is `docs/security/README.md`'s "In place today" table,
expanded for the one module Phase 008 added. Read
[`README.md`](./README.md) first for what applies service-wide (rate
limiting, secrets, dependency scanning, ...); this document only covers
what's specific to the payment domain.

Unlike `docs/security/cart-checkout-security.md`, this module has **two**
distinct access-control models on two disjoint route groups — see
`docs/api/payment.md`'s "Auth" section for the exact split.

## Two auth models, not one

- **`payments/intents/*`, `payments/callback/*`** — customer/guest-facing,
  same `ActorResolverGuard` `cart-checkout` established (reused directly,
  imported from `CartCheckoutModule`, never reimplemented). Ownership is
  per-resource, not role-based: `PaymentIntentService.assertOwnership()`
  checks the intent's `customerId`/`guestToken` against the caller's
  resolved actor, the same shape `CartService.assertOwnership()`/
  `CheckoutService.assertOwnership()` use. `payments/callback/:providerCode`
  is `@Public()` — the gateway calling it carries no Bearer token and
  never could.
- **`admin/payments/refunds/*`, `admin/payments/reconciliation/*`** —
  RBAC, behind the service's global `JwtAuthGuard` + `AuthorizationGuard`,
  gated per-route by `@RequirePermission`.

## RBAC model

Five new `payment.*` permissions:

| Permission                     | Meaning                                                     |
| ------------------------------- | ------------------------------------------------------------- |
| `payment.refund.read`           | Read a refund and its status                                |
| `payment.refund.create`         | Request a refund against a `VERIFIED` payment transaction    |
| `payment.refund.process`        | Submit a `PENDING` refund to the real provider adapter        |
| `payment.reconciliation.read`   | Read reconciliation findings and manually trigger a run       |
| `payment.reconciliation.resolve`| Record a resolution note on a reconciliation finding          |

Two new roles, real least-privilege boundaries, not labels:

- **`payment_manager`** — every `payment.*` permission (a finance
  department head — can request/process refunds and resolve
  reconciliation findings).
- **`finance_auditor`** — `payment.refund.read` and
  `payment.reconciliation.read` only. The same "floor role can't approve
  its own sensitive action" shape `inventory_auditor` established for
  inventory: reading is safe to grant broadly, but `create`/`process`/
  `resolve` are not.

`admin` continues to receive every `payment.*` permission alongside its
existing `catalog.*`/`inventory.*` grants — no separate carve-out.

Note the deliberate split between `refund.create` (initiate) and
`refund.process` (actually submit to the provider and settle) — same
"initiate" vs "act on the provider" separation `payment.reconciliation
.read` (investigate, including the manual per-transaction run) vs
`payment.reconciliation.resolve` (close out a finding) makes.

## IDOR protection on the customer/guest-facing routes

`PaymentIntentService.assertOwnership()` runs on every read/mutation
under `payments/intents/*`:

- An authenticated customer may only act on an intent whose `customerId`
  matches their own.
- A guest may only act on an intent whose `guestToken` matches the one
  `ActorResolverGuard` resolved from `X-Cart-Token`.
- A mismatch is a plain `403`, thrown directly — not routed through
  `PaymentDomainExceptionFilter` (see `docs/api/payment.md`'s "Errors"
  section).

Proven, not just declared: `test/payment.e2e-spec.ts` asserts a
mismatched actor gets `403` reading another actor's intent and `403`
attempting to start payment on it.

## Verification is never inferred from a redirect

The single most important invariant in this module (ADR-008 decision 3),
structurally enforced, not just documented: `GET /payments/callback/
:providerCode` — the customer's browser bouncing back with
`?Authority=...&Status=OK` — never itself produces a `PaymentTransaction`.
`PaymentIntentService.handleCallback()` records the raw callback (see
below) and always calls the real server-to-server `verifyPayment()`,
which matches the provider's own response against the intent's frozen
`amount`/`currency` via `VerificationMatcher` — a verified-but-mismatched
amount produces a `FAILED` transaction, never a silent accept. There is no
code path in this module that marks an intent `SUCCEEDED` from the
callback query string alone. ZarinPal itself has no cryptographic
callback signature — this discipline is the actual mitigation for that
gap, not a `signatureValid` flag alone (`PaymentCallback.signatureValid`
only records whether the callback's `Authority` matched a known attempt,
not a cryptographic guarantee).

## Raw callback ingestion is append-only and deduped, never trusted as fact

Every inbound callback — well-formed or not — is persisted verbatim to
`PaymentCallback` (`dedupeKey` unique) before any processing, so a
rejected or malformed callback still leaves a full audit trail. A
provider's well-known at-least-once redelivery habit is idempotent by
construction: a redelivered callback (`wasNew: false`) is acknowledged
without re-triggering verification, and `verifyPayment()` itself is a
no-op read against an already-terminal intent, so even a genuine race
between two deliveries can't double-process a settlement.

## Amount and currency are never client-supplied

Same absolute rule `cart-checkout` established for pricing, applied here
to the money itself: `PaymentIntent.amount`/`currency` are read once,
at creation, from the checkout session's own frozen `grandTotal`
(`PaymentIntentService.createIntent()`) — no DTO field anywhere in this
module accepts an amount or currency for intent creation. `Refund.amount`
is the one place a caller does supply a figure (an admin explicitly
choosing how much to refund), and it's checked against `RefundValidator
.remainingRefundableAmount()` before any row is written — never allowed
to exceed what the transaction actually settled.

## Provider secrets never reach Postgres

`PaymentProvider.config` (JSON, editable via no endpoint this phase
exposes, only seeded) holds non-secret operational settings only. The
real merchant id/API key are read once, at adapter construction, from an
environment variable namespaced per provider `code`
(`PAYMENT_ZARINPAL_MERCHANT_ID`) — never persisted to Postgres, never
returned by any endpoint, never logged. `ZarinpalAdapter`'s constructor
takes `{ merchantId, isSandbox }` directly; nothing in this module reads a
secret out of a database row.

## SSRF prevention: the gateway base URL is never admin-editable

`ZarinpalAdapter` selects its API/redirect base URL from two hardcoded
constants (`API_BASE.sandbox`/`.production`, `START_PAY_BASE.sandbox`/
`.production`) keyed only by `PaymentProvider.isSandbox` — a boolean, not
a string. `PaymentProvider.config` (which an admin *can* eventually edit)
is never read for a URL. This closes the concrete SSRF vector "an admin
sets `config.baseUrl` to an internal address and the adapter dutifully
calls it" before it could exist, not as an afterthought.

## The one real external network boundary

`PaymentProviderAdapter` is the single point in this entire module that
makes an HTTP call to a system this codebase doesn't control. No
application-layer code outside `infrastructure/providers/zarinpal.adapter.ts`
performs I/O against ZarinPal. `startPayment()`'s callback URL is built
server-side from this service's own configured
`PAYMENT_ZARINPAL_CALLBACK_BASE_URL` plus the resolved `provider.code` —
never from a client-supplied value — so a caller cannot redirect the
gateway's return trip anywhere but this API's own callback route.

## Idempotency and replay

See `docs/api/payment.md`'s "Idempotency" table for the full
per-operation mechanism. The security-relevant property: every one of
those keys (`PaymentIntent.idempotencyKey`, `PaymentCallback.dedupeKey`,
`PaymentTransaction`'s `@unique([providerId, providerReference])`,
`Refund.idempotencyKey`) is a real unique database constraint, not an
application-level cache a restart or a race could bypass — and all four
are race-safe under real concurrent duplicate submissions (`P2002` caught
and re-read), proven by this module's own mandatory concurrency suite,
not only sequential retries.

## Refunds never exceed the captured amount

`RefundValidator.assertRefundable()` runs before a `Refund` row is ever
written — a rejection here never reaches the repository, which is why
`RefundStateMachine` has no `PENDING -> REJECTED` edge for that case (a
provider-side decline is what `REJECTED` means, a distinct failure mode
this validator never produces).

## Reconciliation never silently corrects local state

`ReconciliationService`'s only mutator on an existing finding
(`resolve()`) sets `resolvedAt`/`resolutionNote` — never `status`/
`localAmount`/`remoteAmount`. A finding is a permanent, timestamped
record of what a comparison found at that moment, the same "the ledger
records, it doesn't silently fix itself" discipline `InventoryLedger`
established.

## What's proven, not just declared

- **The two RBAC roles are a real fixture, not a paper matrix.**
  `test/payment.e2e-spec.ts` logs in as `finance_auditor`
  (`+989120000010`) and `payment_manager` (`+989120000009`) via the real
  OTP flow and asserts: `finance_auditor` gets `403` on
  `POST /admin/payments/refunds` and `POST .../refunds/:id/process`, and
  `403` on `POST /admin/payments/reconciliation/:id/resolve`, while
  `payment_manager` can perform every one of those successfully
  end-to-end.
- **IDOR is rejected** on `payments/intents/*` for both a mismatched
  guest and a mismatched authenticated customer.
- **Verification cannot be forged from the callback alone** — proven
  indirectly: every e2e test that reaches a `SUCCEEDED`/`FAILED` intent
  does so only after `FakePaymentProviderAdapter.verifyPayment()` is
  actually invoked; no test path sets a `PaymentTransaction`/intent
  status directly.
- **Concurrent duplicate submissions collapse to one row**, proven for
  all three P2002-guarded paths this module has (intent creation,
  callback recording, transaction verification) — see
  `docs/architecture/payment.md`'s "Concurrency, proven not assumed"
  section for the exact failure mode and fix.
- **No amount this module ever settles or refunds can be client-forged**
  — traced above for both intent creation and refund requests.

## Deliberately not built this phase

- **No cryptographic callback signature verification** — ZarinPal itself
  doesn't offer one; `signatureValid` on `PaymentCallback` records
  whether the callback's `Authority` matched a known attempt, not a
  cryptographic guarantee. The real mitigation is architectural (never
  trusting the callback alone — see above), not a missing signature
  check this phase forgot.
- **No rate limiting specific to payment mutation** — same blanket nginx
  `limit_req_zone` as everything else in this service (see
  `docs/security/README.md`'s "Not yet" list).
- **No audit logging for payment mutations.** Unlike catalog/inventory
  (which write `system.AuditLog` for privileged admin actions), this
  phase does not extend `AuditLogService` into `RefundService`/
  `ReconciliationService` — a real, documented gap: `payment_manager`
  actions (refund process, reconciliation resolve) are exactly the kind
  of privileged action `system.AuditLog` exists for, and reusing it here
  the way inventory does is a natural next step this phase leaves
  undone.
- **No KMS-backed secret rotation** for provider credentials — env vars
  only, same as every other secret in this service.
- **No live-sandbox network verification of `ZarinpalAdapter`** — this
  sandboxed development environment cannot reach `sandbox.zarinpal.com`
  (see `docs/architecture/payment.md`'s dedicated section); the adapter
  is written against ZarinPal's real documented contract but its actual
  request/response behavior against a live sandbox is unverified here, a
  real gap for a staging environment to close.
- **No automatic `Order` or inventory restock action on refund** — same
  "furthest reach is a verified transaction/converted checkout" scope
  boundary the module README's "Deliberately out of scope" section
  states.
