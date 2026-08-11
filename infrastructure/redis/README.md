# infrastructure/redis

`redis.conf` — local dev configuration for the `redis` service in
`infrastructure/docker/docker-compose.yml`. AOF persistence is enabled so a
container restart doesn't wipe the BullMQ queues you're debugging, but this is a
cache/queue store, not a database — see blueprint §126 ("Redis منبع اصلی
اطلاعات نیست") and root `CLAUDE.md`. Nothing here should ever be the only copy of
data that matters.
