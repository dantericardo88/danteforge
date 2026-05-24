#!/usr/bin/env node
// recency-check-fixture-setup.mjs — Three Pillars P3 capability_test fixture.
//
// Builds a tmp project at .danteforge/capability-tests/fixtures/recency-check/
// with two dimensions:
//   - dim_fresh: capability_callsite imported by a file that matches an entry-point
//     pattern AND was committed within thresholdDays
//   - dim_stale: capability_callsite imported by a file that does NOT match an
//     entry-point pattern → fails the two-hop trace check
//
// The fixture initializes git so the recency-check engine can read commit dates.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const FIXTURE_DIR = path.join(ROOT, '.danteforge', 'capability-tests', 'fixtures', 'recency-check');

async function rmrf(p) {
  try { await fs.rm(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeFile(p, content) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, content, 'utf8');
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

await rmrf(FIXTURE_DIR);
await ensureDir(FIXTURE_DIR);

// Fresh-and-traceable: importer matches src/cli/**/*.ts entry-point pattern.
await writeFile(path.join(FIXTURE_DIR, 'src', 'core', 'fresh-module.ts'), `
export function freshCapability(): string {
  return 'fresh';
}
`);
await writeFile(path.join(FIXTURE_DIR, 'src', 'cli', 'commands', 'uses-fresh.ts'), `
import { freshCapability } from '../../core/fresh-module.js';
export const result = freshCapability();
`);

// Stale: importer is in src/internal/ which is NOT an entry-point pattern.
await writeFile(path.join(FIXTURE_DIR, 'src', 'core', 'stale-module.ts'), `
export function staleCapability(): string {
  return 'stale';
}
`);
await writeFile(path.join(FIXTURE_DIR, 'src', 'internal', 'wrapper.ts'), `
import { staleCapability } from '../core/stale-module.js';
export const result = staleCapability();
`);

await writeFile(path.join(FIXTURE_DIR, 'package.json'), JSON.stringify({
  name: 'recency-check-fixture', version: '0.0.0', type: 'module',
}, null, 2));

await writeFile(path.join(FIXTURE_DIR, '.gitignore'), '.danteforge/\nnode_modules/\n');

// Init git so the recency check can read commit dates.
try {
  git(['init', '--initial-branch=main'], FIXTURE_DIR);
  git(['config', 'user.email', 'fixture@test'], FIXTURE_DIR);
  git(['config', 'user.name', 'Fixture'], FIXTURE_DIR);
  git(['add', '.'], FIXTURE_DIR);
  git(['commit', '-m', 'fixture: initial commit', '--no-gpg-sign'], FIXTURE_DIR);
} catch (err) {
  process.stderr.write(`git init failed: ${err.message ?? err}\n`);
  process.exit(1);
}

const matrix = {
  project: 'recency-check-fixture',
  competitors: [],
  competitors_closed_source: [],
  competitors_oss: [],
  lastUpdated: new Date().toISOString(),
  overallSelfScore: 7.5,
  dimensions: [
    {
      id: 'dim_fresh', label: 'Fresh Dim', weight: 1.0, category: 'core',
      scores: { self: 7.5 },
      capability_callsite: { file: 'src/core/fresh-module.ts', symbol: 'freshCapability' },
    },
    {
      id: 'dim_stale', label: 'Stale Dim', weight: 1.0, category: 'core',
      scores: { self: 7.5 },
      capability_callsite: { file: 'src/core/stale-module.ts', symbol: 'staleCapability' },
    },
  ],
};
await writeFile(path.join(FIXTURE_DIR, '.danteforge', 'compete', 'matrix.json'), JSON.stringify(matrix, null, 2));

process.stdout.write(`PASS: fixture built at ${FIXTURE_DIR}\n`);
