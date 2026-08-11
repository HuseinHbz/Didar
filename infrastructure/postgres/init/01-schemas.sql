-- Creates the domain-based PostgreSQL schemas (blueprint §4/§57) up front, on
-- first container boot. Redundant-but-harmless with Prisma's own migrations:
-- Prisma's migration engine also emits `CREATE SCHEMA IF NOT EXISTS` for any
-- schema referenced by `@@schema(...)` in packages/database/prisma/schema.prisma,
-- so this file mostly exists so the schemas already exist for anyone poking at
-- the database with `psql` before ever running a migration.

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS customer;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS commerce;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS procurement;
CREATE SCHEMA IF NOT EXISTS retail;
CREATE SCHEMA IF NOT EXISTS crm;
CREATE SCHEMA IF NOT EXISTS marketing;
CREATE SCHEMA IF NOT EXISTS cms;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS communication;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS system;
