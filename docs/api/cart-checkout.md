# Cart & checkout API (Phase 007)

Endpoint reference for `services/api/src/modules/cart-checkout`. This
document follows [`README.md`](./README.md)'s conventions (`/api/v1` base
path, whitelist validation, no GraphQL) — read that document first for what
applies to every endpoint in the service, not just this module's. For the
generated, always-in-sync spec, run the service and open `/api/v1/docs`;
the tables below are a hand-maintained companion for reviewing scope
without booting anything.

Module-level design detail (layering, granularity, what's deliberately not
built): [`services/api/src/modules/cart-checkout/README.md`](../../services/api/src/modules/cart-checkout/README.md).
Auth model: [`docs/security/cart-checkout-security.md`](../security/cart-checkout-security.md).

## Auth: dual guest/authenticated, not the global guard

Every route in this module is `@Public()` (opting out of the global
`JwtAuthGuard`, which would reject any request with no Bearer token) plus a
custom `ActorResolverGuard`:

- **A present Bearer token still verifies strictly** — a malformed/expired
  token is a real `401`, never silently downgraded to "guest." It must
  resolve to a `customer.customers` row for the token's `userId`; if none
  exists (e.g. an admin/staff account with no customer profile), the
  request `401`s rather than proceeding as either an authenticated
  customer or a silent guest.
- **No Bearer token at all is a legitimate guest request**, identified by
  the `X-Cart-Token` header (absent on the very first call — the server
  mints a fresh `guestToken` and returns it in the response body; the
  client sends it back as `X-Cart-Token` on every subsequent call).

## Cart

| Method | Path              | Notes                                                                                                                     |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/cart`           | Get-or-create the caller's active cart (customer or guest)                                                                |
| GET    | `/cart`           | Same get-or-create semantics as `POST` — either verb works                                                                |
| DELETE | `/cart`           | Deletes the caller's own cart                                                                                             |
| POST   | `/cart/items`     | Add a line; validates SKU `ACTIVE` + product `PUBLISHED` + quantity + live availability                                   |
| PATCH  | `/cart/items/:id` | Update a line's quantity — same validation as add                                                                         |
| DELETE | `/cart/items/:id` | Remove a line                                                                                                             |
| POST   | `/cart/merge`     | Requires an authenticated customer; folds a guest cart (`guestToken` in the body) into theirs                             |
| POST   | `/cart/coupon`    | Apply a coupon code — re-validated (usage limit, per-user limit, validity window), not blindly trusted from a prior apply |
| DELETE | `/cart/coupon`    | Remove the applied coupon                                                                                                 |
| POST   | `/cart/shipping`  | Select a shipping method + destination — server-resolves cost                                                             |
| POST   | `/cart/price`     | Server-side recalculation preview — never trusts a client-supplied total                                                  |

`POST /cart/merge` is the one route that requires `actor.customerId` —
every other route works for both an authenticated customer and a guest.

## Checkout

| Method | Path                              | Notes                                                                                                              |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| POST   | `/checkout`                       | Start a checkout from a cart; idempotent on a client-supplied `idempotencyKey` (a fresh one per call when omitted) |
| GET    | `/checkout/:id`                   | Read the session + its address/latest totals/latest validation/reservations                                        |
| POST   | `/checkout/:id/address`           | Set the shipping/billing address                                                                                   |
| POST   | `/checkout/:id/validate`          | Run every `checkout_validation` check, record the outcome, `OPEN → VALIDATING`                                     |
| POST   | `/checkout/:id/price`             | Server-side recalculation — reads the cart's current lines, never a client-supplied total                          |
| POST   | `/checkout/:id/reserve`           | Allocate a warehouse + hold inventory for every cart line via Phase 006's real reservation engine                  |
| POST   | `/checkout/:id/refresh`           | Extend the session's `expiresAt` — idempotent, repeated calls just keep pushing it forward                         |
| POST   | `/checkout/:id/cancel`            | Idempotent (a same-status no-op); releases every reservation the session holds                                     |
| POST   | `/checkout/:id/ready-for-payment` | Requires a `PASSED` validation, an address, and every line reserved; freezes pricing/shipping/address snapshots    |

`validate()` never throws on a validation _failure_ — that's a normal,
expected outcome the caller inspects via the response's `latestValidation.
{outcome, issues}`. It only throws on a structural problem (session not
found, wrong owner, already terminal).

### Reading the brief's workflow diagram against the endpoint list

The brief's `inventory_integration.workflow` describes the conceptual
sequence "Cart, Checkout Start, Validate, Calculate Final Price, Reserve
Inventory, Create Checkout Session, READY_FOR_PAYMENT." The literal
`api.checkout` endpoint list addresses every step from `validate` onward
by `:id`, which must already exist — so `POST /checkout` (session
creation) necessarily comes _before_ validate/price/reserve in the actual
call order this API implements. This implementation follows the endpoint
list as authoritative; the diagram is the business narrative, not literal
call order.

## Idempotency

| Operation                    | Mechanism                                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout creation            | `CheckoutSession.idempotencyKey` (client-supplied or server-generated), unique — a retried `POST /checkout` with the same key resolves to the same session, even under real concurrent races |
| Inventory reservation        | `InventoryReservation.idempotencyKey`, derived as `checkout__<checkoutSessionId>__<productSkuId>` — a retried `reserve()` call resolves to the same reservation, never a duplicate           |
| Checkout reservation refresh | `refresh()` only ever extends `expiresAt` forward — repeated calls are naturally idempotent, nothing to key                                                                                  |
| Checkout cancel              | `CheckoutStateMachine.isNoOp` — cancelling an already-`CANCELLED` session returns it unchanged                                                                                               |
| Checkout ready-for-payment   | Same no-op check for an already-`READY_FOR_PAYMENT` session                                                                                                                                  |

## Errors

Five domain error types get a real HTTP mapping via
`CartCheckoutDomainExceptionFilter` (`APP_FILTER`, scoped `@Catch()`):

| Domain error                     | HTTP status                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `InvalidQuantityError`           | 400                                                                           |
| `CouponNotApplicableError`       | 400                                                                           |
| `ShippingMethodUnavailableError` | 400                                                                           |
| `InvalidCheckoutTransitionError` | 409                                                                           |
| `NegativeTotalError`             | 500 (a bug in `PricingResolver`, never a legitimate client-triggerable state) |

Ownership violations (a guest/customer acting on a cart/checkout that
isn't theirs) are a plain `403 Forbidden`, thrown directly by
`CartService`/`CheckoutService`'s own `assertOwnership` checks — not routed
through the domain exception filter above.

This is intentionally narrower than `docs/api/README.md`'s noted-as-future
general error-shape standardization — it covers exactly this module's
domain-layer error types, not a service-wide `{success, error, requestId}`
envelope.
