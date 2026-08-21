# Requirements Matrix

Every product capability expressed as a uniquely-ID'd requirement
(`REQ-<DOMAIN>-<NUM>`). This is not an exhaustive atomic decomposition of
every field/endpoint — it's the capability-level requirement each
existing test suite, ADR, and route already substantiates, plus the
capability-level requirements the planned phases (CP-015 onward) commit
to. Machine-readable form (same IDs): [`roadmap.json`](roadmap.json).

Columns: **ID · Business Value · User Type · Domain · Phase · Dependencies
· Acceptance Criteria (summary) · Security Requirement · Audit Requirement
· Test Requirement · Status**.

## Identity (CP-004)

| ID        | Business Value                                                    | User Type | Acceptance Criteria                                         | Security                       | Audit                      | Test                                               | Status |
| --------- | ----------------------------------------------------------------- | --------- | ----------------------------------------------------------- | ------------------------------ | -------------------------- | -------------------------------------------------- | ------ |
| REQ-ID-01 | Customer can authenticate via mobile OTP or email+password        | Customer  | Login succeeds only with a valid credential; session issued | JWT + refresh rotation         | Login events audited       | e2e (login, session expiry)                        | DONE   |
| REQ-ID-02 | Admin actions are permission-gated with inheritance and overrides | Admin     | Deny always wins over inherited allow                       | RBAC, deny-override            | Permission changes audited | Unit (permission-resolver) + e2e (bypass attempts) | DONE   |
| REQ-ID-03 | Admin can enable TOTP 2FA                                         | Admin     | Full enroll→verify→login-with-2FA round trip                | TOTP, encrypted secret storage | 2FA events audited         | e2e (full round trip)                              | DONE   |

## Catalog (CP-005)

| ID         | Business Value                                               | User Type      | Acceptance Criteria                                                                          | Security                            | Audit                       | Test              | Status |
| ---------- | ------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------- | ----------------- | ------ |
| REQ-CAT-01 | Admin can manage product publication lifecycle               | Admin          | `DRAFT→IN_REVIEW→APPROVED→PUBLISHED→{UNPUBLISHED,ARCHIVED}` enforced by domain state machine | `catalog.*` RBAC                    | Publication changes audited | Domain unit + e2e | DONE   |
| REQ-CAT-02 | Customer can browse published products with resolved pricing | Customer/Guest | Only `PUBLISHED` products returned; price reflects `ProductPrice`/`PriceHistory`             | Public read route, no auth required | N/A (read-only)             | e2e               | DONE   |

## Inventory (CP-006)

| ID                    | Business Value                                                     | User Type | Acceptance Criteria                                                               | Security                              | Audit                                                 | Test                                 | Status           |
| --------------------- | ------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------- | ------------------------------------ | ---------------- |
| REQ-INV-01            | Stock is never oversold under concurrent reservation               | System    | 100 concurrent reservations against 10 available units yield exactly 10 successes | `inventory.*` RBAC                    | Every ledger entry is an audit record by construction | Real-concurrency e2e (100-way)       | DONE             |
| REQ-INV-02            | Warehouse operators cannot approve their own sensitive adjustments | Admin     | `inventory.adjust` never granted to `warehouse_operator` role                     | Role design, not runtime check        | Adjustment approvals audited                          | RBAC e2e                             | DONE             |
| REQ-PROC-01 (planned) | Admin can create and receive Purchase Orders against a Supplier    | Admin     | Receiving writes to the existing `InventoryLedger`, concurrency-safe              | New `inventory.purchase_order.*` RBAC | PO lifecycle audited                                  | Concurrency e2e (same bar as CP-006) | PLANNED (CP-021) |

## Cart/Checkout/Payment/Order (CP-007/008/009)

