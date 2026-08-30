# Environment-configuration management (CP-029)

Closes O5 of `docs/operations/production-readiness-gap-analysis.md`:
"No environment-separation documentation beyond `main`/`develop` branch
strategy." `ci-pipeline.md` covers the git branch strategy well; this
document covers what that one explicitly didn't — how per-environment
runtime configuration (secrets, `DATABASE_URL`, `REDIS_URL`, and every
other env var each service's own `config/env.ts` declares) should
actually be managed once real environments beyond this sandbox and CI's
ephemeral containers exist.

This is a documentation-only deliverable: no environment beyond `local`
is provisioned anywhere (see `docs/deployment/README.md`), so there is no
live secret store or CD pipeline to configure. What follows is the plan a
real deployment should follow, written against this repository's actual
config surface — not invented from scratch.

## The four environments (target)

```
local → development → staging → production
```

Only `local` exists today (`infrastructure/docker/docker-compose.yml` +
each service's own `.env`). No direct `local → production` connection,
ever (blueprint §108) — this applies to database URLs specifically, and
by extension to every credential a real environment holds.

## What every environment needs configured, per service

Every service validates its own environment at startup via Zod
(`config/env.ts`, `loadEnv()` — "fails fast on startup if any required
env var is missing/invalid," per `services/api/src/config/env.ts`'s own
comment). That schema **is** the authoritative list of what a real
environment must set — not a separately-maintained document that can
drift from the code. Rather than duplicate that list here (and have it go
stale the next time a phase adds an env var), this document points at it:

| Service                        | Schema                                           | What's genuinely secret                                                                                                          |
| ------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `services/api`                 | `services/api/src/config/env.ts`                 | `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` (+ rotation slots), `PAYMENT_ZARINPAL_MERCHANT_ID`, `REDIS_URL` if auth-protected |
| `services/worker`              | `services/worker/src/config/env.ts`              | `DATABASE_URL`, `REDIS_URL` if auth-protected                                                                                    |
| `services/notification-worker` | `services/notification-worker/src/config/env.ts` | `SMS_API_KEY`, `TELEGRAM_BOT_TOKEN`, `WHATSAPP_API_KEY`, `REDIS_URL` if auth-protected                                           |
| `services/scheduler`           | `services/scheduler/src/config/env.ts`           | `DATABASE_URL`, `REDIS_URL` if auth-protected                                                                                    |

Non-secret configuration (ports, CORS origins, TTLs, retention windows)
is not sensitive and can be plain environment variables or a config
service's non-secret store, per environment.

## The rule this document exists to state explicitly

**Never share a secret value across environments beyond `local`.**
`JWT_SECRET`, `ENCRYPTION_KEY`, and every provider credential must be a
distinct, independently-generated value per environment (development,
staging, production). A leaked staging `JWT_SECRET` must never be able to
forge a production session token, and vice versa. The `.env.example`
files committed to this repository intentionally use non-secret,
publicly-documented sandbox values (e.g. ZarinPal's own published sandbox
merchant ID — see `env.ts`'s own comment) precisely so nothing that looks
like a real credential is ever present in git history to begin with.

## Recommended mechanism (not built — a real deployment's own choice)

This repository does not prescribe a specific secret-management product —
that is a real infrastructure decision belonging to whoever operates a
real deployment, the same category of decision `docs/operations/
incident-response.md` and `infrastructure/monitoring/README.md` both
already decline to make on a future operator's behalf. What it does
recommend, consistent with `ENCRYPTION_KEY`'s own versioned-rotation
design (`ADR-028`):

1. A real secret manager (cloud-provider-native, or HashiCorp Vault, or
   equivalent) injecting environment variables at container start —
   never committed to git, never baked into a container image layer.
2. CI/CD pipeline access to staging/production secrets scoped narrowly
   (deploy-time injection only, not available to arbitrary CI job steps
   that don't need them).
3. A documented rotation schedule per secret class, reusing
   `ENCRYPTION_KEY`'s existing versioned-rotation mechanism
   (`ENCRYPTION_KEY_V1`..`V3` + `ENCRYPTION_KEY_CURRENT_VERSION`) as the
   pattern for any future secret that needs the same "introduce a new
   value without breaking what the old one already produced" property.

## What this document does not cover

- **Provisioning the environments themselves** — no infra-as-code exists
  yet (`docs/deployment/README.md`'s own "Not set up yet" list).
- **The actual secret values for any real environment** — this
  repository holds none, by design.
- **CD pipeline configuration** — no CD exists yet (same list).
