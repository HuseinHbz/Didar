# Technical debt register — Phase 014 audit

Scanned via `grep -rEn "TODO|FIXME|HACK"`, `@ts-ignore`/`@ts-expect-error`,
`as any`, `eslint-disable`, across `services/`, `packages/`, `apps/`
(excluding `node_modules`/`dist`/`.d.ts`). Overall verdict: **this codebase
carries unusually little debt for its size.** The items below are the
complete list found — nothing summarized away.

## Explicit markers

| Item                            | Location                                     | Severity | Note                                                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TODO(optometry-domain-expert)` | `packages/validation/src/prescription.ts:12` | MEDIUM   | Honestly labeled: the SPH/CYL/AXIS/ADD numeric bounds are "reasonable industry defaults, not a clinically reviewed spec." Correctly blocks nothing today (no order flow depends on it yet) but must be resolved before any real prescription-taking flow ships. |

That is the **only** `TODO`/`FIXME`/`HACK` in the entire `services`/
`packages`/`apps` tree. Zero `@ts-ignore`, zero `@ts-expect-error`, zero
`as any` casts found anywhere.

## Labeled stubs (not hidden — every one documents itself)

| Item                                             | Location                                                                 | Severity                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| SMS adapter — synthetic "sent", no provider call | `services/notification-worker/src/notifications/adapters/sms.adapter.ts` | HIGH (see risk register R4)                                                                  |
| Telegram adapter — same pattern                  | `.../adapters/telegram.adapter.ts`                                       | MEDIUM                                                                                       |
| WhatsApp adapter — same pattern                  | `.../adapters/whatsapp.adapter.ts`                                       | MEDIUM                                                                                       |
| Email adapter — same pattern                     | `.../adapters/email.adapter.ts`                                          | MEDIUM                                                                                       |
| Push adapter — same pattern                      | `.../adapters/push.adapter.ts`                                           | MEDIUM                                                                                       |
| In-App adapter — same pattern                    | `.../adapters/in-app.adapter.ts`                                         | LOW (in-app is the one channel a real UI could plausibly serve without an external provider) |

Every one of these carries a doc comment starting `⚠️ Stub` and explaining
exactly what a real implementation needs to do — this is debt that was
deliberately taken on with a clear payoff path, not debt someone will
discover by surprise.

## Structural / cross-cutting

| Item                                                            | Location                                                                                                    | Severity | Note                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Redis service in CI `test` job                               | `.github/workflows/ci.yml`                                                                                  | CRITICAL | See risk register R2. Not a marker in code — found by reading the workflow and reproducing live.                                                                                                                                                            |
| No bounded Redis retry strategy                                 | All 5 `*-queue.module.ts` `BullModule.forRootAsync` calls (inventory/cart-checkout/payment/order/promotion) | CRITICAL | Same root cause as above, application-side half.                                                                                                                                                                                                            |
| Husky installed, no hook files                                  | `.husky/` (only `_/` shim present)                                                                          | LOW      | See risk register R11.                                                                                                                                                                                                                                      |
| 8 duplicate stale branch refs                                   | `feature/*` vs `NN-feature-*`                                                                               | LOW      | See risk register R10. Not code debt, git hygiene.                                                                                                                                                                                                          |
| No metrics endpoint despite `prometheus.yml` existing           | `infrastructure/monitoring/` vs `services/api`                                                              | MEDIUM   | See risk register R6.                                                                                                                                                                                                                                       |
| No rate limiting                                                | `services/api` globally                                                                                     | HIGH     | See risk register R3.                                                                                                                                                                                                                                       |
| ~40% of `schema.prisma`'s 153 models have zero application code | `packages/database/prisma/schema.prisma` vs `services/api/src`                                              | MEDIUM   | Not "wrong" — Phase 003 speculatively modeled the whole blueprint up front — but it is unused surface area that migrations, seeds, and ERD docs all still have to carry forward. Worth pruning or building out per-domain, not left ambiguous indefinitely. |

## `eslint-disable` occurrences (10 total, not yet individually justified)

Found via `grep -rln "eslint-disable"` across `services`/`packages`
(10 files). Each occurrence should be revisited the next time its
surrounding file is touched, to confirm the suppression is still needed
and still narrowly scoped — not flagged as wrong, flagged as unaudited.

## What is explicitly _not_ debt (verified, worth stating so it isn't

re-litigated later)

- Money handling: `BigInt` everywhere, zero floats in any financial path
  (grepped across `services/api/src` for money-typed arithmetic).
- No duplicated business logic found across modules — every cross-module
  need is met by importing the owning module's exported service, never by
  re-implementing its logic locally.
- No dead/abandoned modules, no orphaned migrations, no commented-out code
  blocks found during this pass.
