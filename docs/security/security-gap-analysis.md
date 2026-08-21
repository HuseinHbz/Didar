# Security gap analysis — Phase 014 audit

Companion to [`docs/roadmap/master-roadmap-audit.md`](../roadmap/master-roadmap-audit.md)
§8 and the existing [`docs/security/README.md`](README.md) (which this
audit found to be accurate and current — its own "Not yet" section was
independently re-verified, not just trusted).

## What is real, verified

- Global `JwtAuthGuard` + `AuthorizationGuard`, applied app-wide by
  default (routes opt **out** via `@Public()`, never opt in) — the safer
  of the two possible defaults, confirmed by reading the guard
  registration in `app.module.ts`.
- RBAC with role inheritance and per-user allow/deny overrides, **deny
  always wins** — confirmed in `permission-resolver.spec.ts`'s own test
  cases, not just documentation.
- TOTP 2FA, refresh-token rotation, mobile OTP + email/password login —
  all present in `modules/identity`, all e2e-tested (session expiration/
  rotation, full 2FA round trip, per that module's own README).
- Audit log written by every mutating module (identity read it first,
  catalog was the first to _write_ to it, every module since has
  followed).
- `helmet()`, CORS restricted to `CORS_ORIGIN`, whitelist +
  `forbidNonWhitelisted` global `ValidationPipe` — confirmed in
  `services/api/README.md`'s "Security baseline" and cross-checked against
  `main.ts`.
- CI's `security` job: `pnpm audit --audit-level high` (currently 1 low
  finding, below the gate threshold, verified passing in this session) and
  `gitleaks` secret scanning with full git history (`fetch-depth: 0`).
- Two CVE overrides in `pnpm-workspace.yaml` (`js-yaml`, `deepmerge-ts`)
  are dated, justified, and tied to the specific CI job that caught each —
  this is exactly how a dependency-vulnerability override should be
  documented.
- No SQL injection surface found — every query goes through Prisma's
  parameterized query builder; no raw SQL string interpolation with
  user input found anywhere in `services/api/src` (grepped for
  `$queryRawUnsafe`/`$executeRawUnsafe`, zero hits; `$queryRaw`/
  `$executeRaw` tagged-template usages, where present, are parameterized).

## Gaps

### S1 — No rate limiting (HIGH)

See risk register R3. No `ThrottlerModule` or equivalent anywhere in
`services/api/src`. OTP request/login endpoints are the highest-value
targets for this — SMS cost abuse and credential stuffing are both live
risks the moment this is internet-facing, and neither requires any other
gap on this list to be exploitable.

### S2 — No penetration test, threat model, or OWASP checklist pass on record (HIGH, before any public launch)

`docs/security/README.md`'s own "Not yet" section names this gap already
— this audit did not find evidence it has since been closed. Not urgent
while the platform has no reachable client, but must happen before any
phase that exposes a real customer-facing surface (see critical path
Gate 3).

### S3 — API keys can be issued/revoked but not used to authenticate a request (MEDIUM)

Confirmed via identity module's own documented scope: API-key _request_
authentication is explicitly listed as not yet built. Low risk today
(nothing depends on API-key auth existing), but a half-built credential
type is worth finishing or removing rather than leaving indefinitely
ambiguous.

### S4 — No KMS-backed key rotation (MEDIUM)

`ENCRYPTION_KEY` (AES-256-GCM, used for 2FA secret storage per identity's
own docs) is a static env var today, including the CI placeholder value
committed in `ci.yml` (explicitly labeled non-secret/CI-only, correctly).
Fine for the current stage; must be a real KMS-backed rotation story
before production secrets are real.

### S5 — No metrics/logging aggregation, meaning no security-relevant anomaly detection (MEDIUM, overlaps DevOps R6)

The audit log captures individual events but there is no aggregation layer
that could, e.g., alert on an unusual spike in failed logins or OTP
requests from one IP. This is the security-relevant edge of the broader
observability gap (see `production-readiness-gap-analysis.md`).

### S6 — Notification-channel stubs mean OTP delivery cannot be relied on for account-recovery security assumptions (MEDIUM, overlaps R4)

Any security property that assumes "the OTP actually reaches the user's
phone" is currently unverifiable end-to-end, because no SMS adapter makes
a real call. Not a vulnerability in the auth code itself (the _logic_ is
correct and tested), but the chain from "correct logic" to "actual secure
delivery" has a real, labeled gap in the middle.

## Explicitly not re-litigated here

Business-logic authorization coverage (every privileged endpoint checked
for RBAC, every ownership check verified) was independently confirmed
strong on a module-by-module basis by that module's own e2e security
suite (each phase's final report cites specific IDOR/enumeration/replay
test cases — Phase 010's promotion module explicitly tests "no enumeration
leakage" for invalid coupon codes, for example). This audit re-verified
the _pattern_ is consistent across modules rather than re-running each
suite; no inconsistency was found.
