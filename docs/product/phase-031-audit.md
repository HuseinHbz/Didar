# Phase 031 Audit (CP-031 — Payment ↔ Order ↔ Inventory Consistency)

Required audit output for CP-031, matching the shape
[`phase-030-audit.md`](phase-030-audit.md) established.

## Mission

Guarantee that money, orders and stock cannot silently disagree: a captured payment
always yields exactly one `PAID` order, a `PAID` order never reaches fulfilment without
allocated stock (or an open, blocking exception), and a refund is never sent to a gateway
that cannot honour its amount or that another caller already sent. Closes P0-3, P0-4,
P0-5, P0-6 and P2-16. Every defect was reproduced against real PostgreSQL **before** it
was fixed.

## Canonical source

[`remediation-roadmap.md`](remediation-roadmap.md) §4 "CP-031" (scope and acceptance
criteria A1–A6) and [`ADR-031`](../adr/ADR-031-payment-order-consistency.md) (eleven
decisions). Operator procedure for what the system now deliberately does not do by itself:
[`refund-manual-settlement-runbook.md`](../operations/refund-manual-settlement-runbook.md).

## Dependency evidence

CP-031's declared dependencies are CP-030, CP-007, CP-008 and CP-009.

| Dependency | `roadmap.json` status | Note                                                                                               |
| ---------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| CP-007     | `VALIDATED`           | on `develop`                                                                                       |
| CP-008     | `IMPLEMENTED`         | on `develop`; live ZarinPal verification (P1-6) outstanding — this phase depends on its code       |
| CP-009     | `VALIDATED`           | on `develop`                                                                                       |
| CP-030     | `IMPLEMENTED`         | **not on `develop`** — draft PR #5; this branch is stacked on it (see "Branch" and honesty note 3) |

## Branch

`31-feature-payment-order-consistency`, cut from `30-feature-remediation-roadmap` at
`363b855` (CP-030's tip). Never pushed to or merged into `main` / `develop`.

## Commits

`git log 363b855..31-feature-payment-order-consistency`, oldest first:

1. `b738ddb` — fix(inventory): serialize reservation release/convert/expire on the reservation row (P0-5)
2. `607dc12` — fix(checkout): hold the checkout for the whole payment window (P0-3)
3. `e1a45e2` — feat(database): `order_exceptions`, `refunds.failure_reason`, `payment_intents(status, updated_at)`
4. `2202bfe` — fix(order): allocate stock on conversion; an open `OrderException` blocks approve (P0-4, P0-5)
5. `190f7d5` — test(inventory): sum a warehouse's per-location rows in the reservation test (P2-16)
6. `354b8aa` — fix(payment): never send a gateway a refund it cannot express; send each refund once (P0-6, P0-6b)
7. `81d5d47` — test(payment): CP-031 reproduction + acceptance suite on real Postgres
8. `1cd4f7b` — fix(order): validate order-exception list filters at the boundary (a 500 on a malformed UUID, found while writing this audit; reproduced first)
9. _(documentation commits)_ — ADR-031, runbook, this audit, governance and module documents
10. _(follow-up)_ — record the phase's own final SHA in `roadmap.json` (the CP-021 / CP-030 precedent)

## Implementation summary

Behaviour, by gap (design rationale and rejected alternatives are in ADR-031):

- **P0-3 — hold while paying.** `CheckoutService.holdForPayment` extends the checkout (and
  therefore its stock reservations) to the payment intent's window plus a 5-minute grace;
  `PaymentIntentService.createIntent` calls it before creating or re-using an intent. Both the
  hold (`extendExpiry`, monotonic) and the expiry (`claimExpiry`) are single conditional
  `UPDATE`s on the same row, so of a racing hold and expiry the database picks exactly one.
- **P0-4 — an order follows the payment.** The `order_conversion` sweep gains a third pass over
  `SUCCEEDED` payment intents that have no order, regardless of checkout status
  (`listPaidCheckoutIdsWithoutOrder`, served by the new `(status, updated_at)` index). The
  customer need not return to the site. `markConverted` on an ineligible checkout is now a
  WARN, not silent.
- **P0-5 — stock is sold exactly once or the failure is recorded.** Conversion sells the
  checkout's reservation or re-acquires the stock (`StockSaleService` +
  `OrderAllocationService`, idempotent under a deterministic key). A genuine shortfall opens a
  durable `OrderException` (`STOCK_SHORTFALL`, `UNIQUE dedupe_key`); `approve` answers 409 while
  one is `OPEN`; the only exits are `retry-allocation` (needs real stock) or cancelling the
  order. New operator surface `GET/POST /admin/order-exceptions…` with two split permissions
  (`order.exception.read`, `order.exception.resolve`) — not granted to `fulfillment_clerk`.
