# Remediation Roadmap (CP-030)

**Purpose:** turn the product / finance / optical / marketing / project-management
review of this repository into phased, governed, testable remediation work —
written in this repository's own vocabulary (`CP-XXX` IDs, Definition of
Ready / Done, numbered branches, `roadmap.json` as the machine-readable source
of truth). Decision record: [`../adr/ADR-030-remediation-roadmap.md`](../adr/ADR-030-remediation-roadmap.md).
Audit of this phase: [`phase-030-audit.md`](phase-030-audit.md).

**Verified against:** `origin/develop` at `6a35e9e` on 2026-10-24, plus the four
finished-but-unmerged phase branches listed in §2. **Not** against `main` (see §1).

## خلاصه‌ی فارسی

- این سند، فازبندیِ اصلاحیِ نتایج بازبینی (مالی، عینک‌سازی و لنز، بازاریابی، مدیریت پروژه و محصول) است
  و در قالب حاکمیتی خودِ ریپو نوشته شده (شناسه‌ی `CP-xxx`، شرط‌های «آماده برای شروع» و «تمام‌شده»).
- **اصلاحیه‌ی بازبینی قبلی:** بازبینی اول روی شاخه‌ی `main` انجام شده بود که ۱۳۴ کامیت از `develop` عقب است؛
  همه‌ی ادعاها دوباره روی `develop` راستی‌آزمایی شد. یک ادعا (امکان ارسال `priceAdjustment` از سمت کلاینت)
  نادرست بود و پس گرفته شد (§1).
- **مهم‌ترین یافته‌های مالی (P0):** ممکن است پرداخت موفق ثبت شود ولی سفارش ساخته نشود؛ سفارش می‌تواند
  «پرداخت‌شده» باشد بدون تخصیص موجودی؛ بازپرداخت جزئی بدون مبلغ به ZarinPal ارسال می‌شود؛ مالیات در نبودِ
  تنظیمات صفر می‌شود؛ قیمت سبد تا ۳۰ روز همان قیمت لحظه‌ی افزودن می‌ماند. → فازهای **CP-031** و **CP-032**.
- **حوزه‌ی عینک و لنز (P1):** مدل لنز فقط «نام» دارد؛ قیمت‌گذاری لنز، ثبت نسخه هنگام خرید، گردش‌کار آزمایشگاه
  و ضمانت وجود ندارد → **CP-033 تا CP-035** (نیازمند تصمیم‌های متخصص بینایی‌سنجی؛ بدون آن «آماده» نیستند).
- **بومی‌سازی ایران:** فاکتور مالیاتی (مودیان)، نمایش ریال/تومان، جستجوی فارسی → **CP-036** و **CP-037**.
  **پرو مجازی («VR 5D»)** → **CP-038**؛ تعریف دقیقِ «VR 5D» هنوز مشخص نیست (§7).
- **ادغام:** کارِ کاملِ CP-017 (پیامک واقعی)، CP-019 (نسخه‌ی عینک)، CP-028 (احراز کلید API) و CP-029 (`/metrics`)
  روی شاخه‌های جدا آماده است و در `develop` ادغام نشده؛ بخشی از ایرادهای گزارش اول با ادغام برطرف می‌شود،
  نه بازنویسی → **CP-039**.

## 1. Method, and a correction to the first review

The first review of this repository was done against `main`. `main` is **134
commits behind `develop`** (`git rev-list --left-right --count origin/develop...origin/main`
→ `134 0`), so everything built after Phase 008 — order, promotion, returns,
procurement, the admin panel, Redis reliability, the governance tooling — was
invisible to it. Every claim in this document was therefore re-checked against
`origin/develop` (source reading, `grep`, and — for behavioural claims — a
local build with the unit and real-PostgreSQL e2e suites; see
[`phase-030-audit.md`](phase-030-audit.md) §Verification).

Two corrections to what was said earlier:

1. **Stale base.** The first review's "not built yet" list was partly wrong
   for the reason above. The corrected list is §3 and §4.
