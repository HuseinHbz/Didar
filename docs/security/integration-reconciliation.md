# CP-015 — Security reconciliation evidence

Companion to [`../product/integration-reconciliation.md`](../product/integration-reconciliation.md).
Covers Phase 6 of this phase's own checklist.

## RBAC / permission matrix — verified directly against seed data

12 `return.*`/`credit_note.*` permissions confirmed present, correctly
scoped, correctly granted:

| Permission                    | `returns_manager` | `returns_clerk` | `finance_auditor` |
| ----------------------------- | ----------------- | --------------- | ----------------- |
| `return.read`                 | ✓                 | ✓               | —                 |
| `return.approve`              | ✓                 | —               | —                 |
| `return.reject`               | ✓                 | —               | —                 |
| `return.receive`              | ✓                 | ✓               | —                 |
| `return.inspect`              | ✓                 | ✓               | —                 |
| `return.refund`               | ✓                 | —               | —                 |
| `credit_note.read`            | ✓                 | —               | ✓                 |
| `credit_note.issue`           | ✓                 | —               | —                 |
| `credit_note.void`            | ✓                 | —               | —                 |
| `return.settlement.read`      | ✓                 | —               | ✓                 |
| `return.settlement.retry`     | ✓                 | —               | —                 |
| `return.settlement.reconcile` | ✓                 | —               | —                 |

Verified by reading `packages/database/prisma/seed.ts`'s actual grant
loops (not inferred from documentation): `returns_manager` receives
every `return.*`/`credit_note.*` permission via a blanket loop over
`permissionDefs`; `returns_clerk` receives exactly `read`/`receive`/
`inspect` via an explicit allow-list (cannot approve, reject, refund, or
touch a credit note or settlement — correctly excluded from
`settlement.retry`/`settlement.reconcile`, since a warehouse-floor clerk
should never hold financial-settlement retry power); `finance_auditor`
receives only the two read permissions plus its own pre-existing
`credit_note.read` — read-only oversight, no mutation capability. No
inconsistency found, no permission granted to a role that shouldn't hold
it, no permission a role needs but lacks.

**Deliberate, documented absence:** no `return.settlement.manual_review`
permission exists — a `MANUAL_REVIEW` settlement is resumed through the
same `settlement.retry` action, per `ReturnSettlementService.retry()`'s
own doc comment (carried over unchanged from CP-013, re-verified present
in the merged code).

## Admin endpoint authorization

Every `admin/returns/*`, `admin/credit-notes/*`, and
`admin/returns/*/settlement*`/`reconcile` route sits behind the global
`JwtAuthGuard` + `AuthorizationGuard`, gated by the permissions above —
no `@Public()` decorator found on any of them (grepped). Customer-facing
`returns/*` routes reuse `cart-checkout`'s own `ActorResolverGuard`,
ownership-scoped by `ReturnService` itself — unchanged by this merge.

## Financial mutation authorization — the phase's own explicit rule

_"No endpoint may allow an unprivileged actor to mutate financial
state."_ Checked against every financial mutation route introduced by
CP-012/013:

- `POST /admin/returns/:id/refund` → `return.refund`
- `POST /admin/credit-notes/:id/issue` → `credit_note.issue`
- `POST /admin/credit-notes/:id/void` → `credit_note.void`
- `POST /admin/returns/:id/settlement/retry` → `return.settlement.retry`
- `POST /admin/returns/:id/reconcile` → `return.settlement.reconcile`

Every one of these is RBAC-gated as shown above; none is reachable by an
unauthenticated or under-privileged actor. No "force complete" endpoint
exists for any state machine — verified by re-checking the full route
list against the boot log (§ of the architecture companion doc) — every
mutation is a real, row-locked, state-machine-validated transition or a
call into the same idempotent method the automatic sweep already uses.

## Audit logging

Every mutating action in the merged `return` module writes a real
`system.AuditLog` entry (`RETURN_APPROVED`, `RETURN_REFUNDED`,
`CREDIT_NOTE_ISSUED`, `RETURN_SETTLEMENT_COMPLETED`, etc.) — unchanged
from CP-012/013's own implementation, not re-implemented or altered by
this merge.

## Idempotency-key abuse resistance

`Refund.idempotencyKey = return-refund__${returnRequestId}` and
`InventoryLedger.idempotencyKey = return-restock__${returnItemId}` are
real `@unique` database constraints (confirmed present in the fresh,
zero-drift-verified schema) — a retried or racing call can never produce
a duplicate refund or duplicate restock, regardless of how many times an
admin or the sweep retries it. `CreditNote.returnRequestId` is likewise
a real, non-partial `@unique` constraint.

## Secrets / dependency scanning

`pnpm audit --audit-level high`: 1 low finding, below the gate threshold
— same pre-existing, previously-triaged finding present before this
merge, no new vulnerability introduced by CP-012/013/014's dependencies
(none of the three added a new runtime dependency; CP-014 added no
dependency at all, pure `docs/`+one plain Node script with zero external
imports beyond Node's own `node:child_process`/`node:fs`/`node:path`/
`node:url`).

## Injection / mass-assignment / privilege-escalation review

No raw SQL string interpolation with user input found in the merged
`return` module (every query goes through Prisma's parameterized query
builder — grepped for `$queryRawUnsafe`/`$executeRawUnsafe`, zero hits).
Every DTO uses the service's global whitelist + `forbidNonWhitelisted`
`ValidationPipe` — no mass-assignment surface. No privilege-escalation
path found: role/permission grants are seed-time/admin-API operations
gated by their own `identity.*` permissions, untouched by this merge.

## Conclusion

No security regression introduced by this integration. The RBAC matrix
for the merged `return` module is internally consistent and correctly
scoped. All findings from the CP-014 audit that remain open (rate
limiting, pentest/threat-model pass, KMS rotation) are unchanged by this
phase — they were not in scope, and this phase introduced nothing that
makes any of them more urgent than the CP-014 audit already assessed.
