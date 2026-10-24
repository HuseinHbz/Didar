# ADR-030 — Remediation roadmap (phasing the review findings)

**Status**: Accepted
**Phase**: **030** (documentation and governance only — no application code is changed)

## 1. Problem

A cross-functional review of the repository (finance, optical/lens
specialism, marketing, project/product management) produced a long list of
defects and gaps. A list that lives only in a chat transcript is not
actionable: nothing owns it, nothing orders it, and nothing proves it was
fixed. The repository already has the machinery to own, order and prove work —
canonical `CP-XXX` phases, a Definition of Ready / Done, numbered branches, a
machine-readable `roadmap.json`, and `pnpm roadmap:audit`. The decision here is
how to feed the review into that machinery rather than around it.

## 2. Two facts that shaped the plan

1. **The first review used a stale base.** It was run against `main`, which is
   134 commits behind `develop` and contains no `order`, `promotion`, `return`
   or admin-panel code. Every finding was therefore re-verified against
   `origin/develop` before being recorded (`docs/product/remediation-roadmap.md`
   §1). One earlier claim — that a client could send an option
   `priceAdjustment` — was wrong and is retracted there.
2. **Four finished phases are not integrated.** CP-017 (real SMS), CP-019
   (customer + prescription domain), CP-028 (API-key auth, key rotation) and
   CP-029 (`/metrics`, alerting, runbook, load test) are complete and audited
   on their own branches, but `roadmap.json` records them as `NOT_STARTED` /
   `BLOCKED` with no branch. Part of the review's "missing" list is therefore
   an integration problem, not an engineering one.

## 3. Decisions

### Decision 1 — Remediation is expressed as ordinary canonical phases CP-030 – CP-039

No parallel tracking system. The findings become gaps in the existing ID scheme
(`P0-3` onward), each phase gets the same Definition of Ready / Done as every
other, and `roadmap.json` stays the single source of truth. Rationale: the
governance documents exist precisely so work like this cannot drift; reusing them
costs nothing and keeps `pnpm roadmap:audit` meaningful.

### Decision 2 — Ordering principle

(a) Integrity of money, stock and price comes before any new feature;
(b) optical-domain capability (lens pricing, prescription, lab) comes before
differentiators (virtual try-on);
(c) finished-but-unmerged work is integrated rather than re-implemented;
(d) a phase that depends on a domain or business decision the repository cannot
make is **not started** with invented rules — it is recorded as `BLOCKED` with
the decision named, exactly as CP-019 already is.

### Decision 3 — CP-030 is documentation only; CP-031 is the first fix

CP-031 groups four P0 gaps (P0-3 … P0-6) because they are one failure mode — payment,
order and stock disagreeing — and share one test harness (a real-PostgreSQL
checkout → payment → order flow). CP-032 (price/tax integrity) follows. They are
separate phases so each remains small, reviewable and independently revertible.
They are merged in that order because both edit
`cart-checkout/application/checkout.service.ts`; this is a merge-order
recommendation, not a hard dependency.

### Decision 4 — Verification policy for fix phases

Reproduce first: for every defect there is a test that fails on `develop` before
the fix and passes after. Financial and stock proofs run against real PostgreSQL
with no mocked repository (the repository's standing convention). Every migration
ships a `down.sql` verified UP → DOWN → UP. No new "force complete" path is
introduced for any state machine (standing rule); operator resolution of a stuck
state goes through the existing, audited, state-machine-validated transitions.

### Decision 5 — Branch and pull-request topology

Each phase has a numbered branch (`NN-feature-<slug>`). While a predecessor is
unmerged, the next branch is cut from it so it can build on its governance
documents; its pull request targets the predecessor's branch and is re-targeted to
`develop` when the predecessor merges. Nothing is pushed to `main` or `develop`;
every pull request is opened as a draft.

### Decision 6 — Status semantics for the new phases

A phase that is ready to start is `NOT_STARTED`. A phase whose scope depends on a
named decision the owner or a domain expert must make is `BLOCKED`, with the
decision listed in `docs/product/remediation-roadmap.md` §7 — the same meaning
`BLOCKED` already carries for CP-019. A phase implemented on a branch but not yet
merged is `IMPLEMENTED`, never `VALIDATED` (Definition of Done requires
integration and a real CI run).

### Decision 7 — Do not rewrite other phases' status in this phase

`roadmap.json` understates CP-017/019/028/029, but whether and when those branches
merge is the owner's call (CP-039). CP-030 therefore leaves their `status` and
`gitBranch` untouched and adds an additive `unmergedBranch` field recording what
exists, plus a `note` on the affected gaps (P1-2, P1-4, P1-5, P2-6, P2-7). The
field is ignored by `scripts/roadmap-audit.mjs`, so no tooling changes.

### Decision 8 — Regulatory and domain facts are not asserted

The statutory VAT rate, e-invoice requirements, lens taxonomy and warranty
policy are inputs the repository cannot determine. They appear as owner decisions
(§7 Q3–Q7 of the roadmap document), never as constants in code or prose.

## 4. Alternatives considered

| Alternative                                            | Why rejected                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Fix the findings ad hoc, without phases                | Unreviewable, unowned, and bypasses the governance this repository already enforces.                                            |
| One large "remediation" phase                          | P0 money fixes must be small and independently revertible; a mixed change cannot be reviewed or rolled back safely.             |
| Start with optical features (lens pricing, try-on)     | Would build revenue features on a payment path that can capture money without creating an order (P0-4).                         |
| Merge the four finished branches as part of this phase | The decision belongs to the owner: CP-017 is validation-blocked, CP-019 is decision-gated, and every merge needs a real CI run. |
| Fix price/tax (CP-032) before payment/order (CP-031)   | P0-4 and P0-5 can lose an order or sell non-existent stock outright; P0-8 is a silent mispricing — serious, but slower.         |

## 5. Consequences

- `roadmap.json` gains ten phases (CP-030 – CP-039), thirteen requirements and
  sixteen gaps; totals become 40 phases.
- Reviews of this repository must be run against `origin/develop` plus the list
  of unmerged phase branches, never against `main` (recorded in the roadmap
  document §1).
- The owner has an explicit interface to unblock the gated phases: the eight
  questions in §7 of `docs/product/remediation-roadmap.md`.
- The register's P0 entries are verified by reading code on `develop`; CP-031 and
  CP-032 each convert their entries into executable, failing-then-passing proofs.
