#!/usr/bin/env node
/**
 * Repository structure validation (one of the three checks the Phase 001
 * foundation task requires — see the others in package.json: `pnpm typecheck`,
 * `pnpm build`).
 *
 * Verifies the required top-level layout exists: every apps/services/packages/
 * infrastructure/docs directory the foundation task specified, plus each
 * workspace's manifest + README. This is a structural check, not a build check —
 * it intentionally does not import/run anything, so it stays fast and has no
 * dependency on `pnpm install` having happened first.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {{ dir: string, manifest?: string, requireReadme?: boolean }[]} */
const workspaces = [
  { dir: 'apps/storefront', manifest: 'package.json' },
  { dir: 'apps/admin', manifest: 'package.json' },
  { dir: 'apps/pwa', manifest: 'package.json' },
  { dir: 'apps/mobile', manifest: 'pubspec.yaml' },
  { dir: 'services/api', manifest: 'package.json' },
  { dir: 'services/worker', manifest: 'package.json' },
  { dir: 'services/notification-worker', manifest: 'package.json' },
  { dir: 'services/scheduler', manifest: 'package.json' },
  { dir: 'packages/ui', manifest: 'package.json' },
  { dir: 'packages/database', manifest: 'package.json' },
  { dir: 'packages/types', manifest: 'package.json' },
  { dir: 'packages/validation', manifest: 'package.json' },
  { dir: 'packages/config', manifest: 'package.json' },
  { dir: 'packages/eslint-config', manifest: 'package.json' },
];

const infrastructureDirs = ['docker', 'nginx', 'postgres', 'redis', 'monitoring'].map(
  (name) => `infrastructure/${name}`,
);

const docDirs = ['architecture', 'database', 'api', 'security', 'deployment'].map(
  (name) => `docs/${name}`,
);

const rootFiles = [
  'README.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'CLAUDE.md',
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  '.gitignore',
  'docs/product/blueprint.md',
];

/** @type {string[]} */
const errors = [];

function checkExists(relativePath, label) {
  const fullPath = join(ROOT, relativePath);
  if (!existsSync(fullPath)) {
    errors.push(`missing ${label ?? 'path'}: ${relativePath}`);
    return false;
  }
  return true;
}

for (const file of rootFiles) {
  checkExists(file, 'root file');
}

for (const { dir, manifest } of workspaces) {
  const hasDir = checkExists(dir, 'workspace directory');
  if (!hasDir) continue;
  if (manifest) {
    checkExists(join(dir, manifest), 'workspace manifest');
  }
  checkExists(join(dir, 'README.md'), 'workspace README');
}

for (const dir of infrastructureDirs) {
  checkExists(dir, 'infrastructure directory');
}

for (const dir of docDirs) {
  checkExists(dir, 'docs directory');
}

if (errors.length > 0) {
  console.error(`✗ Repository structure validation failed (${errors.length} issue(s)):\n`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log(
  `✓ Repository structure validation passed — ${workspaces.length} workspaces, ` +
    `${infrastructureDirs.length} infrastructure dirs, ${docDirs.length} doc dirs, ` +
    `${rootFiles.length} root files all present.`,
);