- **Reservation lifecycle race (found by the reproduction).** `release` / `convert` / `expire`
  now lock the reservation row first, then the item (fixed order, no deadlock); the loser gets
  `ReservationNotActiveError` (409). `assertNonNegative` also rejects a negative stored bucket.
- **P0-6 — a refund is never sent to a gateway that cannot express it.** Adapters declare
  `capabilities`; ZarinPal declares `partialRefund: false`. `RefundCapabilityPolicy` decides before
  anything is sent; a refused refund ends `REJECTED` with a `failureReason` and is finance's work
  queue (`GET /admin/payments/refunds?status=REJECTED`).
- **P0-6b — a refund reaches the gateway at most once (found while fixing P0-6).**
  `claimForProcessing` / `settleProcessing` are conditional `UPDATE`s; a `PROCESSING` refund is
  never re-sent (HTTP 409). The unguarded `updateStatus` was removed from the repository port.
- **`cancel()`** no longer swallows a failed refund request: it logs at ERROR, writes an
  `ORDER_CANCEL_REFUND_REQUEST_FAILED` audit row, and requests only `paidTotal − refundedTotal`.
- **P2-16** — the inventory e2e test now sums the warehouse's per-location rows (the API was
  correct; the test read an arbitrary first row).
- **Data model** — migration `20261024000000_payment_order_consistency` (additive, hand-written
  `down.sql`): table `commerce.order_exceptions` + 3 enums, `commerce.refunds.failure_reason`,
  index `payment_intents(status, updated_at)`. Seed gains the two permissions.
- **Tests** — unit +59 (353 → 412), e2e +21 in a new real-PostgreSQL suite
  (`services/api/test/payment-order-consistency.e2e-spec.ts`), full e2e 220 → 241.

## Reproduction evidence (run on unmodified develop)

The reproduction suite was written and run against unmodified source **before** the fixes (the
first run, with the 14 tests that existed then: **9 failed / 5 passed**). It grew as P0-6, P0-6b
and the reservation races were found, and was committed as one commit after the fix commits for
readability — so the history alone does not show "test first". To re-check the table below at
any time:

```bash
FILES=$(git diff --name-only --diff-filter=M 363b855 HEAD -- services/api/src ':!*.spec.ts')
git checkout 363b855 -- $FILES          # develop's application source
# run services/api/test/payment-order-consistency.e2e-spec.ts against a freshly migrated database
git checkout HEAD -- $FILES             # restore (git diff HEAD must be empty afterwards)
```

The final 20-test suite against `develop`'s source: **15 failed / 5 passed** (a 21st test — malformed
list filters on `/admin/order-exceptions` — was added afterwards for a defect in this phase's own
controller: reproduced as an HTTP 500 first, then fixed in `1cd4f7b`). Rows marked
**defect** show wrong behaviour of existing code; rows marked **absent** fail because the
feature they test (a route, a table) does not exist on `develop` — acceptance tests, not
reproductions of a bug.

