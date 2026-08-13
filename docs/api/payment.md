# Payment API (Phase 008)

Endpoint reference for `services/api/src/modules/payment`. This document
follows [`README.md`](./README.md)'s conventions (`/api/v1` base path,
whitelist validation, no GraphQL) — read that document first for what
applies to every endpoint in the service, not just this module's. For the
generated, always-in-sync spec, run the service and open `/api/v1/docs`;
the tables below are a hand-maintained companion for reviewing scope
without booting anything.

Module-level design detail (layering, the three-level payment model,
what's deliberately not built): [`services/api/src/modules/payment/README.md`](../../services/api/src/modules/payment/README.md).
Auth model: [`docs/security/payment-security.md`](../security/payment-security.md).

## Auth: two models, split by who calls each route

- **`payments/intents/*` and `payments/callback/*`** reuse
  `cart-checkout`'s own `ActorResolverGuard` directly (imported, not
  reimplemented) — a payment intent's owner is exactly the checkout
  session's owner, customer or guest alike. See
  `docs/api/cart-checkout.md`'s "Auth" section for the exact guest/
  authenticated resolution rules; they apply unchanged here.
- **`admin/payments/refunds/*` and `admin/payments/reconciliation/*`**
  are permission-gated admin routes behind the service's global
  `JwtAuthGuard` + `AuthorizationGuard`, exactly like every other
  `admin/*` route in this service (`inventory`, `catalog`). No `@Public()`,
  no guest path.

## Payment intents

| Method | Path                    | Auth               | Notes                                                                                                              |
| ------ | ----------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| POST   | `/payments/intents`     | Actor (guest/customer) | Create a `PaymentIntent` for a `READY_FOR_PAYMENT` checkout session; idempotent on `idempotencyKey` (client-supplied or server-generated) |
| GET    | `/payments/intents/:id` | Actor (owner only)  | Read the intent + its attempts + its transactions                                                                  |
| POST   | `/payments/intents/:id/start` | Actor (owner only) | Create a new `PaymentAttempt`, call the provider's real `request.json`, return the redirect URL                    |

`POST .../start` is what actually calls out to the gateway
(`PaymentProviderAdapter.startPayment()`) — creation and starting are two
separate calls so a client can inspect/confirm the intent (amount,
currency, provider) before triggering the real redirect.

## Callback

| Method | Path                             | Auth        | Notes                                                                                                                                    |
| ------ | --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/payments/callback/:providerCode` | `@Public()` | The gateway's redirect return (`?Authority=...&Status=OK|NOK`). Records the raw callback, then always re-derives the outcome via a real `verifyPayment()` call — never trusts the query string alone. |

`providerCode` is the same `PaymentProvider.code` used at intent creation
(e.g. `zarinpal`). The response reports `{ paymentIntentId, status }` as
JSON, not a browser redirect — see the module README's "Frontend:
deliberately not built this phase" note.

## Refunds (admin)

| Method | Path                              | Permission               | Notes                                                                                                       |
| ------ | ---------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/payments/refunds/:id`      | `payment.refund.read`     | Read one refund                                                                                              |
| POST   | `/admin/payments/refunds`          | `payment.refund.create`   | Request a refund against a `VERIFIED` transaction; `RefundValidator` runs before any row is written; idempotent on client-supplied `idempotencyKey` |
| POST   | `/admin/payments/refunds/:id/process` | `payment.refund.process` | Submit a `PENDING` refund to the real provider (ZarinPal `reverse.json`, resolved via the transaction's own `paymentAttemptId`) |

`amount` in `POST /admin/payments/refunds` is a positive integer Rial
amount — never inferred, always the caller's own explicit figure, checked
against `RefundValidator.remainingRefundableAmount()`.

## Reconciliation (admin)

| Method | Path                                                          | Permission                       | Notes                                                                                                  |
| ------ | -------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/payments/reconciliation`                                | `payment.reconciliation.read`    | List every unresolved finding (`resolvedAt IS NULL`)                                                   |
| POST   | `/admin/payments/reconciliation/transactions/:paymentTransactionId/run` | `payment.reconciliation.read`    | Manually run a real `queryPayment()` comparison for one transaction, outside the hourly sweep — useful for support investigating a specific case |
| POST   | `/admin/payments/reconciliation/:id/resolve`                    | `payment.reconciliation.resolve` | Set `resolvedAt`/`resolutionNote` on a finding — never changes `status`/`localAmount`/`remoteAmount`   |

Manually running reconciliation only requires the `read` permission (it's
a read-oriented investigation action, no state changes to a payment
record); resolving a finding requires the separate `resolve` permission,
same split `payment.refund.create` vs `payment.refund.process` uses for
"initiate" vs "act on the provider/settle."

## Idempotency

| Operation           | Mechanism                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment intent creation | `PaymentIntent.idempotencyKey` (client-supplied or server-generated), unique per row, `@unique` also on `checkoutSessionId` — a retried `POST /payments/intents` for the same checkout resolves to the same intent, even under real concurrent races |
| Callback delivery     | `PaymentCallback.dedupeKey`, unique — a provider's well-known at-least-once redelivery habit collapses to one stored callback                                            |
| Transaction verification | `PaymentTransaction` `@unique([providerId, providerReference])` — concurrent `verifyPayment()` calls for the same attempt collapse to one settlement row               |
| Refund request        | `Refund.idempotencyKey`, `@unique`, required (not optional) on the DTO — a retried `POST /admin/payments/refunds` with the same key returns the original refund          |

## Errors

Seven domain error types get a real HTTP mapping via
`PaymentDomainExceptionFilter` (`APP_FILTER`, scoped `@Catch()`):

| Domain error                              | HTTP status |
| ------------------------------------------ | ----------- |
| `InvalidPaymentIntentTransitionError`      | 409         |
| `InvalidPaymentAttemptTransitionError`     | 409         |
| `InvalidPaymentTransactionTransitionError` | 409         |
| `InvalidRefundTransitionError`             | 409         |
| `UnknownPaymentProviderError`              | 404         |
| `RefundExceedsTransactionAmountError`      | 400         |
| `NonPositiveRefundAmountError`             | 400         |

Ownership violations on `payments/intents/*` (an actor reading/starting an
intent that isn't theirs) are a plain `403 Forbidden`, thrown directly by
`PaymentIntentService`'s own ownership check against the underlying
checkout session — not routed through the domain exception filter above,
same convention `docs/api/cart-checkout.md`'s "Errors" section documents
for its own module.

This is intentionally narrower than `docs/api/README.md`'s noted-as-future
general error-shape standardization — it covers exactly this module's
domain-layer error types, not a service-wide `{success, error, requestId}`
envelope.