2. **Retracted claim.** The first review said a client could send a
   `priceAdjustment` for a cart option. That is **false**: the input DTO
   (`CartItemOptionDto`) accepts only `optionType`/`optionKey`/`optionLabel`;
   `priceAdjustment` exists only on the response DTO, and the global
   `ValidationPipe` runs with `forbidNonWhitelisted`. The real gap is
   different and is recorded as P1-11: option/lens prices are **never
   computed at all**, and a cart line's `configuration` is unvalidated
   free-form JSON.

### What is solid and is deliberately not re-opened

- Money is `BigInt` Rial everywhere; tax/percent are basis points; no floats.
- Inventory is an append-only ledger; every stock mutation funnels through
  one row-locked function; reservations are proven oversell-free under
  100-way concurrency.
- Check-then-act races are closed with `SELECT … FOR UPDATE` or atomic
  single-statement claims, and each closure is proven by a real-PostgreSQL
  concurrency e2e (orders, fulfillments, shipments, coupons, returns,
  settlements, refunds).
- The server never trusts a client total; coupons are re-validated on every
  reprice; the global `JwtAuthGuard` + `AuthorizationGuard` default-deny every
  route; no string-built SQL exists.
- Every phase ships migrations with a hand-authored `down.sql`, an ADR, and a
  recorded audit.

## 2. Verified state of the repository (2026-10-24)

| Ref                                                   | Relative to `origin/develop`    | What it contains                                                                                                                                                   | Why it is not on `develop`                                                                                         |
| ----------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `main`                                                | 0 ahead / **134 behind**        | Modules up to Phase 008 only (`identity`, `catalog`, `inventory`, `cart-checkout`, `payment`, `health`) plus docs — no `order`, `promotion`, `return`, admin panel | Release sync has not been done (`develop` → `main`)                                                                |
| `17-feature-real-notification-delivery` (CP-017)      | 10 ahead / 25 behind (diverged) | Real Kavenegar SMS adapter, BullMQ producer wiring in `services/api`, OTP SMS throttle, adapter/worker tests, audit                                                | "VALIDATION-BLOCKED": needs real network egress and a provisioned SMS credential (`phase-017-validation-audit.md`) |
| `19-feature-customer-domain-prescription` (CP-019)    | 8 ahead / 0 behind              | Customer + address domain, **prescription domain and lifecycle**, RBAC wiring, tests, acceptance matrix and a human decision packet (Q1–Q5)                        | Deliberately held behind five domain-owner decisions (`phase-019-domain-review.md`) — all recorded as UNRESOLVED   |
| `28-feature-security-hardening-completion` (CP-028)   | 3 ahead / 0 behind              | API-key request authentication, encryption-key rotation, guard + adversarial e2e tests, ADR-028, audit                                                             | Finished, never integrated; `roadmap.json` still says `NOT_STARTED` / `gitBranch: null`                            |
| `29-feature-production-readiness-completion` (CP-029) | 3 ahead / 0 behind              | Real `/metrics` on API/worker/notification-worker, alert rules, runbook, load-test script, ADR-029, audit                                                          | Finished, never integrated; `roadmap.json` still says `NOT_STARTED` / `gitBranch: null`                            |

Consequences for the review:

- **P1-4 "no Prescription domain"** is true on `develop` but not for the
  repository as a whole — a full implementation exists on branch 19, gated on
  owner decisions, not on engineering.
- **P1-2 (stub notification adapters), P1-5 remainder (no `/metrics`/alerting),
  P2-6 (API keys unusable), P2-7 (no key rotation)** each already have a
  finished implementation on branches 17/29/28. Their cheapest remediation is
  integration (CP-039), not re-implementation.
- `roadmap.json` therefore **understates** reality for CP-017, CP-019, CP-028,
  CP-029 (gaps P1-15 / P2-15 below).

Test baseline on `develop` before any change (local harness, see audit):
**353/353 unit**, **219/220 e2e** — the one failure is a pre-existing
test-determinism defect (P2-16), not a product failure.

## 3. Findings register

IDs continue the existing `gap-priority-matrix.md` scheme. "Verified" means the
behaviour was read in code on `develop` (file + symbol cited), not inferred.

