# infrastructure/postgres

`init/` — scripts run once, automatically, the first time the `postgres`
container in `infrastructure/docker/docker-compose.yml` starts against an empty
data volume (standard `postgres` image behavior for anything mounted at
`/docker-entrypoint-initdb.d`). `01-schemas.sql` creates the 14 domain-based
schemas up front — see that file's header comment for why this is belt-and-braces
rather than strictly required.

Real backup/PITR/replica configuration (blueprint §101/§103: RPO < 1h, RTO < 4h to
start, tightening later) is not set up here yet — this directory currently covers
local dev bootstrapping only.
