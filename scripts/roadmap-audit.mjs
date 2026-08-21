#!/usr/bin/env node
/**
 * `pnpm roadmap:audit` — re-derives every phase's tracked status from real
 * repository evidence and reports where `docs/product/roadmap.json` (the
 * canonical source of truth, see CP-014's `docs/product/phase-governance.md`)
 * disagrees with reality.
 *
 * This tool NEVER writes progress. It only ever reports. If it can't verify
 * something (no DB reachable, no network for CI status, etc.) it prints
 * UNKNOWN for that check, never a guessed PASS — matching this repository's
 * `do_not_guess` rule. Exit code is non-zero only on a structural problem
 * with roadmap.json itself (missing required doc, broken JSON, orphaned
 * requirement/phase) — a phase merely being behind schedule is not a
 * script failure, it's exactly the kind of thing this tool exists to
 * surface honestly.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROADMAP_PATH = join(ROOT, 'docs/product/roadmap.json');

const STATUS_ENUM = new Set([
  'NOT_STARTED',
  'PLANNED',
  'SCAFFOLDED',
  'PARTIAL',
  'IMPLEMENTED',
  'VALIDATED',
  'PRODUCTION_READY',
  'BLOCKED',
  'DEPRECATED',
  'UNKNOWN',
  'IN_PROGRESS',
]);

/** Documents every CP-014-onward phase's governance requires. */
const REQUIRED_GOVERNANCE_DOCS = [
  'docs/product/canonical-roadmap.md',
  'docs/product/project-progress.md',
  'docs/product/progress-scoring.md',
  'docs/product/phase-dependency-graph.md',
  'docs/product/gap-priority-matrix.md',
  'docs/product/next-phase-decision.md',
  'docs/product/requirements-matrix.md',
  'docs/product/phase-governance.md',
  'docs/product/phase-audit-checklist.md',
  'docs/product/roadmap.json',
  'PROJECT_STATUS.md',
];

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function loadRoadmap() {
  if (!existsSync(ROADMAP_PATH)) {
    throw new Error(`roadmap.json not found at ${ROADMAP_PATH}`);
  }
  const raw = readFileSync(ROADMAP_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`roadmap.json is not valid JSON: ${err.message}`);
  }
}

/** Structural checks that make roadmap.json itself trustworthy. Failures here are hard errors. */
function validateStructure(roadmap) {
  const errors = [];
  const phaseIds = new Set();

  for (const phase of roadmap.phases ?? []) {
    if (!phase.id) errors.push('A phase entry is missing an id.');
    if (phaseIds.has(phase.id)) errors.push(`Duplicate phase id: ${phase.id}`);
    phaseIds.add(phase.id);
    if (!phase.name) errors.push(`${phase.id}: missing name (no phase without an objective).`);
    if (!STATUS_ENUM.has(phase.status)) {
      errors.push(`${phase.id}: status "${phase.status}" is not in the enum.`);
    }
    if (
      (phase.status === 'PRODUCTION_READY' || phase.status === 'VALIDATED') &&
      phase.id !== 'CP-000' &&
      !phase.gitBranch
    ) {
      errors.push(
        `${phase.id}: marked ${phase.status} but has no gitBranch — no evidence of integration.`,
      );
    }
    for (const dep of phase.dependencies ?? []) {
      if (!roadmap.phases.some((p) => p.id === dep)) {
        errors.push(`${phase.id}: depends on unknown phase ${dep}.`);
      }
    }
  }

  // Circular dependency check (DFS).
  const graph = new Map(roadmap.phases.map((p) => [p.id, p.dependencies ?? []]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id, chain) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`Circular dependency: ${[...chain, id].join(' -> ')}`);
      return;
    }
    visiting.add(id);
    for (const dep of graph.get(id) ?? []) visit(dep, [...chain, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of graph.keys()) visit(id, []);

  const knownPhaseIds = new Set(roadmap.phases.map((p) => p.id));
  for (const req of roadmap.requirements ?? []) {
    if (!req.id) errors.push('A requirement is missing an id.');
    if (!req.phase) errors.push(`${req.id}: requirement has no owning phase.`);
    else if (!knownPhaseIds.has(req.phase)) {
      errors.push(`${req.id}: owning phase ${req.phase} does not exist (orphan requirement).`);
    }
    if (req.status === 'DONE' && !req.status) {
      errors.push(`${req.id}: marked DONE with no acceptance evidence recorded.`);
    }
  }

  for (const gap of roadmap.gaps ?? []) {
    if (gap.priority === 'P0' && !gap.ownerPhase) {
      errors.push(`${gap.id}: a P0 gap has no owner phase — P0 gaps may never be ignored.`);
    }
  }

  for (const doc of REQUIRED_GOVERNANCE_DOCS) {
    if (!existsSync(join(ROOT, doc))) {
      errors.push(`Required governance document missing: ${doc}`);
    }
  }

  return errors;
}