| Test                                                               | On `develop` source | What was observed                                                                                       |
| ------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------- |
| P0-3 checkout kept alive 21 min in, while the gateway page is open | fail — **defect**   | checkout `EXPIRED` (expected `READY_FOR_PAYMENT`); its stock released                                   |
| P0-3 abandoned checkout still expires                              | pass (control)      | —                                                                                                       |
| P0-3 hold is bounded (payment window + grace)                      | pass (control)      | —                                                                                                       |
| P0-3 `refresh` never shortens a hold                               | pass (guard)        | trivially true without a hold; meaningful once there is one                                             |
| P0-4 order created from the sweep alone                            | fail — **defect**   | no order (`null`) although the payment was verified                                                     |
| P0-4 one order / one invoice under concurrent sweeps + return      | fail — **defect**   | no order, no sale ledger row                                                                            |
| P0-5 released stock is re-acquired and sold exactly once           | fail — **defect**   | order `PAID`, **0** `SALE` ledger rows                                                                  |
| P0-5 shortfall blocks `approve` until resolved                     | fail — **defect**   | `approve` answered **201** for a `PAID` order with no stock sold                                        |
| P0-5 cancel resolves the exception and requests the refund         | fail — **absent**   | no exception recorded                                                                                   |
| P0-5 one exception, not one per racing caller                      | fail — **absent**   | 0 exceptions                                                                                            |
| P0-5 `fulfillment_clerk` has no access to exceptions               | fail — **absent**   | 404 instead of 403 (route does not exist)                                                               |
| Reservation: 20 concurrent `convert` calls                         | fail — **defect**   | **10** fulfilled (first run: 9); expected 1                                                             |
| Reservation: `release` × `convert` race                            | fail — **defect**   | **10** of 20 fulfilled; expected 1                                                                      |
| P0-6 partial refund is not sent, is `REJECTED` with a reason       | fail — **defect**   | `COMPLETED`, sent to the gateway                                                                        |
| P0-6 full refund still sent to a no-partial gateway                | pass (control)      | —                                                                                                       |
| P0-6 partial refund sent to a gateway that declares the capability | pass (control)      | —                                                                                                       |
| P0-6 gateway decline recorded as `REJECTED` with the reason        | fail — **defect**   | `failureReason` undefined (field absent)                                                                |
| P0-6b 20 concurrent `process` requests → one gateway send          | fail — **defect**   | 6 of 20 accepted (HTTP 201); other runs: 5 and 15. In the run that counted sends, 5 reached the gateway |
| P0-6b a `PROCESSING` refund is never re-sent                       | fail — **defect**   | re-sent, HTTP 201                                                                                       |
| Refund list filters validated                                      | fail — **defect**   | `?status=BOGUS` answered 200                                                                            |

The reservation race matters beyond this phase: the phantom negative `reserved` / `on_hand`
quantities it leaves are netted by `available = on_hand − reserved − …` into a
healthy-looking positive number, and any P0-5 fix that re-acquires stock would have inherited it.

## Verification

Every command below was run for this phase, on the final code; none is asserted from memory.

