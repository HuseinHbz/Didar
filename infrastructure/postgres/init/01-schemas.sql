-- Creates the domain-based PostgreSQL schemas (blueprint §4/§57, Phase 003
-- spec) up front, on first container boot. Redundant-but-harmless with
-- Prisma's own migrations: Prisma's migration engine also emits
-- `CREATE SCHEMA IF NOT EXISTS` for any schema referenced by `@@schema(...)`
-- in packages/database/prisma/schema.prisma, so this file mostly exists so
-- the schemas already exist for anyone poking at the database with `psql`
-- before ever running a migration — and so 02-roles.sql (which runs right
-- after this one) has something to GRANT USAGE on.

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS customer;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS commerce;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS marketing;
CREATE SCHEMA IF NOT EXISTS cms;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS notification;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS system;
