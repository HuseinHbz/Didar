# modules/identity

Reference implementation of the clean-architecture layering every domain module in
`services/api` should follow (blueprint §3):

```
identity/
├── domain/
│   ├── entities/     — plain TS classes, no framework/Prisma deps.
│   ├── ports/         — repository interfaces (+ DI tokens) the domain/application
│   │                    layers depend on instead of Prisma directly.
│   └── services/      — pure business logic with no I/O (PermissionResolver).
├── application/
│   ├── auth/           — OTP, password login, refresh rotation, logout, the
│   │                     shared "finish logging someone in" tail (CompleteLoginService).
│   ├── two-factor/     — setup/enable/disable/verify, + a shared code-checking helper.
│   ├── sessions/, devices/ — list/revoke, ownership-checked.
│   ├── rbac/           — roles, permissions, overrides, effective-permission resolution.
│   ├── api-keys/       — issue/list/revoke.
│   ├── audit-log/      — paginated read.
│   └── users/          — the original GET /users/:id use case.
├── infrastructure/
│   ├── crypto/         — JWT signing/verification, argon2, TOTP, AES-256-GCM,
│   │                     API-key/OTP generation+hashing. The only place besides
│   │                     `repositories/` allowed real crypto/library dependencies.
│   └── repositories/   — one Prisma-backed implementation per port.
└── presentation/
    ├── controllers/, dto/, decorators/, guards/, interceptors/
    └── identity.module.ts — wires every port token to its Prisma implementation,
        registers the two global guards, provides identity.config.ts's IdentityConfig
        from env.
```

Dependency direction is one-way: `presentation → application → domain ← infrastructure`.
`domain` depends on nothing else in this module — verified directly, not just by
convention: `domain/services/permission-resolver.spec.ts` unit-tests the core RBAC
logic with zero DB, zero NestJS test module, zero mocks beyond plain data.

## What's actually implemented (Phase 004)

Every endpoint below is real — built, migrated against a real Postgres, and covered
by `test/identity.e2e-spec.ts` (17 tests: JWT validation, permission bypass including
role inheritance and a deny-override, session expiration/rotation, and a full
setup→enable→login 2FA round trip) plus a pure unit suite for the permission math.

### Authentication (blueprint §56)

| Method                      | Endpoints                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Mobile OTP (primary)        | `POST /auth/otp/request`, `POST /auth/otp/verify`                                                                |
| Email + password (optional) | `POST /auth/login`, `POST /auth/password` (set/change own)                                                       |
| Refresh (rotation)          | `POST /auth/refresh`                                                                                             |
| Logout                      | `POST /auth/logout` (one session), `POST /auth/logout-all` (everywhere)                                          |
| 2FA (TOTP)                  | `POST /auth/2fa/setup`, `/enable`, `/disable` (self-service), `POST /auth/2fa/verify` (completes a paused login) |

**Access tokens are JWTs; refresh tokens are not.** A refresh token is an opaque
32-byte random string, hashed (SHA-256) and stored in `identity.user_sessions` —
see `infrastructure/crypto/jwt-token.service.ts`'s header comment for the full
reasoning, but the short version: this is what makes "log out this one device"
an actual `DELETE`/revoke instead of requiring a JWT blacklist, and it's the
standard shape for refresh-token _rotation_ (blueprint's "JWT Rotation" bullet
— every `/auth/refresh` call revokes the presented token and issues a new one;
reusing a consumed refresh token fails, proven directly in the e2e suite).

**2FA login is a two-step dance.** `CompleteLoginService.afterPrimaryFactor`
checks whether the account has 2FA enabled; if so, it returns a
`two_factor_pending` JWT (5 min TTL, distinguishable from a real access token by
a `type` claim `JwtTokenService` checks on every verify — proven directly: a
`two_factor_pending` token presented as a Bearer token is rejected) instead of
real tokens. `POST /auth/2fa/verify` exchanges that pending token + a TOTP (or
recovery) code for the real ones.

