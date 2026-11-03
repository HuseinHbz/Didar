# ADR-031 — Payment ↔ order ↔ inventory consistency

**Status**: Accepted — implemented on `31-feature-payment-order-consistency`; Definition of Done item 3
(integration into `develop` with a real CI run) is outstanding by design, see
[`phase-031-audit.md`](../product/phase-031-audit.md).
**Phase**: **031** (CP-031) — closes gaps **P0-3, P0-4, P0-5, P0-6, P2-16**, and one defect found while
fixing P0-6 (**P0-6b**, decision 9). Opens gaps **P1-16 – P1-20** and **P2-17** (§6).

## 1. Problem

Money, stock and orders could disagree without anyone being told. The review that
produced [`remediation-roadmap.md`](../product/remediation-roadmap.md) found four such
failures by reading `develop`; this phase **executed** them first (§2) and then fixed them.
They share a root cause: every step was a _check-then-act_ whose "I can't proceed" branch
was **log-and-continue or silent**, so a failure in one module turned into a wrong fact in
the next.

| Gap      | What went wrong                                                                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0-3** | The checkout (and the stock it reserved) lived 20 minutes; the payment window is 30. A customer still on the gateway page at minute 21 lost both.                                                                                   |
| **P0-4** | A payment verified after its checkout lapsed produced **no order**: `markConverted` silently ignored the illegal `EXPIRED → CONVERTED` move and no sweep could discover a `SUCCEEDED` intent whose checkout was not `CONVERTED`.    |
| **P0-5** | An order could become `PAID` with **no stock sold**: only still-`ACTIVE` reservations were converted and every other outcome — including a failed convert — was logged at WARN and ignored. `approve` then let it reach fulfilment. |
| **P0-6** | A _partial_ refund was sent to ZarinPal's `reverse.json`, which takes no amount: the ledger recorded a partial refund while the gateway reversed the whole transaction (or refused), with no alert.                                 |

## 2. Reproduce first

