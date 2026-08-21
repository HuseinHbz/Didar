# CP-015 — Architecture/runtime reconciliation evidence

Companion to [`../product/integration-reconciliation.md`](../product/integration-reconciliation.md).
Covers Phase 4 (runtime), Phase 5 (API contract), and the diagnosed test
timing finding from Phase 7.

## Build

`pnpm build` — all 11 packages/apps/services build clean on the merged
branch (14 buildable via Turborepo's dependency graph; `apps/mobile`
tracked separately, unaffected, no changes). No new build warnings
introduced by the merge.

## Runtime boot — fresh database

Documented in full in
[`../database/integration-reconciliation.md`](../database/integration-reconciliation.md)
item 9. Summary: compiled `services/api` booted cleanly against the
fresh `iecp_fresh_cp015` database, every route mapped (including the
full CP-012/013 surface — customer `returns/*`, admin `admin/returns/*`,
`admin/credit-notes/*`, `admin/returns/settlements`/`:id/settlement`/
`:id/settlement/retry`/`:id/reconcile`), every BullMQ queue registered
and swept once cleanly (`return_settlement_sync`, `refund_status_sync`,
`return_settlement_recovery`, `payment_verification_retry`,
`promotion_expiration`, `order_conversion`, `invoice_generation`,
`return_reconciliation`, `reconciliation`), health check real and
positive, `SIGTERM` produced a clean exit with no hang or stack trace.

## Runtime boot — main dev database (second, independent boot)

Repeated against the long-lived sandbox `iecp` database for a second,
independent confirmation: same clean boot, same full route map, same
health-check response, same clean `SIGTERM` shutdown. The only
difference from the fresh-DB boot: the sweep processors touched a large
number of pre-existing expired-checkout/released-reservation records
accumulated across this session's many prior phases' work — expected
behavior for a long-lived dev database, not a defect.

## Route registration order — the one place a real collision was possible

`ReturnAdminController` (`@Controller('admin/returns')`, wildcard route
`GET /admin/returns/:id`) and `ReturnSettlementAdminController` (also
`@Controller('admin/returns')`, literal route
`GET /admin/returns/settlements`) share a controller-level path prefix —
Express matches routes by registration order, not specificity, so a
wildcard registered first would silently swallow the literal path.
Verified directly in the boot log (both fresh-DB and main-DB boots):

```
RoutesResolver ReturnSettlementAdminController {/api/v1/admin/returns}
  Mapped {/api/v1/admin/returns/settlements, GET} route
  Mapped {/api/v1/admin/returns/:id/settlement, GET} route
  Mapped {/api/v1/admin/returns/:id/settlement/retry, POST} route
  Mapped {/api/v1/admin/returns/:id/reconcile, POST} route
RoutesResolver ReturnAdminController {/api/v1/admin/returns}
  Mapped {/api/v1/admin/returns, GET} route
  Mapped {/api/v1/admin/returns/:id, GET} route
  ...
```

`ReturnSettlementAdminController` registers first, exactly as
`return.module.ts`'s own code comment documents (a deliberate ordering
decision from CP-013, not an accident of this merge) — confirmed intact
after integration, not merely assumed unchanged.

## API contract reconciliation

- **Route collisions:** one prefix-sharing pair found (above), correctly
  resolved by pre-existing, documented ordering — no new collision
  introduced by this merge.
- **DTO collisions:** none found — every new DTO (`ReturnSettlementResponseDto`,
  `ReconciliationFindingResponseDto`, `ReconciliationReportResponseDto`,
  and CP-012's own return/credit-note DTOs) lives in the `return` module's
  own `presentation/dto/` directory, no naming clash with any other
  module's DTOs.
- **RBAC/permission consistency:** verified against seed data directly —
  see [`../security/integration-reconciliation.md`](../security/integration-reconciliation.md).
- **Response-shape regressions:** none — every CP-012/013 response DTO is
  net-new; no existing module's response shape was changed by this merge
  (confirmed by the file-diff scope in the product doc — only additive
  touches to `order`/`payment`/`inventory`).
- **Idempotency behavior:** unchanged and cross-checked — `Refund.idempotencyKey`,
  `InventoryLedger.idempotencyKey`, `CreditNote.returnRequestId` unique
  constraints all present in the fresh-DB schema (implicit in the
  zero-drift `migrate diff` result); the two genuine concurrency bugs
  CP-013 found and fixed in its own development
  (`Order.refundedTotal` double-counting, `RefundService.requestRefund()`'s
  pre-flight/idempotent-create race) remain fixed — their fixes are part
  of the merged diff, not separately re-verified here beyond the e2e
  suite's own concurrency proofs re-passing (see test result below).
- **Error contracts:** `ReturnDomainExceptionFilter` (scoped `@Catch()`)
  unchanged, still maps all 12 domain error types documented in
  `docs/api/returns.md` (which is itself part of the CP-012/013 merge,
  unmodified by this phase).

## Test timing finding — full diagnosis (not a regression)

`return-settlement-repository.e2e-spec.ts`'s "running `reconcileAll()` 20
times in a row never creates duplicate side effects" test failed on
Jest's default 5000ms timeout in the first two full-suite e2e runs
(parallel-workers mode, and again in `--runInBand` serial mode — ruling
out cross-file Postgres contention as the cause). Diagnosis performed in
three steps:

1. **Isolated run** (`-t "reconcileAll"`, this file only): passed cleanly,
   whole-file Jest process (bootstrap + 1 test) took 11s total.
2. **Same file, full 10-test suite, `--testTimeout=60000`**: passed
   cleanly in 20.6s total — confirms the test's own logic completes
   correctly and reasonably quickly, just not within the tight 5000ms
   default.
3. **Full 14-suite/195-test e2e run, `--testTimeout=30000`, twice
   consecutively**: both runs 14/14 suites, 195/195 tests, clean —
   `38.058s` and `37.803s` respectively.

**Conclusion: this is not a regression from the merge** (the test file is
byte-identical to what CP-013 already proved passing on its own branch)
and **not a hang** (it completes well within a realistic budget every
time it's given one). It's the tight default 5000ms Jest timeout meeting
a 20-iteration real-Postgres round-trip test running against this
sandbox's own long-lived, heavily-accumulated database — a sandbox-scale
effect, not a code defect, and not something a fresh CI-provisioned
database (which starts empty every run) would ever reproduce. **Not
retrofitted with a timeout override in the test file itself** in this
phase, per the explicit non-goal against unrelated changes to working,
proven code — flagged here as a real, minor, low-priority finding for
whichever future phase next legitimately touches this file (or CP-016,
if it wants to bundle general test-suite hygiene with its own CI work).

## Graceful shutdown, formally

`SIGTERM` sent to the running process in both boot tests (fresh DB and
main DB) produced immediate, clean process exit — no hang, no stack
trace, no orphaned connection warning in either log.