**OTP codes never go out over SMS in this pass.** `services/notification-worker`
is still stub adapters (see that service's README) — there's no real SMS
provider wired up yet. `RequestOtpUseCase` always computes the code and returns
it internally; the _controller_ only puts it on the HTTP response
(`devOnlyCode`) when `IdentityConfig.exposeOtpCodeForTesting` is true (anything
but `NODE_ENV=production`). This is what lets e2e tests and local dev complete
a real login without a real SMS provider, without the use case itself ever
pretending a message was delivered.

### Authorization — RBAC (blueprint §53)

- **Roles form a tree** (`Role.parentId`, self-referencing). A role's effective
  permissions are its own `RolePermission` grants unioned with every ancestor's —
  computed on each request (`RoleRepositoryPort.getEffectiveRoleIds` walks the
  chain, `PermissionResolver.resolve` combines the result), not cached, not
  baked into the JWT. Verified directly, not just by role-name-implies-inherits
  convention: the e2e suite's admin user has **no direct grant** of
  `identity.users.view_contact` — only its parent `support_agent` does — and
  the field-permission test still passes for admin.
- **Permissions are `module.action`** (`Permission.module`/`.action`/`.key`) —
  `GET /permissions` is the blueprint's "permission matrix," a flat registry an
  admin UI can group by module without parsing `key` strings.
- **Module access control**: `@RequireModule('identity')` grants a route to
  anyone holding _any_ permission in that module, regardless of action —
  coarser than `@RequirePermission`, used where a route just needs "is this
  caller in Identity's admin surface at all" (e.g. `GET /roles`).
- **Per-user overrides** (`UserPermissionOverride`, blueprint §53's
  "Product.Publish = NO" example) — `ALLOW` grants something no role does,
  `DENY` removes something a role does grant. **DENY always wins**, proven at
  two levels: a pure unit test (`PermissionResolver.resolve`'s "DENY always
  wins over ALLOW... deny-wins, not last-write-wins" case) and an e2e test
  where the seed's support user has the `support_agent` role (which grants
  `identity.users.view_contact`) _and_ an explicit DENY override on that exact
  permission — and ends up with no access to the gated fields.
- **Field-level permission** — `@FieldPermissions([{ field, permissionKey }])`
  - `FieldPermissionInterceptor` strip specific response fields (not the whole
    response) from callers who lack the permission. The one concrete case this
    ships with: `GET /users/:id`'s `phone`/`email`, gated on
    `identity.users.view_contact` — a caller without it still gets a 200 with
    `id`/`createdAt`, just missing those two fields (a field-level gate isn't a
    403; the user's _existence_ isn't what's being protected). Deliberately
    shallow (top-level DTO properties only, no nested paths) — see the
    interceptor's own doc for why a fully generalized version is real,
    open-ended scope of its own, not built speculatively here.

### Sessions, devices, API keys, audit (blueprint §54/§55/§56)

- `GET /me/sessions`, `DELETE /me/sessions/:id` — always the caller's own;
  ownership is checked in the use case (`RevokeSessionUseCase`), not trusted
  from the URL, and a session belonging to someone else 404s the same as one
  that doesn't exist (no enumeration).
- `GET /me/devices`, `POST /me/devices/:id/trust`, `DELETE /me/devices/:id` —
  same ownership discipline. Revoking a device also revokes every session tied
  to it.
- `GET|POST /me/api-keys`, `DELETE /me/api-keys/:id` — issuance only shows the
  raw key once; only its SHA-256 hash is ever persisted
  (`ApiKeyGeneratorService`). **Using** an API key to authenticate a request is
  out of scope — see below.
- `GET /audit-log` — paginated (cursor-based), gated behind
  `identity.audit_logs.view`. `system.AuditLog` (blueprint §54) is the general
  "who changed what" record for any domain, not identity-specific;
  `identity.SecurityEvent` (blueprint §5/§55 `user_security_events`) is the
  narrower, fixed-`type` sibling for login/2FA/session events specifically —
  both get written by the use cases above, neither has a dedicated write API
  (they're append-only side effects, not user-facing resources).

## Deliberately out of scope for this pass

- **OAuth/social login** (blueprint §56's "Google/Apple where applicable") —
  Phase 004's `authentication.methods` spec didn't ask for it. Adding it later
  is additive (a new `oauth_accounts` table + provider adapters), not a
  redesign of anything here.
- **Using an API key to authenticate a request** — nothing in this codebase
  yet needs service-to-service auth, so building that verification path (an
  `ApiKeyAuthGuard` alongside `JwtAuthGuard`) now would be speculative.
  Issuance/management is real; consumption isn't wired.
- **Admin-scoped "manage anyone's sessions/API keys"** — every session/device/
  API-key endpoint is self-service (`/me/...`) only. A support-tooling
  equivalent (an admin revoking _another_ user's session) doesn't exist yet;
  build it once there's a real support workflow that needs it, with its own
  permission (`identity.sessions.manage_any` was sketched during design but
  never wired to an endpoint — not seeded, since seeding a permission nothing
  checks would be exactly the kind of fabricated rigor this repo avoids).
- **Fully generalized field-level permissions** — see
  `FieldPermissionInterceptor`'s own doc. What ships: the reusable mechanism +
  one real, enforced, tested case.
- **`user_credentials` as its own table** (blueprint §5) — `passwordHash` stays
  directly on `User` (Phase 003's choice, kept). One user, one password, no
  per-credential metadata that would justify the extra join yet.
- **Security Center dashboards** (blueprint §55's "Login Attempts / IP Rules /
  Rate Limits / Suspicious Activity") — `SecurityEvent` rows are written for
  every relevant action, which is the _data_ those dashboards would read; the
  dashboards, rate-limiting middleware, and anomaly detection themselves don't
  exist. `OtpRequest.MAX_ATTEMPTS` (5) is the one rate-limit-shaped guard that
  does exist, and it's local to OTP verification, not a general mechanism.

## Testing

```bash
pnpm --filter @iecp/api test        # unit — no DB required
pnpm --filter @iecp/api test:e2e    # e2e — requires a migrated + seeded DATABASE_URL
```

`domain/services/permission-resolver.spec.ts` is the fast, DB-free proof of the
RBAC combination rules. `test/identity.e2e-spec.ts` is the full-stack proof
against a real Postgres, logging in as the seed's actual fixture users
(`packages/database/prisma/seed.ts` — admin/support_agent/customer roles, the
deny-override) via the real OTP flow rather than fabricating tokens.

### Why `test/mocks/otplib.cjs` exists

`otplib`'s TOTP plugins (`@otplib/plugin-base32-scure`,
`@otplib/plugin-crypto-noble`) transitively depend on `@scure/base` and
`@noble/hashes`, both pure ESM with no CommonJS build. Node 22's `require()`
can load synchronous ESM directly — which is why the real app (`nest build` +
`node dist/main.js`) works fine — but Jest's own CommonJS module loader can't,
and fails parsing those packages outright. `test/jest-e2e.json`'s
`moduleNameMapper` redirects `otplib` to a hand-written stand-in that delegates
to the real, dependency-free `@otplib/core`/`@otplib/totp`/`@otplib/uri` and
only swaps the two ESM-blocked plugins for equivalents built on Node's native
`crypto` — not a fake, verified against the official RFC 6238 Appendix B test
vector before being trusted. See that file's header for the full detail. This
changes nothing about production; only Jest reads it.

## Config

See `services/api/.env.example` and `src/config/env.ts`:
`JWT_ACCESS_TTL_SECONDS` (900), `JWT_REFRESH_TTL_SECONDS` (2,592,000 = 30d),
`OTP_TTL_SECONDS` (300), `ENCRYPTION_KEY` (base64, must decode to exactly 32
bytes — AES-256-GCM key for `TwoFactorCredential.secretEncrypted`, no key
rotation/versioning/KMS yet — a real environment needs that before handling
real user 2FA secrets).
