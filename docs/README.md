# Documentation

| Doc | Covers |
| --- | ------ |
| [`product/blueprint.md`](product/blueprint.md) | The full product & architecture blueprint — start here for *why*, not just *what*. |
| [`architecture/README.md`](architecture/README.md) | System shape, monorepo tooling choices, backend module layering, open questions. |
| [`database/README.md`](database/README.md) | DB conventions, what's real vs. placeholder, what Phase 1 (the real ERD) still needs to answer. |
| [`api/README.md`](api/README.md) | REST conventions, error shape, idempotency, auth status, OpenAPI. |
| [`security/README.md`](security/README.md) | What security controls actually exist today vs. what's still open — read before adding a write endpoint. |
| [`deployment/README.md`](deployment/README.md) | Environments, containerization, CI, what's not set up yet. |

Root [`CLAUDE.md`](../CLAUDE.md) is the condensed version of all of this, meant to
auto-load as context for anyone (human or agent) picking up this repo.