| Check                                                                                  | Result                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/api` unit tests (`jest`)                                                     | **57 suites / 412 tests pass** (baseline on `develop`: 353)                                                                                                                                                                                                                                                    |
| Full e2e suite, real PostgreSQL + Redis, fresh database each time, **twice in a row**  | **17 suites / 241 tests pass, both runs** (125 s and 121 s). Baseline on `develop`: 219 / 220 — the single failure was P2-16, now fixed                                                                                                                                                                        |
| The new suite alone, repeated                                                          | 21 / 21 on the final code; before the last test was added, 20 / 20 in three further runs and the P0-6 group 8 / 8 after the two flakes below were fixed                                                                                                                                                        |
| `eslint .` and `tsc --noEmit` in `services/api`                                        | exit 0 / exit 0                                                                                                                                                                                                                                                                                                |
| `@iecp/types` `typecheck` and `lint`                                                   | clean (rebuilt with tsup after the id/enum additions)                                                                                                                                                                                                                                                          |
| `pnpm exec prettier --check .`                                                         | clean for every tracked file; the only warnings are the three generated, git-ignored `apps/*/next-env.d.ts`                                                                                                                                                                                                    |
| `node scripts/roadmap-audit.mjs --skip-db`                                             | `✓ No structural problems found` — 42 phases; aggregate as recorded 19 completed / 0 partial / 2 in progress / 21 planned / 42 total                                                                                                                                                                           |
| `pnpm validate:structure`                                                              | `✓ Repository structure validation passed`                                                                                                                                                                                                                                                                     |
| Migration `20261024000000_payment_order_consistency`: UP → DOWN → UP on a populated DB | After DOWN: table, column, index and 3 enums gone. After UP: back. `orders` (94 rows), `refunds` core columns (21), `payment_intents` (112) have **identical md5 before and after**; DOWN run twice is harmless; the 3 `order_exceptions` rows written by the e2e run were discarded by DOWN (documented cost) |
| Fresh-database apply                                                                   | all 13 migrations applied in order as `iecp_migrator`, then the seed, on a newly created database (every e2e run starts this way)                                                                                                                                                                              |
| `prisma migrate diff` (schema ↔ migrations drift)                                      | **not run** — needs Prisma's native engine, unreachable here; left to CI's `prisma migrate deploy` + seed steps (honesty note 1)                                                                                                                                                                               |
| `pnpm audit --audit-level high`                                                        | **fails — pre-existing**, see honesty note 2. No dependency manifest or lockfile changed in this phase (`git diff` empty), so none of the findings originates here                                                                                                                                             |
| Real GitHub Actions run for this branch                                                | **pending** — see honesty note 2                                                                                                                                                                                                                                                                               |

Two test flakes were found and fixed in the new suite itself, not tolerated:

1. `read ECONNRESET` in the 20-way concurrent test — supertest binds an un-listened server per
   first request and closes it when that request finishes; fixed with `await app.listen(0)`.
2. A background `refund_status_sync` sweep sent other, leftover `PENDING` refunds through the
   same fake adapter and polluted a global call counter; replaced by a per-authority counter
   (`refundSendsFor`).

## Phase audit checklist ([`phase-audit-checklist.md`](phase-audit-checklist.md))

| Section         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture    | ✓ Layering kept (domain → application → infrastructure → presentation). New domain services are pure (`RefundCapabilityPolicy`, `OrderExceptionPolicy`). `order` reuses `inventory`'s exported `ReservationService` through the new `StockSaleService`. One narrow read-only cross-module query: `listPaidCheckoutIdsWithoutOrder` reads `payment_intents` — justified (an anti-join on `orders.payment_intent_id`, which `order` owns) and the same shape as the existing sweep queries. App boots (full e2e) with no circular dependency |
| Security        | ✓ No client-supplied value is trusted; no new customer route. New admin routes are RBAC-gated by purpose-named permissions. `pnpm audit` — see note 2 (pre-existing)                                                                                                                                                                                                                                                                                                                                                                       |
| Database        | ✓ `down.sql` exists and was run (UP→DOWN→UP). Money stays `BigInt`. Every new financial transition is a row lock or an atomic conditional `UPDATE`. ✗ drift check not run locally (note 1)                                                                                                                                                                                                                                                                                                                                                 |
| API             | ✓ New routes are in `docs/api/order.md` / `docs/api/payment.md`. `ListRefundsQueryDto` and `ListOrderExceptionsQueryDto` are whitelisted. New domain errors have real statuses: `ReservationNotActiveError` 409, `RefundAlreadyProcessingError` 409, exception-blocked `approve` 409                                                                                                                                                                                                                                                       |
| Frontend/Mobile | N/A — backend only, same precedent as every phase since 004 (`apps/*` untouched)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| RBAC            | ✓ `order.exception.read`, `order.exception.resolve` (`domain.resource.action`), seeded and granted to `admin` and, via `order.*`, `order_manager`; **not** `fulfillment_clerk` (proved by a 403 test)                                                                                                                                                                                                                                                                                                                                      |
| Validation      | ✓ `status` / `limit` / `paymentTransactionId` / `returnRequestId` filters validated at the boundary (400); `orderId` / `cursor` / `status` / `limit` of the exception list likewise (tested)                                                                                                                                                                                                                                                                                                                                               |
| Concurrency     | ✓ Proven on real PostgreSQL: 20 concurrent converts → 1; release × convert → 1; 20 concurrent refund `process` → 1 gateway send; racing conversions → 1 exception; concurrent sweeps + return → 1 order + 1 invoice; hold × expiry → exactly one wins                                                                                                                                                                                                                                                                                      |
| Idempotency     | ✓ Order conversion, stock sale (`order__<orderId>__<sku>` key), exception creation (`dedupe_key`), refund claim/settle, retry-allocation — each safe to repeat                                                                                                                                                                                                                                                                                                                                                                             |
| Observability   | ✓ WARN `checkout_expiry_lost_race`, WARN on an ineligible `markConverted`, WARN `refund_not_sent`, ERROR `ORDER_CANCEL_REFUND_REQUEST_FAILED` (+ audit row), ERROR on a lost refund settle. No `/metrics` exists on `develop` (CP-029 is unmerged) — queues are visible only through the admin routes and logs                                                                                                                                                                                                                             |
| Performance     | ✓ The third sweep pass is bounded (24 h look-back) and served by `payment_intents(status, updated_at)`; no N+1 introduced (spot-checked)                                                                                                                                                                                                                                                                                                                                                                                                   |
| Testing         | ✓ Domain unit + real-PostgreSQL concurrency + authorization negatives; full suite run twice with identical results                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Migration       | ✓ Applies to a fresh database and to a populated one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Rollback        | ✓ `down.sql` verified by running it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Backup          | N/A — `infrastructure/postgres/scripts` unaffected (new table lives in the existing `commerce` schema)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CI/CD           | ✗ **Real GitHub Actions run pending, and the gate is red for pre-existing reasons** (P0-9, note 2). Locally green: `validate:structure`, `format:check`, `eslint`, `tsc`, unit, full e2e ×2                                                                                                                                                                                                                                                                                                                                                |
| Documentation   | ✓ ADR-031 · runbook · this audit · `project-progress.md` · `roadmap.json` · governance and module documents re-synchronised                                                                                                                                                                                                                                                                                                                                                                                                                |
| Production      | ✓ No new runtime dependency. No "force complete" path: an `OPEN` exception exits only through real stock or cancellation. ✗ Operational consequence to read before go-live: **with ZarinPal as the only gateway every partial refund is `REJECTED` and settled by hand** (ADR-031 §5)                                                                                                                                                                                                                                                      |

## Environment and honesty notes

1. **Local verification harness.** `binaries.prisma.sh` is unreachable from the sandbox, so
   Prisma's native query engine could not be downloaded. Behavioural runs use a git-excluded
   local client built on the `pg` driver adapter with a shim that maps the adapter's
   unique-violation shape onto `error.meta.target`; `pnpm install` needed
   `--config.engine-strict=false` (Node 22.22.0 vs a transitive `jsdom` requirement).
   **Neither is committed.** The row-locking and conditional-`UPDATE` semantics the proofs rely
   on are PostgreSQL's, not Prisma's, but a real CI run with the native engine is still the
   final arbiter, and `prisma migrate diff` has not been run.
2. **The real CI gate is red on `develop` for reasons unrelated to this phase (new gap P0-9,
   owned by the new CP-041).** Read from the GitHub REST API on 2026-10-24 (job logs are not
   retrievable from this sandbox; only conclusions and annotations):
   - **lint** — failed on **every** recorded run since 2026-08-12 (24 of 24, `main` and
     `develop` included; the one earlier run, 2026-08-11, predates the current workflow and
     passed). The visible annotations are type-aware ESLint errors (`no-unsafe-*` on `any`) in
     `packages/database/prisma/seed.ts`, consistent with the Prisma client not being generated
     when that package is linted. Not reproducible here, where the client is generated; only the
     first ten annotations are visible through the API.
   - **test** (the e2e job) — flaky: of the 12 `develop` pushes on which it ran to completion,
     7 failed and 5 passed (the rest were cancelled by the workflow's `cancel-in-progress`). On
     this repository's PR #5 run (`363b855`) it passed. The documented latent contention on the
     shared seed-admin OTP phone (see `CLAUDE.md`, Phase 012) is a candidate cause, not a
     confirmed one — the failing test names are not retrievable from here.
   - **security** — failed intermittently in August and **fails today**:
     `pnpm audit --audit-level high` reports 8 critical and 32 high advisories across 15 packages
     (e.g. `next`, `handlebars`, `proxy-addr`, `multer`, `body-parser`, `js-yaml`, `undici`).
     Reproduced locally; the lockfile is unchanged by this phase.
   - **build** — passing except two runs on 2026-08-20.

   Consequence: no phase's Definition of Done item 3 ("integrated into `develop` with a real CI
   run") has actually been satisfied since August, so `VALIDATED` in `roadmap.json` has meant
   "validated in the sandbox". CP-031 stays `IMPLEMENTED` until CP-041 repairs the gate.

3. **Stacked branch, and CI trigger.** This branch contains CP-030's commits because CP-030 is
   not yet merged. The workflow runs only for pull requests whose **base** is `main` or
   `develop`, so the draft PR targets `develop` (showing CP-030's commits until PR #5 merges —
   review the last seven code commits and the documentation commits) rather than the CP-030
   branch, where no CI would run. Merge PR #5 first with a merge commit, or rebase this branch.
4. **Live ZarinPal behaviour is unverified** (P1-6). The adapter's `capabilities` encode what the
   documented `reverse.json` contract can express; whether it is valid for an already-verified
   transaction, and whether an amount-bearing refund call exists, are open. The capability flag
   makes flipping `partialRefund` a one-line change once verified.
5. **Behaviour change to release-note.** `POST /admin/payments/refunds/:id/process` on a
   `PROCESSING` refund now answers 409 instead of re-sending. The old re-send was unsafe (a
   second send's error would be recorded as "not refunded", freeing the balance).
6. **Race counts vary per run** (e.g. 5, 6 and 15 of 20 accepted before the fix) because they
   depend on timing; the reproduction proves "more than one", not a particular number.
7. **Sweeps are driven directly in the e2e suite** (`processor.process(NO_JOB)`), with a real
   database and the real services; BullMQ scheduling through Redis is not what is under test.
   The ZarinPal network call is the one substitution (`FakePaymentProviderAdapter`).
8. **No regulatory or policy facts are asserted.** Who settles a rejected refund by hand and what
   record proves it is an owner decision (Q9), not something this phase invented.

## Gaps found / closed

- **Closed:** P0-3, P0-4, P0-5, P0-6, P2-16.
- **Found and fixed inside the phase:** the reservation release/convert/expire race (not on any
  register; found by the reproduction), the refund double-send and terminal-state overwrite
  (P0-6b), `cancel()` hiding a failed refund request, and a 500 on malformed `/admin/order-exceptions` filters
  (this phase's own controller, caught while writing this audit).
- **Opened (owned by CP-040):** P1-16 (a manual refund payout is not recorded; Q9), P1-17 (coupon
  redemption not re-acquired on a late conversion), P1-18 (a failed `cancel()` refund request is
  not retried), P1-19 (a `PROCESSING` refund has no recovery), P1-20 (a payment after the intent
  itself expired is never verified), P2-17 (`reserve()` uses a single location).
- **Opened (owned by CP-041):** P0-9 (the CI gate).

## Result

**IMPLEMENTED.** All CP-031 deliverables exist and pass every check that can be run in this
sandbox. Not `VALIDATED`: Definition of Done item 3 (integration into `develop` with a green real
CI run) is outstanding, and cannot be met until CP-041 repairs the gate.

## خلاصه‌ی فارسی

- فاز ۳۱ چهار نقصِ مالیِ P0 را بست: نگه‌داشتنِ checkout در تمام مدتِ پرداخت (P0-3)، ساخت سفارش از روی
  خودِ پرداخت حتی اگر مشتری برنگردد (P0-4)، فروشِ دقیقاً-یک‌بارِ موجودی یا ثبتِ یک «استثنای سفارش» که
  تأیید سفارش را مسدود می‌کند (P0-5)، و عدم ارسالِ بازپرداختی که درگاه نمی‌تواند به‌همان مبلغ انجام دهد (P0-6).
- هر نقص ابتدا روی PostgreSQL واقعی و روی کدِ اصلاح‌نشده بازتولید شد (۱۵ تست شکست / ۵ کنترل موفق)، سپس اصلاح شد.
  دو باگِ همزمانی هم حین کار پیدا و بسته شد: شرایطِ رقابتیِ release/convert رزرو، و ارسالِ دوباره‌ی یک بازپرداخت به درگاه.
- بعد از اصلاح: ۴۱۲ تستِ واحد و ۲۴۱ تستِ e2e (دو اجرای پشت‌سرهم) سبز؛ migration رفت‌وبرگشت (UP→DOWN→UP) روی دیتابیسِ پُر
  بدون تغییرِ داده‌های قبلی.
- **پیامدِ عملیاتی:** تا زمانی که فقط ZarinPal داریم، هر بازپرداختِ _جزئی_ به‌صورت `REJECTED` ثبت می‌شود و باید دستی تسویه شود
  (راهنما: `docs/operations/refund-manual-settlement-runbook.md`). ثبتِ این تسویه‌ی دستی در سیستم هنوز انجام نشده (P1-16 ← CP-040، منتظر تصمیم Q9).
- **یافته‌ی مهم:** CI واقعیِ گیت‌هاب روی `develop` از مرداد سبز نبوده (lint در همه‌ی اجراها، e2e گاهی، و امروز بررسیِ امنیتیِ وابستگی‌ها) →
  gap جدید P0-9 و فاز CP-041. تا آن زمان هیچ فازی واقعاً `VALIDATED` نمی‌شود؛ CP-031 در وضعیتِ `IMPLEMENTED` می‌ماند.
