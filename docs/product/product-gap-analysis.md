# Product gap analysis — Phase 014 audit

Companion to [`docs/roadmap/master-roadmap-audit.md`](../roadmap/master-roadmap-audit.md)
§2, §9, §14 and [`docs/roadmap/phase-status-matrix.md`](../roadmap/phase-status-matrix.md)'s
blueprint-phase table. This document is the product lens specifically:
what does a real customer or admin operator actually get today, versus
what `docs/product/blueprint.md` originally scoped.

## The honest headline

**Nothing in this platform is reachable by a customer or admin operator
today.** Eight backend domain modules exist, several of them
production-grade in rigor (real concurrency proofs, real financial
integrity, real crash recovery) — but zero client applications have any
business feature built (§10 of the audit). A commerce platform's product
completion cannot exceed its reachability. Until a client exists, product
completion is capped regardless of backend depth.

This is a **deliberate, repeatedly-reaffirmed sequencing decision**
(documented eight times, once per phase, in `CLAUDE.md`: "Backend-only,
same precedent") — not an oversight, and the audit is not second-guessing
the choice to sequence database/domain skeleton before UI. But "the
sequencing was deliberate" and "the product is currently 0%-reachable"
are both true at once, and only the second belongs in a completion
percentage.

## Per blueprint-phase reality check

### PHASE 2 — Catalog: strong (~88%)

Product/variant/SKU split, full publication lifecycle, pricing — all real,
tested, hardened. Gap: search is Postgres-only by deliberate choice
(ADR-005 decision 5), not the OpenSearch/Elasticsearch a large catalog
eventually needs for relevance ranking and faceted search at scale — fine
today, a real limit as catalog size grows.

### PHASE 3 — Commerce: strong where merged, blocked where not (~85%)

Cart, checkout, orders, payments, invoicing are all real and deeply
hardened. Returns/refunds/credit-notes (012) and settlement recovery (013)
are equally real but **not on `develop`** (see critical path Gate 1) —
from a product standpoint, "can a customer return an item" is currently
**no**, on the branch this repo calls truth, despite the capability
existing and being well-built on an unmerged branch.

### PHASE 4 — Inventory: solid core, missing procurement (~60%)

Warehouse/stock/ledger/reservation is genuinely excellent (100-way
concurrency proof, never oversold). Purchase and Supplier — both explicit
blueprint bullets — do not exist. Fine for a launch that restocks
manually; a real gap for a platform intending actual procurement
workflows.

### PHASE 5 — Customer: the platform's most significant single product gap (~10%)

Blueprint bullets: Account, Prescription, Family, Wishlist, Loyalty,
Wallet. Reality: `Account` exists only as identity's generic auth (login/
2FA/sessions) plus a thin address-lookup repository. **Prescription does
not exist as a domain concept anywhere** — only an unreviewed value-range
validator with its own `TODO` asking for the exact review it needs before
being trusted. Family, Wishlist, Loyalty, Wallet: database tables exist
(`customer.FamilyMember`/`LoyaltyAccount`/`WalletAccount`), zero
application code touches any of them. For a platform whose entire
positioning is "Iran **Eyewear** Commerce Platform," the absence of any
real prescription-handling capability is the single gap most worth closing
before this platform can honestly claim to serve its stated market
differently from a generic e-commerce clone.

### PHASE 6 — CMS: not built (~5%)

Schema exists (`Page`/`PageSection`/`Banner`/`Article`/`Menu`/`Faq`), zero
application code. No admin can create a landing page, banner, or FAQ entry
today. Reasonable to defer — content management is not commerce-critical —
but should not be silently implied "in progress" by the schema's
existence.

### PHASE 7 — CRM: coupon only (~20%)

Phase 010 built a genuinely strong coupon/promotion engine (deterministic
stacking, no-enumeration-leakage coupon validation, redemption ledger
proven under concurrency). Segmentation, Campaign, Referral, Automation,
and Support ticketing — all separate blueprint bullets — do not exist,
despite `marketing.Campaign`/`customer.CustomerSegment` tables being
present in the schema.

### PHASE 8 — Store (omnichannel/POS): not built (0%)

No code, no schema presence beyond what commerce/inventory already cover
generically. Correctly and explicitly out of scope for the phases
executed so far — this audit is not flagging it as overdue, only as
fully absent, since blueprint completion percentage must count it as 0%
rather than omit it.

### PHASE 9 — Mobile: scaffolding only (~5%)

`apps/mobile` (Flutter) has one placeholder screen; `apps/pwa` is an
unmodified Next.js scaffold. Neither has ever had a real feature built.

### PHASE 10 — AI: not built (0%)

No code anywhere. Correctly sequenced after a reachable, feature-complete
commerce core — building AI recommendation/stylist features against a
platform with no client and 10% customer-domain completion would be
premature regardless of how well-executed it was.

### PHASE 11 — Notification: architecture real, delivery fake (~30%)

The dispatcher/fallback logic (SMS is the backbone every other channel
can fail over to, per blueprint §41) is real and correctly designed. Every
actual provider adapter — SMS, Telegram, WhatsApp, Email, Push — is an
explicit, self-labeled stub that logs and returns a synthetic "sent"
result. **In a real deployment today, no customer would ever receive an
OTP, order confirmation, or shipping notice.** This is the highest-value,
lowest-effort gap on this entire list to close (see risk register R4 and
critical path item 1) — the interface is already correct, only the SMS
adapter's `send()` body needs a real provider call.

### PHASE 12 — Advanced Analytics: not built (~5%)

One generic event-sink table (`analytics.AnalyticsEvent`), no ingestion
pipeline, no reader, no dashboard. Correctly deferred — BI/cohort/CLV
analysis is meaningless without real customer/order volume, which doesn't
exist yet without a reachable client.

### PHASE 13 — Security Hardening: partial (~40%)

RBAC/2FA/audit-log are genuinely strong. Rate limiting, penetration
testing, formal threat modeling, and an OWASP checklist pass are all
absent — see `security-gap-analysis.md`.

### PHASE 14 — Production: partial (~30%)

Backup/restore scripts are real (Phase 003). Load testing, disaster
recovery planning, real monitoring/alerting, a runbook, and an incident-
response process are all absent — see `production-readiness-gap-analysis.md`.

## What this means for the next phase decision

The single highest product-value, lowest-risk action available right now
is **not** a new blueprint phase — it's finishing the reachability chain
for what's already built: merge 012/013 (Gate 1), wire one real SMS
provider (item 1 of critical path), then build the admin panel before the
storefront (internal users first, lowest risk, makes eight already-built
modules operable for the first time by an actual human). Only after that
does starting PHASE 5 (Customer/Prescription) or PHASE 6 (CMS) make sense
as new scope — see [`master-roadmap-v2.md`](../roadmap/master-roadmap-v2.md)
for the full phase definitions in dependency order.