### 3.1 P0 — financial integrity

| ID       | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Evidence (verified)                                                                                                                                                                                                                                                                                                                                                                                                                   | Owner  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **P0-3** | Checkout stock hold (20 min) is shorter than the payment window (30 min), and the expiry sweep is payment-unaware: a customer still on the gateway page at minute 21 loses the session **and** the stock hold.                                                                                                                                                                                                                                                                                        | `cart-checkout/application/checkout.service.ts` `DEFAULT_CHECKOUT_TTL_MINUTES = 20`; `payment/application/payment-intent.service.ts` `DEFAULT_INTENT_TTL_MINUTES = 30`; `checkout-expiration.processor.ts` expires every `listExpirable(now)` session; `CheckoutService.expire()` releases reservations without consulting any `PaymentIntent`.                                                                                       | CP-031 |
| **P0-4** | A payment verified after its checkout is no longer eligible to become `CONVERTED` produces **no order** unless the customer happens to return to the site: money captured, no order, no invoice.                                                                                                                                                                                                                                                                                                      | `PaymentIntentService.verifyPayment()` → `CheckoutService.markConverted()` is a silent no-op for an illegal transition (`EXPIRED`/`CANCELLED` → `CONVERTED` is not in `CheckoutStateMachine`'s graph). The `order_conversion` sweep discovers work only via `listConvertedSince()` and `listStuckPendingConversion()` — neither can see a `SUCCEEDED` intent whose checkout is `EXPIRED` and which has no order yet.                  | CP-031 |
| **P0-5** | An order can become `PAID` with **no stock allocated**, and nothing alerts anyone.                                                                                                                                                                                                                                                                                                                                                                                                                    | `order/application/order-conversion.service.ts`: only reservations still `ACTIVE` are converted; a released/expired reservation is skipped silently, and a failing `reservations.convert()` is caught and logged at WARN (`reservation_convert_failed`) while conversion proceeds to `PAID` + invoice. `FulfillmentService` has no inventory interaction, so no later step re-checks.                                                 | CP-031 |
| **P0-6** | A **partial** refund is sent to ZarinPal's `reverse.json` with no amount, so the local ledger (partial) and the gateway action (whole-transaction reversal, if accepted) can diverge.                                                                                                                                                                                                                                                                                                                 | `payment/infrastructure/providers/zarinpal.adapter.ts` `refundPayment()` posts only `merchant_id` and `authority`; its `amount` parameter is unused. Live ZarinPal behaviour is unverified in this sandbox (P1-6) — which is exactly why the system must not send what the gateway cannot express.                                                                                                                                    | CP-031 |
| **P0-7** | Tax **fails open**: a missing `pricing.default_tax_rate_basis_points` setting means 0 % tax, and a present value is cast with `Number()` without integer/range validation. The `TaxCalculator` doc comment says `null` means non-taxable while the code applies the default rate (only an explicit `0` is non-taxable). The seeded 900 bps is a demonstration value (its own comment says so); nothing proves production holds the correct statutory rate.                                            | `cart-checkout/application/cart-pricing.service.ts` `getDefaultTaxRateBasisPoints()` / `FALLBACK_DEFAULT_TAX_RATE_BASIS_POINTS = 0`; `domain/services/tax-calculator.ts` `effectiveRate()`; `packages/database/prisma/seed.ts` setting upsert (`update: {}`).                                                                                                                                                                         | CP-032 |
| **P0-8** | A cart line is priced from its **add-to-cart snapshot for up to 30 days** (rolling cart TTL); checkout never compares it with the current catalog price. `PRICE_CHANGED` exists in `CHECKOUT_VALIDATION_ISSUE_CODES` but **nothing emits it**. `ProductPrice.validFrom/validTo` are validated on write but never consulted when a price is resolved. A corrected (e.g. fat-fingered) price therefore does not reach carts that already hold the old one; an increase or decrease is silently ignored. | `cart-checkout/application/cart-pricing.service.ts` (`basePrice: item.unitPriceSnapshot`); `cart.service.ts` `DEFAULT_CART_TTL_DAYS = 30` and the single snapshot in `addItem`; `grep -rn PRICE_CHANGED services/` → only `packages/types/src/enums.ts` and the unrelated audit-action name `PRODUCT_PRICE_CHANGED`; `catalog/infrastructure/repositories/prisma-pricing.repository.ts` `findBySkuId` is a plain `findUnique` by SKU. | CP-032 |

### 3.2 P1 — product completion

| ID        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Evidence (verified)                                                                                                                                                                                                                   | Owner               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **P1-10** | Price changes have **no guardrails**: no below-cost check, no maximum-change threshold, no second-approver step — although the repository's own rules list "large price changes" among actions needing draft → review → approve → publish (`CLAUDE.md`, "Key domain rules").                                                                                                                                                                                                                                  | `catalog/domain/services/price-validator.ts` (checks only `basePrice > 0`, `compareAt > base`, `cost ≥ 0`, `validFrom < validTo`, tax range); `catalog/application/pricing.service.ts` `setPrice()` writes immediately.               | CP-032              |
| **P1-11** | The optical core is missing from pricing: lens type/coating are **name-only** rows; option/lens prices are never computed; a cart line's `configuration` is unvalidated free-form JSON, so "frame + lens package + coating" cannot be priced or validated server-side. (Replaces the retracted `priceAdjustment` claim, §1.)                                                                                                                                                                                  | `schema.prisma` `LensType` / `LensCoating` (`name`, `localizedName`, `description` only); `cart-checkout/application/cart.service.ts` (`configuration?: Record<string, unknown>`); `presentation/dto/cart.dto.ts` option input shape. | CP-033              |
| **P1-12** | A prescription is not really tied to a purchased lens at checkout: a cart option of type `PRESCRIPTION_REFERENCE` is only **shape-checked** — the reference is never resolved to a stored, verified prescription (there is no Prescription model on `develop`), is not required for lens-bearing lines, is not checked for lens compatibility, and nothing gates lab release on an optometrist's review. The Prescription **domain model** itself is P1-4 (CP-019, implemented on branch 19, decision-gated). | `cart-checkout/application/checkout.service.ts` `validate()` (only `PrescriptionReferenceValidator.validate()` → `invalid_shape` → `PRESCRIPTION_REFERENCE_UNVERIFIED`).                                                              | CP-034              |
| **P1-13** | After payment there is **no lab/fitting workflow** for made-to-order lenses (edging, fitting, QC, remake with reason, ETA) and no warranty model; return eligibility knows only `deliveredAt` per item and one global window, so a custom-Rx lens has no distinct return/remake policy.                                                                                                                                                                                                                       | `order/application/fulfillment.service.ts` (no lab concept); `return/domain/services/return-eligibility-validator.ts` (input: `deliveredAt` per item + `returns.window_days`; no item-kind policy).                                   | CP-035              |
| **P1-14** | Invoices carry **no legal tax identity**: no seller registration/economic code, no buyer identity fields, no tax-authority unique invoice ID, no e-invoice integration seam; and there is no single convention for presenting Rial vs Toman (a ×10 display hazard). Regulatory requirements were **not** verified here and must be scoped from current law.                                                                                                                                                   | `schema.prisma` `Invoice` (number, totals, status, `pdfUrl` only); `InvoiceItem` (description, qty, unit, total).                                                                                                                     | CP-036              |
| **P1-15** | **Finished work is not integrated and the roadmap understates it.** CP-017/019/028/029 are complete on their own branches; `roadmap.json` records CP-017/028/029 as `NOT_STARTED` and CP-019 as `BLOCKED` with `gitBranch: null`; `main` is 134 commits behind `develop`.                                                                                                                                                                                                                                     | §2 (all counts reproducible with `git rev-list --left-right --count`).                                                                                                                                                                | CP-039              |
| P1-1      | _(existing)_ No rate limiting. Still unowned; recommended to be assigned before any public storefront (CP-020).                                                                                                                                                                                                                                                                                                                                                                                               | `gap-priority-matrix.md` P1-1.                                                                                                                                                                                                        | unowned — see §7 Q8 |

### 3.3 P2 — enhancements and hygiene

| ID        | Finding                                                                                                                                                                                                                                                                                                                                                   | Evidence (verified)                                                                                                                                                     | Owner  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **P2-13** | Product search is **not Persian-aware**: substring match only on name/slug, no normalization of Arabic/Persian letter variants (ي/ی, ك/ک), digit variants (۱۲۳ / ١٢٣ / 123) or ZWNJ, no ranking, no full-text index — although the blueprint specifies PostgreSQL full-text search first.                                                                 | `catalog/infrastructure/repositories/prisma-product.repository.ts` (`contains` + `mode: 'insensitive'`); ADR-005 decision 5.                                            | CP-037 |
| **P2-14** | No virtual try-on, and the requested "VR 5D" is **undefined** in the blueprint (§18 defines only V1 photo overlay / V2 live-camera landmarks / V3 AI recommendation; "3D Try-On" appears only as the Lenskart benchmark). No schema or code exists.                                                                                                       | `docs/product/blueprint.md` §18; repository-wide grep.                                                                                                                  | CP-038 |
| **P2-15** | **Governance drift.** `canonical-roadmap.md`'s status column is a snapshot from CP-014 (e.g. CP-012/013 shown `BLOCKED`, CP-015 `NOT_STARTED`); `roadmap.json`'s `nextPhase` still recommends CP-021, which is already `VALIDATED`; CP-017/019/028/029 are understated (P1-15). Resolved in this phase for the fields it owns (see `phase-030-audit.md`). | `canonical-roadmap.md` table vs `roadmap.json`.                                                                                                                         | CP-030 |
| **P2-16** | Test-determinism defect: `inventory.e2e-spec › reserves stock, decrementing available…` assumes **one** availability row per warehouse, but `StockQueryService.getAvailability()` returns one row **per (warehouse, location)** from an unordered query, so the test reads an arbitrary row (local run: expected 23, received 25).                        | `inventory/infrastructure/repositories/prisma-inventory-item.repository.ts` `listBySku()` (`findMany` without `orderBy`); the test's `.find(w => w.warehouseId === …)`. | CP-031 |

### 3.4 Review themes that are already owned by existing phases

No new phase is needed for these; they are listed so the review has no orphan.

| Review theme                                                           | Existing owner                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Customer-facing storefront / PWA / Android (nothing a shopper can use) | CP-020, CP-022 (P1-3)                                        |
| CMS, banners, landing pages, SEO content                               | CP-023                                                       |
| CRM, segmentation, campaigns, referral, loyalty/wallet                 | CP-024 (+ CP-019 for the customer slice)                     |
| Abandoned-cart / order-status messages actually delivered              | CP-017 (needs real SMS) + CP-024                             |
| POS / store / omnichannel                                              | CP-025                                                       |
| AI stylist / recommendations (must resolve to real DB products)        | CP-026                                                       |
| Analytics / reporting                                                  | CP-027                                                       |
| Penetration test, threat model, KMS rotation                           | CP-028 (implemented on branch; integration → CP-039)         |
| Metrics, alerting, runbooks, load test                                 | CP-029 (implemented on branch; integration → CP-039)         |
| Live ZarinPal verification                                             | P1-6 (staging task; needs network egress this sandbox lacks) |

## 4. Phase map

| CP         | Name                                          | Branch (planned)                          | Pri | roadmap.json status | Hard dependencies              | Closes                        | Definition of Ready                                                                                               |
| ---------- | --------------------------------------------- | ----------------------------------------- | --- | ------------------- | ------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **CP-030** | Remediation roadmap & review correction       | `30-feature-remediation-roadmap`          | P0  | IMPLEMENTED         | CP-014, CP-015                 | P2-15                         | **Ready — done in this change**                                                                                   |
| **CP-031** | Payment ↔ order ↔ inventory consistency       | `31-feature-payment-order-consistency`    | P0  | NOT_STARTED         | CP-030, CP-007, CP-008, CP-009 | P0-3, P0-4, P0-5, P0-6, P2-16 | **Ready** (no external decision needed)                                                                           |
| **CP-032** | Pricing & tax integrity                       | `32-feature-pricing-tax-integrity`        | P0  | NOT_STARTED         | CP-030, CP-005, CP-007         | P0-7, P0-8, P1-10             | **Ready** for engineering; the statutory VAT rate is a configuration value the finance owner must confirm (§7 Q3) |
| **CP-033** | Optical catalog & lens pricing                | `33-feature-optical-catalog-lens-pricing` | P1  | BLOCKED             | CP-032, CP-005                 | P1-11                         | **Not ready** — needs optician decisions (§7 Q4)                                                                  |
| **CP-034** | Prescription at purchase                      | `34-feature-prescription-at-purchase`     | P1  | NOT_STARTED         | CP-019 (blocked), CP-033       | P1-12                         | **Not ready** — CP-019 decisions + CP-033                                                                         |
| **CP-035** | Lab operations & warranty                     | `35-feature-lab-operations-warranty`      | P1  | BLOCKED             | CP-034, CP-009                 | P1-13                         | **Not ready** — lab / warranty policy undefined (§7 Q5)                                                           |
| **CP-036** | Tax invoice & currency presentation           | `36-feature-tax-invoice-currency`         | P1  | BLOCKED             | CP-032, CP-009                 | P1-14                         | **Not ready** — finance / legal scoping (§7 Q6, Q7)                                                               |
| **CP-037** | Persian-aware search                          | `37-feature-persian-search`               | P2  | NOT_STARTED         | CP-030, CP-005                 | P2-13                         | **Ready**                                                                                                         |
| **CP-038** | Virtual try-on                                | `38-feature-virtual-try-on`               | P2  | BLOCKED             | CP-020, CP-033                 | P2-14                         | **Not ready** — "VR 5D" undefined (§7 Q1)                                                                         |
| **CP-039** | Integration of finished phases & release sync | `39-feature-integration-release-sync`     | P1  | BLOCKED             | — (decision-gated)             | P1-15                         | **Not ready** — owner merge decisions (§7 Q2)                                                                     |

"Hard dependency" means the other phase must exist first. Where two phases
merely touch the same files (CP-031 and CP-032 both edit
`cart-checkout/application/checkout.service.ts`), the recommended merge order
in §5 avoids conflicts without making one depend on the other.

### CP-031 — Payment ↔ order ↔ inventory consistency (P0)

**Objective.** Guarantee that money, order and stock can never disagree: a
captured payment always yields exactly one `PAID` order; a `PAID` order never
exists without allocated stock (or an open, blocking exception); a refund is
never sent to a gateway that cannot honour its amount.

**In scope**

1. _Hold while paying._ The checkout expiry sweep must not expire — or release the
   reservations of — a checkout that has a live payment intent; creating an
   intent extends the hold to cover the intent's own window.
2. _Paid-without-order discovery._ The `order_conversion` sweep gains a pass
   for `SUCCEEDED` intents that have no order, regardless of checkout status,
   calling the same idempotent `convertFromCheckout`.
3. _Stock allocation on conversion._ No swallowed errors. A released or expired
   reservation is re-acquired when stock exists; if stock does not exist the order
   is still created (the customer paid) but a durable `OrderException`
   (`STOCK_SHORTFALL`) is recorded and `approve()` is blocked until an operator
   resolves it (cancel + refund, or restock). No "force complete" path (standing rule).
4. _Refund capability guard._ Gateway adapters declare capabilities; a refund the
   adapter cannot honour exactly (ZarinPal `reverse` is whole-transaction only)
   is not sent, is recorded as `REJECTED` with an explicit reason, and is
   documented for manual settlement.
5. Fix P2-16 (test sums availability per warehouse instead of reading one row).

**Out of scope.** Courier integration; live ZarinPal verification (P1-6);
inventory restock-on-cancel (stays deferred per ADR-011 decision 8); a UI.

**Acceptance (each proven by a real-PostgreSQL e2e or domain unit test; the
defect-reproducing tests are written first and shown failing on `develop`)**

- A1. A checkout with a live payment intent is not expired by the sweep and its reservations stay `ACTIVE`.
- A2. A payment verified after the checkout hold lapsed yields exactly one `PAID` order via the sweep alone (no customer return); concurrent sweeps/returns still yield one order.
- A3. A conversion whose reservation was released but stock exists ends with `PAID` + allocated stock; the ledger shows exactly one sale entry.
- A4. A conversion with insufficient stock ends with `PAID` + one `OPEN` `OrderException`; `approve()` is rejected (HTTP 409) until it is resolved; an audit row exists; nothing is swallowed.
- A5. A partial refund on an adapter without partial-refund capability is never sent to the gateway and is `REJECTED`; a full refund still goes through.
- A6. All pre-existing unit and e2e tests still pass.

**Risks.** Sweep fan-out cost (mitigated by indexed, bounded queries); re-reservation
racing real customers (mitigated by using the same row-locked reservation engine);
new table needs a migration with a verified `down.sql`.

### CP-032 — Pricing & tax integrity (P0)

**In scope.** Tax fail-closed (missing/invalid default rate blocks pricing with a
clear error instead of charging 0 %; integer 0–10 000 validation; comment fixed;
readiness visibility); `PRICE_CHANGED` emitted by `validate()` and enforced by
`readyForPayment()` (never silently charge a different price; explicit "refresh
prices" action); `validFrom/validTo` enforced when a price is resolved;
price-change guardrails (below-cost rejection, a configurable change threshold
that routes to a second approver using the existing approval/four-eyes
convention). **Decision-dependent but defaulted:** tax-exclusive pricing stays
the default (current behaviour); a tax-inclusive display setting is added only
if the owner chooses it (§7 Q3).

**Acceptance.** A cart priced before an admin price change is flagged
`PRICE_CHANGED` at checkout validation and cannot reach payment until the
customer accepts the new price; a missing tax setting yields a typed, mapped
error (not 0 %); a price change beyond the threshold or below cost is not
applied without a second approver; a price outside its validity window is not
used. Real-PostgreSQL e2e for each.

### CP-033 — Optical catalog & lens pricing (P1, decision-gated)

**In scope.** Structured lens taxonomy replacing name-only rows (type, index,
material, coating, tint / photochromic); lens-package pricing (surcharges by
index, coating and Rx tier) resolved server-side by `PricingResolver`; a
validated `configuration` schema for configurable lines; mandatory fit
attributes for frame categories (lens width / bridge / temple).
**Gate:** the taxonomy, tiers and surcharge rules are domain decisions an
optician must supply — the same kind of gate as CP-019. Engineering must not invent them.

### CP-034 — Prescription at purchase (P1, blocked)

**In scope.** A verified-prescription reference on cart/order lines that need Rx
lenses (today's shape-only `PRESCRIPTION_REFERENCE` check becomes a real lookup
against CP-019's prescription store); lens ↔ Rx compatibility check; optometrist release step before lab handoff; immutable Rx
snapshot on the order. **Blocked on** CP-019 (integration + its five decisions)
and CP-033. The system validates format and range; it never invents medical judgement.

### CP-035 — Lab operations & warranty (P1, decision-gated)

**In scope.** A lab-job state machine per Rx order line (received → edging →
fitting → QC → ready) with ETA; remake with reason codes; warranty entity;
made-to-order return policy wired into the existing return-eligibility check.
**Gate:** the lab process, SLAs and warranty / return policy are business decisions.

### CP-036 — Tax invoice & currency presentation (P1, decision-gated)

**In scope.** Legal identity fields on `Invoice`; a provider-independent e-invoice
port (same pattern as payments) with the national tax-authority integration as
an adapter; Persian invoice PDF with Jalali date; one central Rial↔Toman
formatter for every client. **Gate:** current regulatory requirements must be
confirmed by the finance owner / accountant; this repository does not assert them.

### CP-037 — Persian-aware search (P2, ready)

**In scope.** Normalization at index and query time (ي→ی, ك→ک, digit variants →
one form, ZWNJ / tatweel / diacritics); PostgreSQL full-text (`tsvector`) plus
trigram similarity for typos; ranking; admin-managed synonyms **stored in the
database**; facets stay database-driven. OpenSearch remains a later option,
never the source of truth.

### CP-038 — Virtual try-on (P2, decision-gated)

**Proposed scope (pending §7 Q1).** V1: on-device photo overlay with frame assets
and anchor points stored as media metadata in PostgreSQL; V2: live camera
landmarks; any pupillary-distance estimate is labelled approximate and is **not**
used for lens ordering. Requires CP-020 (a storefront to host it) and CP-033
(fit attributes). Nothing is built until "VR 5D" is defined.

### CP-039 — Integration of finished phases & release sync (P1, decision-gated)

**In scope.** In dependency order and with real CI: integrate CP-028 and CP-029
(fast-forward-able, audited), then CP-017 (after its validation gate), then
CP-019 (after its decisions); correct `roadmap.json` (`status`, `gitBranch`,
`latestCommit`) for each; sync `main` from `develop` through a PR. The owner
decides which of these merge and when.

## 5. Sequencing

```
CP-030 ─▶ CP-031 ─▶ CP-032 ─▶ CP-033 ─▶ CP-034 ─▶ CP-035
   │                    └────▶ CP-036
   └────▶ CP-037
CP-020 + CP-033 ─▶ CP-038
CP-039  (independent; best done early because it removes drift)
```

1. **Money first** (CP-031, CP-032): these are P0 and need no outside decision.
   Merge CP-031 before CP-032 (shared `checkout.service.ts`).
2. **Make it an eyewear shop, not a generic shop** (CP-033 → CP-035): gated on
   optician / business decisions, so start the decision conversations now.
3. **Iranian compliance and discovery** (CP-036, CP-037) in parallel.
4. **Differentiators** (CP-038) only after a storefront exists (CP-020).
5. **CP-039** whenever the owner decides — the earlier, the less the roadmap drifts.

Each fix phase follows the repository's own process: dedicated numbered branch
from `develop`, ADR, tests (domain unit + real-PostgreSQL concurrency e2e where
money or stock is involved), `down.sql` for every migration, recorded audit,
`roadmap.json` + `project-progress.md` updated as part of Done.

## 6. What this phase did and did not do

- **Did:** the review correction (§1–§2), the findings register (§3), the phase map
  (§4), `roadmap.json` / governance documents updated, ADR-030, `phase-030-audit.md`.
- **Did not:** change application code, merge any branch, touch `main` or
  `develop`, re-open CP-019's decisions, or assert regulatory facts (VAT rate,
  e-invoice requirements) that need an authoritative source.

## 7. Open decisions for the product owner

| #   | Decision                                                                                                                                                                              | Blocks                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Q1  | What exactly is "VR 5D"? Blueprint §18 only defines V1 photo overlay, V2 live-camera landmarks, V3 AI recommendation. Which of these (or something else) do you want first?           | CP-038                   |
| Q2  | Which finished branches may be merged now (28 and 29 are fast-forward-able; 17 needs a live-SMS validation; 19 needs the five decisions), and should `main` be synced from `develop`? | CP-039, P1-2/4/5, P2-6/7 |
| Q3  | Who confirms the statutory VAT rate to configure? Should shelf prices be tax-inclusive (common in Iranian retail) or tax-exclusive (current behaviour)?                               | CP-032                   |
| Q4  | Who is the optician / lens specialist who signs off the lens taxonomy (index, material, coatings), Rx tiers and surcharge rules?                                                      | CP-033, CP-034           |
| Q5  | Lab process and warranty: in-house or outsourced lab, SLA, remake policy, and are made-to-order Rx lenses returnable?                                                                 | CP-035                   |
| Q6  | Which invoice types must be issued to the national tax authority (B2C only, or also B2B), and who is the accountant of record?                                                        | CP-036                   |
| Q7  | Rial or Toman as the customer-facing currency?                                                                                                                                        | CP-036, CP-020           |
| Q8  | Who owns rate limiting (P1-1)? Recommended: a small dedicated phase before any public storefront.                                                                                     | CP-020 go-live           |