[`services/api/test/payment-order-consistency.e2e-spec.ts`](../../services/api/test/payment-order-consistency.e2e-spec.ts)
was written **before** any fix and run against unmodified `develop` on a real PostgreSQL
(the repository's no-mocks rule for money and stock). The first run, with the 14 tests that
existed then, was **9 failed / 5 passed**. The final 20-test suite was re-run against
`develop`'s `services/api/src` (commit `363b855`) to record the evidence below: **15 failed /
5 passed**, every failure for the stated reason, and the 5 that passed are the controls
(behaviour that must keep working). Per-test evidence, and how to repeat it, is in
[`phase-031-audit.md`](../product/phase-031-audit.md#reproduction-evidence-run-on-unmodified-develop).
Two things the reproduction found that the code reading had not:

- **A reservation race.** `release` and `convert` both read the reservation, decided it was
  `ACTIVE`, and wrote — without locking the reservation row. Twenty concurrent
  `convert` calls on one reservation: **9 and 10 succeeded in two runs** (expected 1),
  leaving phantom negative `reserved`/`on_hand` quantities that
  `available = on_hand − reserved − …` happily netted to a healthy-looking positive number.
  In a `release` × `convert` race, 10 of 20 succeeded in both runs. Any fix to P0-5 that
  re-acquires or sells stock would have inherited this.
- **A refund double-send** (P0-6b, decision 9): of 20 concurrent `process` requests on one
  refund, **5, 6 and 15** were accepted in three runs (the number depends on timing; the
  correct number is 1); in the one run that also counted gateway calls (5 accepted), all 5
  reached the gateway.

## 3. Decisions

### Decision 1 — One reproduction suite, written first, kept as the acceptance test

The suite is the phase's acceptance criteria A1–A6 from the roadmap, plus the two races
above. It stays in the repository as a regression test; it does not mock the database, the
queue or the application services — only the one thing the sandbox cannot reach (the
ZarinPal network call) is substituted, by the shared `FakePaymentProviderAdapter`.

### Decision 2 — Hold while paying (P0-3)

The checkout is kept alive for the whole payment window. `PaymentIntentService.createIntent`
calls `CheckoutService.holdForPayment(checkoutId, paymentWindowEndsAt)` **before** it
creates (or re-uses) an intent; the checkout's deadline becomes the intent's window end plus
`CHECKOUT_PAYMENT_GRACE_MINUTES` (5), time for the gateway callback, the server-side verify
and the conversion to land. Deriving it from the intent's own `expiresAt` means changing
either TTL later cannot reintroduce the mismatch.

Atomicity without a new lock: both sides are **single conditional `UPDATE`s on the same
row** — `extendExpiry` only ever moves the deadline _later_ (monotonic: a `refresh` can no
longer pull a payment hold back to "now + 20 min"), and `claimExpiry` only expires a session
whose deadline is still before the sweep's `dueBefore`. Of a racing hold and expiry exactly
one wins, decided by the database. If the expiry wins, `holdForPayment` throws (409) and **no
intent is ever created for a checkout that is already gone**. The expiry keeps its crash-safe
order — release reservations, then claim — so if the hold lands in the milliseconds after the
reservations were released, the checkout correctly stays alive and the stock is re-acquired
(or surfaced as an exception) at conversion (decision 4); it is logged at WARN
(`checkout_expiry_lost_race`), never silent.

### Decision 3 — An order is created from the _payment_, not from the checkout's status (P0-4)

The `order_conversion` sweep gains a third pass: every payment intent `SUCCEEDED` in the
lookback window that has no order (`listPaidCheckoutIdsWithoutOrder`, backed by the new
`(status, updated_at)` index on `payment_intents`) is converted through the same idempotent
`convertFromCheckout`. The customer need not return to the site. `markConverted` on a
checkout that is not `READY_FOR_PAYMENT` is now a WARN with the checkout id and status
instead of a silent return — the order no longer depends on that flip, but the situation is
visible.

### Decision 4 — Stock is taken out exactly once, or the failure is recorded (P0-5)

`OrderConversionService` allocates every line through `OrderAllocationService`:

1. **Sell the checkout's own reservation** if it still holds the units (the normal path).
2. **Otherwise re-acquire**: reserve afresh under the deterministic key
   `order__<orderId>__<sku>` and sell it. Every racing sweep, retry and customer-return call
   converges on one reservation and one sale.

Both go through `StockSaleService` (new, inventory module), a thin classifier over the real
`ReservationService` — row-locked, ledger-writing, never-negative — that returns a **value**,
not an exception: `SOLD` (also when an earlier or racing call already sold it: selling is
exactly-once), `NOT_HELD`, or `SHORT`. No stock rule is re-implemented. Unexpected failures
(database down…) are deliberately **not** caught: the call fails, the order stays
`PENDING_PAYMENT`, and the sweep resumes it; every step is idempotent.

### Decision 5 — A genuine shortfall opens a blocking `OrderException` (P0-5)

If the stock is gone the customer has still paid, so the order **is** created and `PAID`
(pretending otherwise would hide money) — but a durable `commerce.order_exceptions` row
(`STOCK_SHORTFALL`, `UNIQUE dedupe_key = STOCK_SHORTFALL:<order>:<sku>` so racing callers
collapse onto one row) is opened, audited once, and `OrderService.approve()` — the only edge
out of `PAID` — answers **409** while any exception is `OPEN`.

There is **no override**. The only ways out are real stock (`POST /admin/order-exceptions/:id/retry-allocation`
→ `RESOLVED/ALLOCATED`, 409 while the stock is still short) or cancelling the order
(`RESOLVED/ORDER_CANCELLED`, which requests the refund). This is the repository's standing
"no force-complete path for any state machine" rule applied to a new state machine.

### Decision 6 — Two new permissions, deliberately split

`order.exception.read` (watch the queue) and `order.exception.resolve` (act on it). Granted
to `admin` and, through its `order.*` rule, `order_manager`; **not** to `fulfillment_clerk`,
the warehouse-floor role — the same "a floor role cannot reach the action that releases its
own blocked work" shape `shipment.deliver` established in ADR-011. A read-only auditor can
be given `read` alone.

### Decision 7 — The reservation lifecycle is serialised on the reservation row (found by the reproduction)

`release`, `convert` and `expire` now lock the **reservation** row (`SELECT … FOR UPDATE`)
before they read its status, and only then lock the inventory item (fixed lock order:
reservation → item, so no deadlock between the two). The loser of a race sees a
non-`ACTIVE` reservation and gets `ReservationNotActiveError` (HTTP 409 via the inventory
filter). `AvailableQuantityCalculator.assertNonNegative` additionally rejects any negative
**stored bucket**, not just a negative derived `available` — two wrong buckets could cancel
out. `reserve()` is idempotent under _concurrent_ callers with one key (it hands back the
winner's reservation instead of a spurious error), which the re-acquire path relies on.

### Decision 8 — A refund is never sent to a gateway that cannot express it (P0-6)

Adapters **declare** `capabilities` (`PaymentProviderCapabilities { partialRefund }`);
ZarinPal declares `partialRefund: false` because `reverse.json` takes only `merchant_id` and
`authority`. `RefundCapabilityPolicy` (pure domain service) decides before anything is sent:
a refund of the whole transaction is always sendable; a smaller amount needs the capability;
an amount larger than the transaction is never sendable.

A refused refund ends **`REJECTED` with a `failureReason` and is never sent**. It is not an
error and not a 500: it is finance's work queue, `GET /admin/payments/refunds?status=REJECTED`
(new `status`/`limit` filters, validated at the boundary). The refund request itself is still
accepted and persisted (so there is a durable record of what is owed); only the _send_ is
refused. See [§5](#5-operational-consequence-read-this-before-go-live) for what this means in
production.

Defaults are conservative: every adapter must opt **in** to a capability, and the field is
required on the interface so a new gateway cannot forget to answer.

### Decision 9 — A refund reaches the gateway at most once (P0-6b)

Found while implementing decision 8: `processRefund` was a read-check-then-write. Two
concurrent callers (an admin double-click; the `refund_status_sync` sweep overlapping an
admin request) could both reach the gateway, and the loser's answer — typically "already
reversed" — then overwrote a `COMPLETED` refund with `REJECTED`, which _frees its balance_
after the money has left. (The sweep's own doc comment claimed `assertTransition` protected
against exactly this; it did not — `PROCESSING → PROCESSING` is a legal no-op.)

- `RefundRepositoryPort.claimForProcessing` — one conditional `UPDATE … WHERE status =
'PENDING'`. Under READ COMMITTED a second concurrent `UPDATE` blocks on the row lock,
  re-evaluates the `WHERE`, matches nothing; exactly one caller proceeds. Everyone else gets
  `RefundAlreadyProcessingError` (409) and sends nothing.
- `RefundRepositoryPort.settleProcessing` — the outcome is written only `WHERE status =
'PROCESSING'`, so a terminal state is never overwritten; a lost write fails loudly
  (409 + ERROR log) instead of reporting success. The old unconditional `updateStatus` is
  **removed from the port**, so no unguarded status write remains available.
- **A refund already `PROCESSING` is never re-sent.** If a send was lost mid-flight (crash
  after the gateway accepted, before the outcome was written) the gateway may already have
  returned the money, and a blind re-send could be answered with an error that would then be
  recorded as "not refunded". Such a refund keeps its balance consumed (the safe failure) and
  is listed under `?status=PROCESSING` for finance to check. This **removes** an unsafe
  manual re-drive that existed before; the missing safe recovery is recorded as gap P1-19.
- Transaction, provider and adapter are resolved **before** the claim, so a configuration
  fault (missing provider row) leaves the refund `PENDING` and retryable instead of
  stranding it in `PROCESSING`.

### Decision 10 — `cancel()` no longer hides a failed refund request

`OrderService.cancel()` used to swallow any error from `requestRefund` (`.catch(() =>
undefined)`) and cancel anyway — a customer who had paid and was not refunded was invisible.
It still cancels (the operator's intent stands) but now logs at ERROR and writes an
`ORDER_CANCEL_REFUND_REQUEST_FAILED` audit row, and it requests only the **refundable
remainder** (`paidTotal − refundedTotal`). Automatic retry is not added here (gap P1-18).

### Decision 11 — P2-16 fixed in the test, not the API

`StockQueryService.getAvailability()` correctly returns one row per `(warehouse, location)`;
the test assumed one row per warehouse and read the first of an unordered result. The test
now sums the warehouse's rows.

## 4. Data model (migration `20261024000000_payment_order_consistency`)

Purely additive; hand-authored `down.sql`; no existing row is touched.

- `commerce.order_exceptions` (+ enums `OrderExceptionType`, `OrderExceptionStatus`,
  `OrderExceptionResolution`): `UNIQUE dedupe_key`, indexes on `order_id` and
  `(status, opened_at)`, FK to `orders` `ON DELETE CASCADE`.
- `commerce.refunds.failure_reason TEXT` (nullable).
- Index `payment_intents(status, updated_at)` — a range scan for the sweep's third pass.

## 5. Operational consequence (read this before go-live)

**With ZarinPal as the only gateway, every _partial_ refund is now `REJECTED` and must be
settled by finance by hand.** That includes partial refunds from `POST /admin/orders/:id/refund`
and the refund of a partial return (`ReturnSettlementService`). Only a refund of the whole
transaction — an order cancelled before anything shipped — is sent automatically. Before this
change those partial refunds were sent as whole-transaction reversals: either refused by the
gateway or, worse, accepted and refunding more than the ledger recorded.

Two things are **not** known and are tracked, not assumed (**P1-6**): whether `reverse.json` is
even valid for an already-_verified_ transaction (ZarinPal documents it for reversing a payment
that was not yet verified; the refund of a settled payment may need a different API), and
whether ZarinPal offers an amount-bearing refund call this adapter can use. The capability flag
exists so that, once such a call is implemented **and verified against the sandbox**, flipping
`partialRefund` to `true` is a one-line change and the rest of the system already behaves
correctly. Until then the manual-settlement procedure in
[`docs/operations/refund-manual-settlement-runbook.md`](../operations/refund-manual-settlement-runbook.md)
applies.

## 6. Deliberately not done — recorded as owned gaps

All six are owned by a new phase, **CP-040 — Payment Recovery & Refund Settlement**
(`roadmap.json`; `BLOCKED` on the Q9 owner decision and on the live-gateway check P1-6).
P1-17, P1-18 and P2-17 need no outside decision and could be split off if the owner wants
them sooner.

| Gap       | What is still open                                                                                                                                                                                                                                                              | Why it was not done here                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1-16** | A `REJECTED` refund that finance settles manually is **not recorded** in the system. `Order.refundedTotal` / `paymentStatus` (set when a partial or return refund was _requested_) are not rolled back or confirmed, and `RefundValidator` cannot see the manual payout.        | Needs an owner decision (Q9: who settles it, what record proves it, four-eyes) — inventing a bookkeeping rule would be guessing at finance policy. |
| **P1-17** | Coupon redemption is not re-acquired on a late conversion: `expire()` releases it, `finalize` only converts `RESERVED` rows, so an order created from a payment that outlived its checkout keeps its discount but frees the coupon's usage slot.                                | A promotion-module change with its own concurrency proofs; P0-3 makes the situation rare, not impossible.                                          |
| **P1-18** | `cancel()`'s failed refund request is now visible (log + audit) but not retried: a second `cancel` is a no-op, so nothing re-requests it. Remedy today: `POST /admin/orders/:id/refund` for the remainder.                                                                      | Needs a durable retry design (like `return_settlements`); out of proportion for this phase.                                                        |
| **P1-19** | A refund stuck in `PROCESSING` (decision 9) has no in-system recovery: it must be checked at the gateway and settled manually.                                                                                                                                                  | Needs a gateway status query for refunds (unverified, P1-6) and a manual-review state.                                                             |
| **P1-20** | A payment completed after the **intent** itself expired (30 min) is never verified: `verifyPayment` returns early for a terminal intent, and the verification-retry sweep only looks at non-terminal ones. P0-3 closes the _checkout_ half of this window, not the intent half. | Needs a decision on late-payment policy with the gateway's own auto-reversal behaviour (unverified, P1-6).                                         |
| **P2-17** | `reserve()` takes stock from a **single** location (the one with most available). A SKU whose warehouse total is sufficient but spread across locations fails as short — which, on the re-acquire path, shows up as a false `STOCK_SHORTFALL` (safe direction).                 | Pre-existing since Phase 006; splitting a reservation across locations is an inventory design change.                                              |

Also unchanged by design: inventory restock-on-cancellation stays deferred (ADR-011 decision 8);
no courier integration; live ZarinPal behaviour remains unverified in this sandbox (P1-6).

## 7. Consequences

- A captured payment yields exactly one `PAID` order whether or not the customer returns; a
  `PAID` order never reaches fulfilment without allocated stock; a refund is never sent that
  the gateway cannot honour or that another caller already sent.
- Two new operator surfaces (`/admin/order-exceptions`, `/admin/payments/refunds?status=…`)
  that finance and order managers must actually watch — a queue nobody reads is the same
  failure as a swallowed log line.
- The refund port lost `updateStatus`; anything that wrote a refund status directly must go
  through claim/settle (no such caller existed).
- Behaviour change worth a release note: `POST /admin/payments/refunds/:id/process` on a
  `PROCESSING` refund is now **409** instead of re-sending.
- `down.sql` discards `order_exceptions` rows and `failure_reason` values written since the
  migration — the intended cost of removing a table/column that exists only to hold them.
