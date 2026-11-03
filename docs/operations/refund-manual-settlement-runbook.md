# Refund manual-settlement runbook (CP-031)

For finance and order-management staff working the refunds the system **could not** (or
**must not**) send to the payment gateway by itself. Companion to
[ADR-031](../adr/ADR-031-payment-order-consistency.md) (why the system behaves this way)
and [`../security/payment-security.md`](../security/payment-security.md).

> **Interim procedure.** Who settles a refund by hand, and what record proves it, is an
> open owner decision (roadmap Q9 → gap P1-16). Until it is decided and built, this runbook
> keeps to what is _safe_ and does not invent finance policy. Where it says "record it in
> your finance ledger", the system has no field for it yet.

**The one fact to hold onto: the database is the source of truth for what the system _sent_.**
A `REJECTED` refund with a `failureReason` of "Partial refund not sent…" means **nothing
reached the gateway** — no money moved for that refund, and none will until a person moves it.

## 1. Where the work shows up

| Queue                                               | How to see it                                                                                                                        | Permission                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Refunds the system refused or the gateway declined  | `GET /admin/payments/refunds?status=REJECTED` (newest first; `limit` up to 200; read `failureReason`)                                | `payment.refund.read`      |
| Refunds that failed technically                     | `GET /admin/payments/refunds?status=FAILED`                                                                                          | `payment.refund.read`      |
| Refunds whose send may have been lost mid-flight    | `GET /admin/payments/refunds?status=PROCESSING` (see §4 — **never re-send**)                                                         | `payment.refund.read`      |
| Paid orders with no stock behind them               | `GET /admin/order-exceptions?status=OPEN` (cancel the order → it is refunded; see §5)                                                | `order.exception.read`     |
| Cancelled orders whose refund request itself failed | Audit log (`GET /audit-log?entityType=Order`), action `ORDER_CANCEL_REFUND_REQUEST_FAILED` (plus an ERROR log line of the same name) | `identity.audit_logs.view` |

Nothing alerts you yet — these are lists you must look at (a notification hook is part of the
open decision, Q9). A sensible interim: review `status=REJECTED` and `status=PROCESSING` at the
start of every working day, and after any order cancellation.

## 2. Read the `failureReason`

| `failureReason` starts with                    | Meaning                                                                                                                                  | Go to |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `Partial refund not sent`                      | The refund is smaller than the original payment and the gateway (ZarinPal) can only reverse a payment as a whole. **Nothing was sent.**  | §3    |
| `Refund not sent: the amount … is larger than` | Should be unreachable (the amount is validated when the refund is requested). Treat as a bug: do not pay out; report it.                 | —     |
| `The payment provider declined the refund`     | The gateway answered and said no (the message is appended). It may already have been reversed, or the payment may not be reversible.     | §3.3  |
| `No provider authority is recorded`            | The refund is `FAILED`: the original payment attempt has no gateway reference, so the system cannot address the gateway. Needs a person. | §3.3  |

## 3. Settling a `REJECTED` refund

### 3.1 Confirm what is owed

1. Open the refund (`GET /admin/payments/refunds/:id`) and note `amount`, `paymentTransactionId`,
   `reason`.
2. Find what it belongs to: a return (`GET /admin/payments/refunds?returnRequestId=…` finds the
   refund from a return; a return's number is in `reason` as `Return <number>`), or an order
   (the transaction's payment intent → order).
3. Confirm the customer is actually owed that amount (the return was approved; the goodwill
   refund was authorised). **Do not pay on the strength of the queue alone.**

### 3.2 Pay the customer outside the system

Pay the customer through the channel finance uses for this (the gateway's merchant panel, or a
bank transfer) for exactly `amount`. The system cannot do this for you, and **must not be
asked to**:

- **Do not** request the same refund again through the API hoping it will go through — it
  will be refused again for the same reason, and a duplicate record is created.
- **Do not** send a refund of the _whole_ transaction to "fix" a partial one. It would refund
  the customer more than they are owed.

### 3.3 Record it

Record, in your finance ledger or ticket: the **refund id**, the **amount**, the **payout
reference** (bank/gateway transaction number), who paid it, and when. For a payment-provider
decline, also record the provider's message from `failureReason`.

If the message says the payment was **already reversed**, the customer has been refunded by the
gateway even though the system shows `REJECTED`; record that as the settlement and do not pay
again.

### 3.4 Know what the system still believes

The system does **not** learn that you paid (gap P1-16). Consequences you must manage by hand
until that is built:

- `Order.refundedTotal` / `paymentStatus` (and a return's status) were set when the refund was
  _requested_; they still show it as refunded. They are correct _after_ you pay, and misleading
  until then.
- The refund balance check (`RefundValidator`) counts only refunds the system sent or has in
  flight. A manual payout is invisible to it. **Before any later refund against the same
  payment**, compute the remaining balance yourself: _payment amount − manual payouts −
  refunds that are `COMPLETED`, `PENDING` or `PROCESSING`_.

## 4. A refund stuck in `PROCESSING`

A refund is `PROCESSING` while its request is with the gateway. If it stays there (the process
died after the gateway accepted but before the answer was recorded), the **gateway may already
have returned the money**.

- **Never re-send it.** The system will not either: `POST …/process` on a `PROCESSING` refund
  answers 409 by design (a second send could be answered with an error that would then be
  recorded as "not refunded", freeing its balance).
- Check the payment at the gateway (merchant panel). If the money was returned, record it (§3.3);
  if not, pay manually (§3.2).
- The refund stays `PROCESSING` and keeps its balance consumed — the safe state. There is no
  in-system action to close it yet (gap P1-19); ask engineering to close it by migration only
  after the outcome is confirmed.

## 5. Paid orders with no stock (`order-exceptions`)

A `STOCK_SHORTFALL` exception means the customer paid, but the units are gone. The order is
`PAID` and **cannot be approved** (409) until the exception is resolved:

1. Stock arrived (or was miscounted)? `POST /admin/order-exceptions/:id/retry-allocation`
   (`order.exception.resolve`) — 409 while still short, success resolves it.
2. Otherwise cancel the order (`POST /admin/orders/:id/cancel`). The exception resolves as
   `ORDER_CANCELLED` and the refund is requested. If the order is cancelled **before anything
   shipped**, that refund is for the whole payment and goes to the gateway automatically; if any
   amount was already refunded, the remainder is partial and lands in §3.

If the cancel's refund request itself failed (audit action `ORDER_CANCEL_REFUND_REQUEST_FAILED`),
the order is cancelled but no refund exists: request the remainder with
`POST /admin/orders/:id/refund` (gap P1-18 — there is no automatic retry yet).

## 6. Escalation

Engineering should hear about: any `failureReason` beginning "Refund not sent: the amount",
any `PROCESSING` refund older than a day, any `FAILED` refund, and any refund `REJECTED` with
"already reversed" that finance did **not** expect (it can mean a double submission upstream).
Owner decisions this runbook is waiting on: [`remediation-roadmap.md` §7](../product/remediation-roadmap.md#7-open-decisions-for-the-product-owner) Q9.