| ID                   | Business Value                                                      | User Type       | Acceptance Criteria                                                          | Security                                                   | Audit                               | Test                                                                          | Status  |
| -------------------- | ------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- | ------- |
| REQ-CHK-01           | Guest or authenticated customer can build a cart and check out      | Customer/Guest  | Dual-auth `ActorResolverGuard`; totals always server-computed                | No client-trusted totals                                   | Checkout-session transitions logged | e2e + concurrency (P2002-catch-and-reread)                                    | DONE    |
| REQ-PAY-01           | Payment is verified server-to-server, never from client redirect    | Customer/System | `verifyPayment()` matched against frozen intent amount                       | `VerificationMatcher`                                      | Every transaction recorded          | Domain + e2e                                                                  | DONE    |
| REQ-PAY-02 (partial) | Real ZarinPal gateway round trip works end-to-end                   | Customer        | A real request/verify/redirect cycle completes against ZarinPal              | Server-side verification only                              | N/A                                 | Contract test against documented API (network path unverified — see gap P1-6) | PARTIAL |
| REQ-ORD-01           | Order is created only from a verified payment                       | Customer/System | No `POST /orders` route exists; conversion is the only path                  | Idempotent on `checkoutSessionId`/`paymentIntentId`        | Order creation audited              | e2e + crash-recovery-resumability test                                        | DONE    |
| REQ-ORD-02           | Order completion requires real delivery, not a trusted cache column | Admin/System    | `OrderCompletionValidator` re-derives readiness from real `Fulfillment` rows | `order.shipment.deliver` withheld from `fulfillment_clerk` | Completion audited                  | Domain unit + e2e                                                             | DONE    |

## Promotion (CP-010)

| ID           | Business Value                                                           | User Type       | Acceptance Criteria                                                                   | Security                                  | Audit                                       | Test                                   | Status |
| ------------ | ------------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------- | -------------------------------------- | ------ |
| REQ-PROMO-01 | Coupon redemption never exceeds its usage limit under concurrency        | Customer/System | 20 concurrent `reserve()` calls converge to exactly 1 success against `usageLimit: 1` | Real Postgres `CHECK` constraint backstop | Redemption ledger is itself the audit trail | Concurrency e2e (2 independent proofs) | DONE   |
| REQ-PROMO-02 | Invalid/expired/non-qualifying coupon codes return one generic rejection | Customer        | No enumeration leakage                                                                | N/A                                       | N/A                                         | Security e2e                           | DONE   |

## Returns/Settlement (CP-012/013) — implemented, blocked on integration

| ID         | Business Value                                                                                    | User Type | Acceptance Criteria                                                                                                 | Security                   | Audit                           | Test                                | Status                                           |
| ---------- | ------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------- | ----------------------------------- | ------------------------------------------------ |
| REQ-RET-01 | Customer can request a return against delivered order items                                       | Customer  | Eligibility gated on real fulfillment/delivery data                                                                 | Ownership-checked          | Return lifecycle audited        | e2e                                 | DONE (impl), **BLOCKED on integration (CP-015)** |
| REQ-RET-02 | Refund/credit amount always derives from the immutable order-item snapshot                        | System    | Never recalculated from live catalog/promotion data                                                                 | N/A                        | N/A                             | Domain unit                         | DONE (impl), **BLOCKED on integration (CP-015)** |
| REQ-SET-01 | Restock/refund/credit-note settlement converges to one correct state after arbitrary safe retries | System    | Proven under 20-way concurrency + 5 named crash-window failure-injection tests                                      | Row-locked state machine   | Every transition audited        | Concurrency + failure-injection e2e | DONE (impl), **BLOCKED on integration (CP-015)** |
| REQ-SET-02 | No "force complete" path exists for a stuck settlement                                            | Admin     | Every admin mutation is a real, state-machine-validated transition or the same idempotent method the sync path uses | `return.settlement.*` RBAC | Retry/reconcile actions audited | e2e                                 | DONE (impl), **BLOCKED on integration (CP-015)** |

## Platform reliability (CP-015/016) — planned

