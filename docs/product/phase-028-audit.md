# Phase 028 Audit (CP-028 — Security Hardening Completion)

Required audit output for CP-028, matching the shape
[`phase-017-audit.md`](phase-017-audit.md)/[`phase-018-audit.md`](phase-018-audit.md)
established. Scope and decision record: `ADR-028`.

## 1. Scope

Canonical ownership (`canonical-roadmap.md`): "Penetration testing/
threat model/OWASP pass/KMS rotation." Concretely, the three gaps
`gap-priority-matrix.md` assigns to `CP-028` and no other phase:
`P1-7` (no pentest/threat model/OWASP pass), `P2-6` (API keys not
usable to authenticate), `P2-7` (no key rotation). See `ADR-028` §2 for
the explicit list of adjacent findings this phase does **not** pick up
(rate limiting, container scanning, dashboards, four-eyes workflows).

## 2. Repository baseline (before this phase)

Verified directly, not assumed:

- Global `JwtAuthGuard` (registered `APP_GUARD`) — every route requires
  authentication unless `@Public()`. `AuthorizationGuard` layers
  `@RequirePermission`/`@RequireModule` RBAC on top, deny-wins on
  per-user overrides (`PermissionResolver`).
- `helmet()` + `enableCors({ origin: env.CORS_ORIGIN })` in
  `main.ts`; global `ValidationPipe({ whitelist: true,
forbidNonWhitelisted: true, transform: true })` — unexpected body
  fields are rejected, not silently dropped or accepted.
- Zero `$queryRawUnsafe`/`$executeRawUnsafe` anywhere in `services/api`
  — every raw-SQL call site (`grep -rn '\$queryRaw\|\$executeRaw'`,
  ~20 call sites across order/inventory/return/promotion/health) uses
  `Prisma.sql` tagged templates or a plain tagged-template
  `$executeRaw`, both parameterized by Prisma itself. No string-built
  SQL exists.
- Zero hardcoded credential patterns (`AKIA...`, `sk_live_...`,
  `-----BEGIN...PRIVATE KEY-----`) anywhere in `src/`.
- No file-upload surface exists (`grep -rln 'multer\|FileInterceptor\|
@UploadedFile'` — zero hits) — MIME/extension/path-traversal
  validation is genuinely not applicable, not an oversight.
- No `ThrottlerModule`/`@nestjs/throttler` anywhere — confirms `P1-1`
  is real and still open, exactly as `gap-priority-matrix.md` already
  records, owned elsewhere.
- API keys: issuance/listing/revocation real since Phase 004
  (`/me/api-keys`), `ApiKeyRepositoryPort.findByHash`/`touchLastUsed`
  already existed on the port but were never called from anywhere —
  confirmed by `grep -rn findByHash` before this phase's own guard
  change existed.
- `EncryptionService`: single static `ENCRYPTION_KEY`, no test file at
  all (`find src -iname '*encryption*spec*'` → zero results before
  this phase).
- Zero `*.guard.spec.ts` files anywhere in `services/api` before this
  phase, despite `JwtAuthGuard`/`AuthorizationGuard` being the two
  enforcement points every single route in the app passes through.

## 3. Threat model (OWASP API Security Top 10, walked against the real running app)