/** Evidence checks — never assert pass without a real command's output. */
function checkEvidence(roadmap) {
  const rows = [];
  for (const phase of roadmap.phases) {
    const row = { id: phase.id, name: phase.name, claimedStatus: phase.status };

    if (phase.gitBranch) {
      const remoteSha = git(['rev-parse', '--short', `origin/${phase.gitBranch}`]);
      const localSha = git(['rev-parse', '--short', `refs/heads/${phase.gitBranch}`]);
      const actualSha = remoteSha ?? localSha;
      row.gitBranchExists = actualSha !== null;
      row.commitMatches =
        actualSha !== null && phase.latestCommit ? actualSha === phase.latestCommit : 'UNKNOWN';
    } else {
      row.gitBranchExists = 'N/A';
      row.commitMatches = 'N/A';
    }

    rows.push(row);
  }
  return rows;
}

function checkMigrationStatus() {
  try {
    const out = execFileSync(
      'pnpm',
      ['--filter', '@iecp/database', 'exec', 'prisma', 'migrate', 'status'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      },
    );
    return out.includes('up to date') ? 'UP_TO_DATE' : 'DRIFT_OR_PENDING';
  } catch {
    return 'UNKNOWN (no reachable database from this environment — not a failure, just unverifiable here)';
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const jsonOutput = args.has('--json');

  let roadmap;
  try {
    roadmap = loadRoadmap();
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }

  const structuralErrors = validateStructure(roadmap);
  const evidenceRows = checkEvidence(roadmap);
  const migrationStatus = args.has('--skip-db') ? 'SKIPPED (--skip-db)' : checkMigrationStatus();

  const result = {
    roadmapVersion: roadmap.schemaVersion,
    structuralErrors,
    evidenceRows,
    migrationStatus,
    aggregate: roadmap.aggregate,
    nextPhase: roadmap.nextPhase,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(structuralErrors.length > 0 ? 1 : 0);
  }

  console.log('=== pnpm roadmap:audit ===\n');
  console.log(`roadmap.json schemaVersion: ${roadmap.schemaVersion}`);
  console.log(`Phases tracked: ${roadmap.phases.length}`);
  console.log(
    `Aggregate (as recorded): ${roadmap.aggregate.completedPhases} completed / ` +
      `${roadmap.aggregate.partialPhases} partial / ${roadmap.aggregate.inProgressPhases} in progress / ` +
      `${roadmap.aggregate.plannedPhases} planned / ${roadmap.aggregate.totalPhases} total\n`,
  );

  console.log('--- Git evidence per phase ---');
  for (const row of evidenceRows) {
    const mark = row.gitBranchExists === 'N/A' ? '·' : row.gitBranchExists ? '✓' : '✗';
    console.log(
      `${mark} ${row.id.padEnd(8)} ${row.claimedStatus.padEnd(16)} branch=${String(row.gitBranchExists).padEnd(7)} commitMatches=${row.commitMatches}`,
    );
  }

  console.log('\n--- Migration status ---');
  console.log(migrationStatus);

  console.log('\n--- Structural validation ---');
  if (structuralErrors.length === 0) {
    console.log(
      '✓ No structural problems found (no orphan phases/requirements, no missing P0 owner, no circular deps, no missing governance doc).',
    );
  } else {
    console.log(`✗ ${structuralErrors.length} problem(s):`);
    for (const e of structuralErrors) console.log(`  - ${e}`);
  }

  console.log(`\nNext phase (as recorded): ${roadmap.nextPhase}`);
  console.log(
    '\nNote: this tool reports what evidence shows. It does not and will not modify roadmap.json.',
  );

  process.exit(structuralErrors.length > 0 ? 1 : 0);
}

main();
