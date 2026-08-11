# Didar — IECP (Iran Eyewear Commerce Platform)

Didar (دیدار, Persian for "meeting" or "encounter") is the working name for an
**Iranian Eyewear Commerce Platform**. [Lenskart](https://www.lenskart.com) is the
functional benchmark, not the spec: the goal is an enterprise-grade commerce
platform (catalog, CMS, CRM, inventory, POS, loyalty, marketing, AI, mobile, PWA,
notifications, analytics) tailored to the Iranian market — not a reskinned clone.

Three clients (Web/PWA, Android, iPhone-PWA), one shared backend, PostgreSQL as
the single source of truth for everything business- and content-related.

## Documentation

- **[`docs/product/blueprint.md`](docs/product/blueprint.md)** — the full product
  and architecture blueprint: scope, Lenskart benchmark comparison, architecture
  decisions, domain model, database design, phased build plan. Start here.
- **[`CLAUDE.md`](CLAUDE.md)** — condensed summary of the non-negotiable
  architecture rules and current project status, for quick orientation.

## Status

Just initialized. Product/architecture scope (Phase 0) is defined in the
blueprint; no code has been written yet. Next up is Phase 1 — the full
PostgreSQL ERD, migration/seed strategy, API contract, permission matrix, and
order state machine — before any UI or design-system work.

## Getting started

_TODO: add setup and run instructions once Phase 1 (backend/database
foundation) is scaffolded._

## License

See [LICENSE](./LICENSE).