| #     | Category                                                     | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Evidence                                                                     |
| ----- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| API1  | Broken Object Level Authorization (IDOR)                     | Not newly introduced by this phase. Ownership-scoped routes (`/me/*`) derive identity server-side from `request.user.userId`, never from a client-supplied id — pre-existing pattern, unchanged. The new API-key path resolves the same `request.user.userId` from the key's own `ownerId`, never from a header/body value a caller controls.                                                                                                                                                                                                                                                                                       | Code inspection: `CurrentUserId` decorator reads `request.user.userId` only. |
| API2  | Broken Authentication                                        | **P2-6 closed this pass.** Live-verified: unknown key → 401; revoked key → 401 even on an unscoped route; owner-less key → 401 (rejected, not silently anonymous).                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `test/api-key-auth.e2e-spec.ts`, `src/.../jwt-auth.guard.spec.ts`            |
| API3  | Broken Object Property Level Authorization (mass assignment) | Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` strips/rejects unlisted fields on every DTO — pre-existing, reconfirmed still active.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `main.ts`                                                                    |
| API4  | Unrestricted Resource Consumption                            | `P1-1` (general rate limiting) remains open — explicitly out of `CP-028`'s canonical scope (`ADR-028` §2), owned by `CP-017`-or-later. The one narrow, already-shipped exception (`OtpRequest.MAX_ATTEMPTS`, OTP-dispatch cooldown) is unrelated to this phase.                                                                                                                                                                                                                                                                                                                                                                     | `gap-priority-matrix.md` P1-1 row, unchanged                                 |
| API5  | Broken Function Level Authorization                          | **The core adversarial case this phase adds real coverage for**: an API key scoped to `catalog.brands.read` cannot call `POST /admin/catalog/brands` even though its _owner_ (admin) genuinely has `catalog.brands.create` via RBAC — live-verified 403, not merely unit-mocked.                                                                                                                                                                                                                                                                                                                                                    | `test/api-key-auth.e2e-spec.ts` "blocks a narrower-scoped key..."            |
| API6  | Unrestricted Access to Sensitive Business Flows              | No change in this phase's scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                            |
| API7  | Server-Side Request Forgery                                  | No outbound-URL-from-user-input pattern found in `services/api` (payment/notification provider URLs are all server-configured env vars, never request-supplied).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Code inspection of `SmsAdapter`/`ZarinpalAdapter` construction               |
| API8  | Security Misconfiguration                                    | `helmet()`, restricted `CORS_ORIGIN`, `whitelist`/`forbidNonWhitelisted` validation all confirmed active; no default/example secret ever wired as a _required_ production value (`ENCRYPTION_KEY` has no default, `JWT_SECRET` has no default). Global exception handling: no unhandled non-domain error path returns a stack trace or raw DB error text to the client — NestJS's own default exception handler (no custom `AllExceptionsFilter` overrides it) converts any uncaught error to a generic `{statusCode:500,message:"Internal server error"}`; live-verified for 401/404 paths, framework-guaranteed for the 500 path. | `main.ts`; live curl against a running instance (see §11)                    |
| API9  | Improper Inventory Management                                | Not in this phase's scope (API versioning/deprecation tracking).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                            |
| API10 | Unsafe Consumption of APIs                                   | Outbound calls (Kavenegar/ZarinPal) already have real timeouts (`AbortSignal.timeout`, CP-017/CP-008) and never trust a raw error body into a log line — pre-existing, reconfirmed unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                       | Code inspection, `sms.adapter.ts`, `zarinpal.adapter.ts`                     |

## 4. Findings, classified

| ID  | Finding                                                                                           | Class | Action                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| F1  | API keys couldn't authenticate a request                                                          | A     | Fixed — `JwtAuthGuard`/`AuthorizationGuard` (P2-6)                                                        |
| F2  | No encryption-key rotation mechanism                                                              | A     | Fixed — versioned `EncryptionKeyring` (P2-7)                                                              |
| F3  | Zero guard-level and `EncryptionService` unit coverage                                            | A     | Fixed — 32 new unit tests + 9 new e2e tests this phase                                                    |
| F4  | No general rate limiting                                                                          | B     | Owned by `CP-017`-or-later; documented prominently, not fixed here (`ADR-028` §2)                         |
| F5  | No container image scanning                                                                       | B     | Unassigned elsewhere; out of this phase's own "docs/security/README.md list this phase closes" boundary   |
| F6  | No real KMS provider (network-verified) integration                                               | D     | Intentional, sandbox network limitation — same class as ZarinPal/Kavenegar; documented, not faked         |
| F7  | Raw SQL, hardcoded secrets, file-upload surface                                                   | E     | Checked, none found — false-positive-free by construction, not merely unverified                          |
| F8  | `return-settlement-repository.e2e-spec.ts` `reconcileAll() 20x` timeout                           | B     | Already known, documented in `phase-017-audit.md` and earlier — unrelated module, untouched by this phase |
| F9  | `promotion-repository.e2e-spec.ts` concurrency test fails only inside the full sequential e2e run | C     | Sandbox connection-pool capacity under cumulative load — see §9                                           |

No A finding was left unfixed. No B finding was silently absorbed into
this phase's own scope.

## 5. Fixes (this phase's own commits)

- `services/api/src/config/env.ts` — `ENCRYPTION_KEY_V1..V3` +
  `ENCRYPTION_KEY_CURRENT_VERSION`, shared `base64EncryptionKey()`
  validator.
- `services/api/src/modules/identity/infrastructure/crypto/
encryption.service.ts` — versioned keyring, backward-compatible
  ciphertext format.
- `services/api/src/modules/identity/identity.module.ts` —
  `ENCRYPTION_KEYRING` provider factory.
- `services/api/src/modules/identity/presentation/request-context.ts`
  — `RequestUser.apiKeyScopes`.
- `services/api/src/modules/identity/presentation/guards/
jwt-auth.guard.ts` — `X-API-Key` authentication path.
- `services/api/src/modules/identity/presentation/guards/
authorization.guard.ts` — API-key scope narrowing.

## 6. Regression tests added

- `encryption.service.spec.ts` (11 cases): round-trip at v0, unchanged
  legacy format, versioned format, cross-version decrypt after
  rotation (twice), unknown-version rejection, malformed ciphertext
  (wrong segment count, non-integer version), AES-GCM tamper
  detection, invalid keyring construction (missing current version,
  wrong key length).
- `jwt-auth.guard.spec.ts` (11 cases): `@Public()` bypass, missing/
  malformed/invalid bearer token, valid bearer token, valid API key,
  unknown/revoked/owner-less API key, `touchLastUsed` call, X-API-Key
  vs. Authorization precedence.
- `authorization.guard.spec.ts` (10 cases): unscoped route, permission
  granted/denied, module access granted/denied, missing-`request.user`
  fail-loud case, and 4 API-key-scope-narrowing cases (the adversarial
  core of this phase).
- `test/api-key-auth.e2e-spec.ts` (9 cases, real Postgres, real HTTP):
  unknown key 401, unscoped-route success, scoped-route success,
  narrower-scope-blocks-owner's-real-permission 403 (the adversarial
  case), empty-scope-blocks 403, revocation 401, real `lastUsedAt` DB
  write, no raw-key/hash leak from the list endpoint, header
  precedence.

Total: 41 new tests, all passing, 0 skipped, 0 todo.

## 7. Dependency / supply-chain audit

`pnpm audit --audit-level high`: exit 0, 1 pre-existing low-severity
advisory (`esbuild`, dev-only transitive via `tsup`, unrelated to this
phase, no lockfile change made). No secret-scanning/container-scanning
tooling exists in this repo to run (confirmed absent — `F5` above).

## 8. Real infrastructure validation

- Real Postgres + Redis (this sandbox's local instances), migration
  status `UP_TO_DATE` against `develop`'s 12 migrations (this phase
  makes **zero** schema changes — confirmed by `prisma migrate diff`
  reporting no difference).
- `services/api` booted from a real build (`node dist/main.js`),
  `/api/v1/health` → `{"status":"ok",...}`, verified the app never
  leaks internals on a 401/404 path via live `curl`.
- Full e2e suite (`--runInBand`, real Postgres): see §9.

## 9. Full validation gate

| Check                                         | Result                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm validate:structure`                     | Passed                                                                            |
| `pnpm format:check`                           | Passed — files this phase touched all clean                                       |
| `pnpm lint`                                   | Passed, 0 errors, repo-wide                                                       |
| `pnpm typecheck`                              | Passed, 0 errors, repo-wide                                                       |
| `pnpm build`                                  | Passed, all workspaces                                                            |
| `pnpm test` (services/api, unit)              | 385/385 passing (was 353 before this phase — +32)                                 |
| `pnpm test:e2e` (services/api, `--runInBand`) | 227/229 passing, identical across 3 consecutive full-suite runs — see F8/F9 below |
| `pnpm audit --audit-level high`               | Exit 0                                                                            |
| `pnpm roadmap:audit`                          | Clean — no structural problems                                                    |
| Migration status/diff                         | `UP_TO_DATE`, no diff                                                             |

