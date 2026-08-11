-- Least-privilege database roles (blueprint §55, Phase 003 security
-- requirement). Two roles, two purposes:
--
--   iecp_migrator — owns the schema, runs `prisma migrate`/`prisma db push`.
--                   Has CREATE/ALTER/DROP on every domain schema. Nothing at
--                   runtime uses this role — only migration/seed tooling.
--   iecp_app      — used by services/api and every other running service at
--                   runtime. SELECT/INSERT/UPDATE/DELETE only: no CREATE, no
--                   ALTER, no DROP, cannot grant privileges to anyone else.
--                   Compromising this role's credentials cannot be used to
--                   alter the schema or escalate privileges.
--
-- Local/self-hosted Postgres only for now — this repo has no managed cloud
-- DB yet (docs/deployment/README.md). The passwords below are LOCAL DEV
-- DEFAULTS ONLY. Never reuse them anywhere real — see docs/database/README.md
-- "Roles & least privilege" for what a real environment needs instead
-- (secrets manager, rotation, environment-specific values).

CREATE ROLE iecp_migrator WITH LOGIN PASSWORD 'change-me-migrator' CREATEDB;
CREATE ROLE iecp_app WITH LOGIN PASSWORD 'change-me-app';

GRANT ALL PRIVILEGES ON DATABASE iecp TO iecp_migrator;

-- Prisma's own migration-history table (`_prisma_migrations`) lives in
-- `public` by default, regardless of how many domain schemas the actual data
-- model uses — iecp_migrator needs to create it there. iecp_app never reads
-- or writes anything in `public` at runtime, but USAGE is harmless and
-- avoids a confusing failure if something ever does look there.
GRANT ALL ON SCHEMA public TO iecp_migrator;
GRANT USAGE ON SCHEMA public TO iecp_app;

DO $$
DECLARE
  schema_name text;
BEGIN
  FOREACH schema_name IN ARRAY ARRAY[
    'identity', 'customer', 'catalog', 'commerce', 'inventory',
    'marketing', 'cms', 'finance', 'notification', 'analytics', 'system'
  ]
  LOOP
    -- iecp_migrator: full DDL, needed to run migrations.
    EXECUTE format('GRANT ALL ON SCHEMA %I TO iecp_migrator', schema_name);

    -- iecp_app: usage + DML only on whatever tables/sequences already exist
    -- in each schema (none yet on first boot — harmless no-op then, real
    -- once migrations have run and this script is re-run or replayed).
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO iecp_app', schema_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO iecp_app', schema_name);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO iecp_app', schema_name);

    -- iecp_app on tables/sequences created LATER by a migration (which runs
    -- as iecp_migrator). Without this, iecp_app silently loses access to
    -- every new table a future migration adds, and someone has to remember
    -- to re-grant it by hand — exactly the kind of thing that stays broken
    -- in production until a 500 error finds it.
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE iecp_migrator IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO iecp_app', schema_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE iecp_migrator IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO iecp_app', schema_name);
  END LOOP;
END $$;
