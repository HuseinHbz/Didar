# Gap Priority Matrix

Every gap from the Phase 014 audit (full evidence:
[`../roadmap/risk-register.md`](../roadmap/risk-register.md) and
[`../roadmap/technical-debt-register.md`](../roadmap/technical-debt-register.md)),
reclassified here under this phase's own priority definitions:

- **P0** — blocker for architecture, security, data, financial integrity,
  or production. Nothing new is built until every P0 has an owning phase.
- **P1** — blocker for product completion (the platform cannot honestly
  claim to do what it's for without this).
- **P2** — enhancement. Real, worth doing, not blocking anything.

## P0 — architecture / security / data / financial / production blockers

| ID   | Gap                                                                                                                                                                 | Evidence                              | Owner phase | Status                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| P0-1 | Phases 012/013 (returns/refunds/settlement — a financial-integrity subsystem) not merged into `develop`                                                             | `git merge-base` proof, audit §3      | **CP-015**  | **RESOLVED** — merged into `15-feature-integration-reconciliation`, fresh-database-proven, zero drift |
| P0-2 | CI has no Redis service; app has no fail-fast when Redis is unreachable — empirically reproduced (indefinite `ECONNREFUSED` retry loop, no crash, no timeout bound) | Live reproduction, audit §7 / risk R2 | **CP-016**  | Open                                                                                                  |

Both P0s are cheap, bounded, non-architectural fixes — neither requires a
redesign of anything already built. Both must close before any P1/P2 item
below starts, per this phase's own rule.

## P1 — product-completion blockers

| ID   | Gap                                                                                                           | Evidence                                                                                         | Owner phase                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| P1-1 | No rate limiting anywhere in `services/api`                                                                   | Grepped, zero `ThrottlerModule`, audit §8 / risk R3                                              | **CP-016**                                                     |
| P1-2 | Every notification-channel adapter is a stub — OTP/order-confirmation delivery is fake in any real deployment | Adapter source, self-labeled `⚠️ Stub`, audit §9 / risk R4                                       | **CP-017**                                                     |
| P1-3 | Zero client-application business features (storefront/admin/pwa/mobile all unmodified scaffolds)              | File-count + content inspection, audit §10                                                       | **CP-018, CP-020, CP-022**                                     |
| P1-4 | No `Prescription` domain model — only an unreviewed value-range validator                                     | `schema.prisma` grep, `packages/validation/src/prescription.ts`'s own `TODO`, audit §5 / risk R5 | **CP-019**                                                     |
| P1-5 | No production observability (no `/metrics`, no alerting, no runbook)                                          | `prometheus.yml` exists, nothing emits to it; audit §7 / risk R6                                 | **CP-016** (minimums) → **CP-029** (full)                      |
| P1-6 | Live ZarinPal gateway network path never verified                                                             | Documented in Phase 008's own architecture doc, sandbox network policy                           | **CP-008 remainder** (staging verification task, not new code) |
| P1-7 | No penetration test / threat model / OWASP checklist pass                                                     | `docs/security/README.md`'s own "Not yet" section, independently re-verified                     | **CP-028**                                                     |

## P2 — enhancements

| ID    | Gap                                                                                                                         | Evidence                                           | Owner phase                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| P2-1  | No Purchase Order / Supplier model                                                                                          | Blueprint PHASE 4 bullets absent from schema/code  | **CP-021** — **RESOLVED** (`21-feature-procurement`, VALIDATED)                                 |
| P2-2  | 8 stale duplicate git branch refs                                                                                           | Byte-identical SHA comparison, audit §3 / risk R10 | git hygiene, no owning phase needed — safe to delete now                                         |
| P2-3  | Husky installed, no hook files configured                                                                                   | `.husky/` contents, audit §1 / risk R11            | **CP-016** (bundled with its other tooling work)                                                 |
| P2-4  | ~40% of the 153-model schema has zero application code (customer loyalty/wallet/family, CMS, marketing.Campaign, analytics) | Cross-referenced grep, audit §5                    | **CP-019** (customer slice), **CP-023** (CMS), **CP-024** (CRM/campaign), **CP-027** (analytics) |
| P2-5  | No Jalali/Persian calendar support anywhere                                                                                 | Zero hits in dependency tree                       | **CP-020** (presentation-layer, add when the first client renders a date)                        |
| P2-6  | API keys issuable/revocable but not usable to authenticate a request                                                        | Identity module's own documented scope             | **CP-028**                                                                                       |
| P2-7  | No KMS-backed key rotation                                                                                                  | Static `ENCRYPTION_KEY` env var                    | **CP-028**                                                                                       |
| P2-8  | 10 unaudited `eslint-disable` occurrences                                                                                   | Grepped, not individually reviewed                 | next phase touching nearby code, no dedicated phase                                              |
| P2-9  | No CRM beyond coupons (Segmentation/Campaign/Referral/Automation/Support)                                                   | Schema present, zero application code              | **CP-024**                                                                                       |
| P2-10 | No Store/POS/omnichannel capability                                                                                         | Zero code, zero schema beyond generic commerce     | **CP-025**                                                                                       |
| P2-11 | No AI capability                                                                                                            | Zero code                                          | **CP-026**                                                                                       |
| P2-12 | No Advanced Analytics beyond one event-sink table                                                                           | `analytics.AnalyticsEvent` only                    | **CP-027**                                                                                       |

## Rule enforced by this matrix

No feature development starts before every P0 has an owning phase with a
scoped deliverable — both P0s above already do (CP-015, CP-016), which is
exactly what makes [`next-phase-decision.md`](next-phase-decision.md)'s
selection of CP-015 as the immediate next phase the only defensible
choice, not an arbitrary one.
