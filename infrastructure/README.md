# infrastructure

Everything needed to run the platform outside of application code.

| Directory     | What's in it                                                        | Status |
| -------------- | --------------------------------------------------------------------- | ------ |
| `docker/`      | `docker-compose.yml` (Postgres/Redis/OpenSearch for local dev), `Dockerfile.next` / `Dockerfile.nest` templates | compose file works; Dockerfiles not build-tested |
| `nginx/`       | Reverse proxy config (`/api`, `/admin`, storefront default)          | not deployed anywhere |
| `postgres/`    | DB init scripts (creates the 14 domain schemas)                      | works with docker-compose |
| `redis/`       | Redis config for local dev (AOF on, LRU eviction cap)                | works with docker-compose |
| `monitoring/`  | Prometheus scrape config stub                                        | stub — no service exposes `/metrics` yet |

Start here for local dev:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

See each subdirectory's own README for details and caveats.
