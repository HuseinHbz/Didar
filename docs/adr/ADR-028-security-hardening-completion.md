# ADR-028 — Security Hardening Completion

## 1. Problem

`docs/product/gap-priority-matrix.md` tracks three gaps with no other
canonical owner:

- **P1-7** — no penetration test / threat model / OWASP checklist pass
  has ever been performed against this codebase.
- **P2-6** — API keys are issuable and revocable
  (`services/api/src/modules/identity/application/api-keys/*`,
  `POST /me/api-keys`, since Phase 004), but nothing on an inbound
  request ever verified one — the feature was management-only.
- **P2-7** — `EncryptionService`'s `ENCRYPTION_KEY` is a single static
  env var with no rotation mechanism; a real deployment needs a way to
  introduce a new key without breaking every already-encrypted
  `TwoFactorCredential.secretEncrypted` row.

`canonical-roadmap.md`'s "one owner per capability" table assigns all
three, together, to `CP-028` — "Penetration testing/threat model/OWASP
pass/KMS rotation." This ADR scopes and records the decisions made
while closing exactly those three gaps, no more.

## 2. Scope discipline — what this phase does NOT touch

A repository-wide security audit surfaces far more than three items.
Every other finding below is real, already tracked elsewhere, and
deliberately **not** picked up here, to avoid the "expanding scope to
close every B finding" failure mode this phase's own instructions warn
against:

| Finding                                           | Canonical owner                                                   | Why not here                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| No general-purpose rate limiting (`P1-1`)         | `CP-017` or later (explicit deferral in `CP-016`'s own non-goals) | A different, already-assigned gap; `gap-priority-matrix.md` never assigns it to `CP-028`                      |
| No Security Center dashboards / anomaly detection | Unassigned (`P1-8`'s sibling gap)                                 | Real feature work, not a hardening pass over existing controls                                                |
| No container image scanning (Trivy or similar)    | Unassigned                                                        | Infrastructure/DevOps track, not this phase's `docs/security/README.md` "Not yet" list item this phase closes |
| Four-eyes / dual-approval workflows               | Not phase-owned                                                   | A product decision (blueprint §57-§58), not a security defect                                                 |
| OAuth/social login                                | Deliberately out of scope (`identity/README.md`)                  | A feature absence, not a vulnerability                                                                        |

## 3. P1-7 — threat model / OWASP pass

No real external penetration test is possible from this sandbox (no
outbound network egress to any scanning service, same class of
limitation ADR-008/ADR-014 already documented for ZarinPal/Kavenegar).
What this phase delivers instead, and what "OWASP checklist pass"
concretely means here: a structured, evidence-based walk through the
OWASP API Security Top 10 against the actual running application —
real HTTP requests against a real Postgres-backed instance, real
adversarial attempts (wrong-scope API keys, revoked keys, malformed
tokens, direct admin-route bypass attempts), not a document written
from memory. Full results: `docs/product/phase-028-audit.md`.

## 4. P2-6 — API-key authentication

**Decision: a key authenticates _as its owner_, narrowed by its own
`scopes`.**

Alternatives considered:

- **A separate machine-credential model** (an API key with no owning
  user, granted its own independent permission set) — rejected for this
  pass. `ApiKeyRecord.ownerId` is nullable at the schema level (a real
  future option), but every key ever created today
  (`CreateApiKeyUseCase`) is owner-bound — building a second,
  independent authorization model for a case the product doesn't
  produce yet would be exactly the "speculative protection" this
  phase's own instructions forbid. `JwtAuthGuard` rejects an
  owner-less key outright (401) rather than inventing behavior for it.
- **A key simply inherits 100% of its owner's RBAC permissions**,
  full stop — rejected as insufficiently defense-in-depth: a key is a
  bearer credential more likely to leak (embedded in a script,
  committed by accident, logged by a careless caller) than a
  short-lived JWT, so it should never be able to do more than it was
  explicitly scoped for, even though its owner could.

**What was actually built**: `JwtAuthGuard` now accepts `X-API-Key` as
an alternate credential to `Authorization: Bearer`. On success it
hashes the raw key (`ApiKeyGeneratorService.hash`, the exact function
`CreateApiKeyUseCase` already used to persist it — no new hashing
scheme), looks it up (`ApiKeyRepositoryPort.findByHash`, already
existed, never called from a guard before this pass), verifies
`isActive`, resolves `request.user` to the key's `ownerId`, and stamps
`request.user.apiKeyScopes` with the key's own `scopes`.
`AuthorizationGuard` then requires — on top of, never instead of, the
owner's real RBAC check — that a gated route's required
permission/module also appear in `apiKeyScopes`, whenever a request
authenticated via API key. An unscoped route (no `@RequirePermission`/
`@RequireModule`) is unaffected, matching the existing "authenticated
only" semantics for any caller. `touchLastUsed` (already on the
repository port, never called) now updates on every successful
API-key request.

## 5. P2-7 — key rotation

**Decision: a versioned keyring at the crypto layer, backed by env vars
today, KMS-pluggable later — not a live KMS integration in this pass.**

`EncryptionService`'s ciphertext format gained an optional leading
`version` segment: `"iv.authTag.ciphertext"` (legacy, version 0,
unchanged byte-for-byte when no rotation is configured — zero behavior
change for an environment that never rotates) becomes
`"version.iv.authTag.ciphertext"` once `ENCRYPTION_KEY_CURRENT_VERSION`
names a version other than 0. New env slots `ENCRYPTION_KEY_V1`
through `ENCRYPTION_KEY_V3` hold rotation keys; `ENCRYPTION_KEY` itself
is always version 0 and is never removed from the keyring, so every
ciphertext ever written — before or after any rotation — keeps
decrypting correctly. Rotating means: set the next unused
`ENCRYPTION_KEY_V{n}`, bump `ENCRYPTION_KEY_CURRENT_VERSION` to `{n}`;
only _new_ encryptions use the new key.

Explicitly **not** built in this pass, and why: a real KMS provider
(AWS KMS/GCP KMS/Vault) making an actual network call to fetch or wrap
a key is genuinely separate work this sandbox cannot verify live (no
outbound egress), the same honestly-documented gap class as
ZarinPal/Kavenegar. What _is_ real and delivered is the part that
doesn't depend on any live network path: the ciphertext format and
decrypt logic surviving a key change under it — the actual "rotation
story" a real KMS integration would need to slot into later. A
bulk re-encryption sweep (migrating every existing row from an old
version to the new one, so the old key can eventually be retired) is
also not built — the mechanism that would make such a sweep safe
(multi-version decrypt) is exactly what this pass delivers; the sweep
itself is a follow-up, not a blocker for calling key rotation
_possible_ today, which it was not before this pass.

## Consequences

- `docs/security/README.md`'s "Not yet" section loses two entries
  ("Using an API key to authenticate a request", "2FA secret key
  rotation/KMS" — the rotation _mechanism_ specifically; the KMS
  _provider_ line is retained, reworded to say what's actually still
  missing).
- No schema/migration change — both P2-6 and P2-7 use existing columns
  and env-driven configuration only.
- CP-028 does not, and cannot, resolve `P1-1` (rate limiting) — that
  remains explicitly open, owned elsewhere, unaffected by this phase.
- Human approval for CP-019's Q1–Q5 domain decisions is untouched by
  this ADR — a different phase, a different gate, no relationship to
  this one's scope.
