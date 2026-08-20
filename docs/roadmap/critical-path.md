# Critical path — Phase 014 audit

Dependency-ordered. Each item names what blocks it and what it blocks.
Items 1–3 are gates: nothing else should start until they're resolved,
per the audit brief's own rule that security/database-integrity/
observability/testing are gates, not final polish.

## Gate 1 — Reconcile `develop` with reality

**Blocks everything.** No new phase should branch from `develop` while it
silently omits the returns/refunds/settlement subsystem — a Phase 015
branched today would fork further from what's actually been built, making
the eventual merge harder, not easier.

1. Merge (or fast-forward) `12-feature-returns-refunds-credit-notes` into
   `develop`.
2. Merge (or fast-forward) `13-feature-return-settlement-reconciliation`
   into `develop` on top of that.
3. Run the real CI pipeline (not the sandbox validation gate) against the
   merged `develop` for the first time these modules have ever seen it.
4. Fix whatever CI-specific gaps surface (see Gate 2 — the Redis gap is
   already known and should be fixed _before_ this merge triggers CI, so
   the first real run isn't the one that discovers it).
5. Delete the 8 stale duplicate `feature/*` branch refs while here (R10,
   zero risk, no reason to defer).

**No feature work should happen in this step** — it's a merge and a CI
run, not a rewrite. If the merge itself surfaces conflicts, resolve them
in favor of the newer (013) code, since 012 is 013's own direct ancestor.

## Gate 2 — Fix CI's Redis blind spot

**Independent of Gate 1, should land first or alongside it** — landing it
before the Gate-1 merge means the merge's own first CI run already has a
working Redis service to test against.

1. Add a `redis:7-alpine` service to `.github/workflows/ci.yml`'s `test`
   job, same pattern as the existing `postgres` service.
2. Add a bounded `maxRetriesPerRequest` / `retryStrategy` to every
   `BullModule.forRootAsync` call (5 files, one line each) so a genuinely
   unreachable Redis fails fast in any environment, not just CI.
3. Add `timeout-minutes` to the `test` job as a backstop against any
   future dependency hang, not just this one.

## Gate 3 — Security and observability minimums before any public exposure

Independent of Gates 1–2, but must land before Phase 015+ adds any
customer-facing surface (client apps, real payment traffic, real
notification delivery):

1. Rate limiting on `services/api` (R3) — global guard + tighter OTP/login
   override.
2. Minimum observability: `/metrics` endpoint wired to the existing
   `prometheus.yml`, plus the 3-alert minimum set (R6).
3. Husky pre-commit hook (R11) — cheap, do it alongside 1–2 rather than as
   its own phase.

## After the gates: the actual next-phase decision

Once Gates 1–3 are closed, the roadmap forks into parallel tracks (see
[`master-roadmap-v2.md`](master-roadmap-v2.md) for the full phase
definitions). Recommended sequencing among them, by dependency and
business value:

1. **Real notification delivery** (R4) — wire one real SMS provider. Small,
   high-value, unblocks "OTP actually reaches a customer," which every
   later customer-facing phase silently depends on already existing.
2. **Admin panel (frontend track, admin-first)** — lowest-risk client
   surface (internal users only), makes the eight already-hardened backend
   modules operable by a real human for the first time. Do this before
   storefront.
3. **Customer domain core** (R5) — account beyond auth, addresses (already
   partially real via `CustomerLookupPort`), and a real Prescription
   domain _after_ the existing `TODO`'s optometry review — this is the
   platform's actual category differentiator and should not stay at 10%
   indefinitely.
4. **Storefront (frontend track)** — depends on 2 and 3 existing enough to
   be worth a customer-facing UI at all.
5. **Inventory: Purchase Orders / Supplier** (R8) — extends existing
   inventory primitives, no new architecture, can happen in parallel with
   2–4 by a different work stream.
6. Everything else in the blueprint (CMS, CRM beyond coupons, Store/POS,
   AI, Analytics, Mobile beyond scaffolding) — deliberately sequenced
   after the above, per the same "depth before breadth" principle that
   produced the strong commerce core. Do not start these while Gates 1–3
   or items 1–4 above are open.

## What this critical path deliberately does not include

No new framework, no new infrastructure technology, no re-architecture of
anything already built. Every item above is additive to what exists,
consistent with the audit brief's own constraint against introducing new
technology without a demonstrated concrete requirement.