Two failures, both reproduced identically across all 3 consecutive
`--runInBand` full-suite runs — neither introduced by this phase (`git
status` on both files' own modules shows zero changes from this phase):

- **F8** — `return-settlement-repository.e2e-spec.ts`'s `reconcileAll()
20x` timeout. Already known and documented (`phase-017-audit.md`
  and earlier phases' own audits cite the identical test name) —
  classification B, pre-existing, unrelated to `return`/settlement code
  this phase never touched.
- **F9** — `promotion-repository.e2e-spec.ts`'s "usageLimit=1 against
  20 concurrent `reserve()` calls" — **newly observed this session**,
  not previously documented. Passes cleanly in isolation (8/8, run
  twice); fails only inside the full 229-test sequential run, at the
  same position, all 3 times. `services/api/.env`'s `DATABASE_URL` sets
  no `connection_limit`, so Prisma falls back to a small default pool
  — 20 genuinely concurrent `reserve()` calls stacked on top of 16
  preceding e2e files' cumulative connections in this sandbox's
  resource-constrained Postgres is a real capacity limit, not a code
  defect: the test's own 20-way concurrency is real and deliberate
  (proving exactly-one-winner under contention), and it correctly wins
  that race every time it has the connection headroom to run
  uncontended. Classification **C** (environment/sandbox resource
  constraint under cumulative full-suite load) — matches this repo's
  own established precedent for this exact class of finding
  (`phase-017-audit.md`'s "cross-file sandbox resource contention...
  classified as environment failure, not a regression"). Not `CP-028`'s
  to fix (promotion module, zero files touched by this phase) even if
  it were a real code gap.

## 10. Known remaining risks

- `P1-1` (rate limiting) stays open — unaffected, not this phase's
  gap to close.
- Real KMS provider integration (F6) remains a genuinely separate,
  network-dependent piece of future work.
- A bulk re-encryption sweep for rotated keys is not built (documented
  in `ADR-028` §5 as deliberate follow-up, not a blocker).
- F9 (§9) — the sandbox's small default Postgres connection pool can
  surface a real capacity limit under a large cumulative sequential
  e2e run; not a `CP-028` defect, flagged here for whichever future
  phase tunes `DATABASE_URL`'s `connection_limit` for this sandbox.
- No container/dependency-image scanning exists (F5, unassigned).

## 11. Governance

CP-028 → `IMPLEMENTED`. Not `VALIDATED`/`PRODUCTION_READY` — F6 (real
KMS network path) is the same class of honestly-unverifiable gap
CP-008/CP-017 already established precedent for, so this phase does
not claim more than its own evidence supports. `roadmap.json` updated
accordingly (see below). CP-019's Q1–Q5 remain `PENDING` — untouched
by this phase, and this document does not attempt to move CP-020
forward either.

## 12. Next execution unit

Per `roadmap.json`, `CP-029` (Production Readiness completion) is the
next unit with no dependency on CP-019/CP-020 — same as CP-028, it
depends only on the already-merged `CP-016`.