| ID          | Business Value                                                        | User Type       | Acceptance Criteria                                                                                      | Security                               | Audit                        | Test                                                               | Status                                                                       |
| ----------- | --------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| REQ-PLAT-01 | Returns/settlement subsystem is reachable from `develop`              | Everyone        | CP-012/013 merged, real CI green                                                                         | Unchanged from CP-012/013's own review | N/A (a merge, not new logic) | Full CI suite                                                      | PLANNED (CP-015)                                                             |
| REQ-PLAT-02 | A Redis outage fails fast and legibly instead of hanging indefinitely | System/Operator | Killing Redis produces a bounded, logged failure within a documented timeout, not an infinite retry loop | N/A                                    | Failure logged               | Regression test re-running this audit's own empirical reproduction | **DONE (CP-016)** — `wait-for-redis.spec.ts` × 3 + live proof, 2 rounds each |
| REQ-PLAT-03 | Public routes are protected against brute-force/abuse                 | Customer/System | A scripted burst against OTP/login is rejected past a documented threshold                               | Additive, does not weaken RBAC/JWT     | Rate-limit rejections logged | New unit/e2e test                                                  | PLANNED — explicitly deferred by CP-016's own non-goals, not yet reassigned  |

## Notification (CP-017) — planned

| ID           | Business Value                                                          | User Type | Acceptance Criteria                                                   | Security                                    | Audit                  | Test                                            | Status           |
| ------------ | ----------------------------------------------------------------------- | --------- | --------------------------------------------------------------------- | ------------------------------------------- | ---------------------- | ----------------------------------------------- | ---------------- |
| REQ-NOTIF-01 | OTP/order-confirmation SMS actually reaches a real Iranian phone number | Customer  | Real send confirmed in a staging environment with real network egress | Provider credentials never logged/committed | Delivery status logged | Contract test against `NotificationChannelPort` | PLANNED (CP-017) |

## Customer/Prescription (CP-019) — planned, blocked

| ID          | Business Value                                               | User Type | Acceptance Criteria                                                                                                             | Security                                                             | Audit                        | Test                                        | Status                                       |
| ----------- | ------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------- | ------------------------------------------- | -------------------------------------------- |
| REQ-CUST-01 | Customer can attach a reviewed prescription to an order line | Customer  | Domain-expert review of `packages/validation/src/prescription.ts`'s bounds is a named, dated ADR sign-off **before** this ships | Prescription data reviewed with financial-data-level ownership rigor | Prescription changes audited | Domain unit (post-review) + e2e (ownership) | PLANNED, **BLOCKED on domain-expert review** |

## Frontend reachability (CP-018/020) — planned

| ID        | Business Value                                                              | User Type | Acceptance Criteria                                                                                                | Security                                                           | Audit                                  | Test                        | Status           |
| --------- | --------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------- | --------------------------- | ---------------- |
| REQ-FE-01 | Admin operator can perform real order/return/inventory actions through a UI | Admin     | Every UI action maps to an existing, already-tested backend route — no new business logic invented in the frontend | UI checks are cosmetic only; backend RBAC remains sole enforcement | N/A (frontend, backend already audits) | Component + e2e smoke tests | PLANNED (CP-018) |
| REQ-FE-02 | Customer can complete a real purchase end-to-end                            | Customer  | Browse→cart→checkout→ZarinPal redirect→confirmation completes in staging                                           | No client-side pricing/discount duplication                        | N/A                                    | Full checkout-flow e2e      | PLANNED (CP-020) |

## Status legend

`DONE` = Implementation+Test+Integration+Documentation all met.
`PARTIAL` = met except one named dimension (stated inline).
`BLOCKED` = implementation complete, a named external blocker prevents
completion. `PLANNED` = defined, zero implementation.

No `DONE` requirement above lacks a cited acceptance criterion — per this
phase's own consistency rule (`P14-15`), that absence would itself be a
validation failure.
