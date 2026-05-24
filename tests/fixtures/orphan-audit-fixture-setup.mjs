#!/usr/bin/env node
// orphan-audit-fixture-setup.mjs — Three Pillars P2 capability_test fixture.
//
// Builds a tmp project at .danteforge/capability-tests/fixtures/orphan-audit/
// with two dimensions:
//   - dim_real: capability_callsite imported from production code → PASS
//   - dim_orphan: capability_callsite imported only from a *.test.ts file → FAIL
//
// The capability_test script asserts the orphan-audit gate flags dim_orphan
// at cap 6.0 while letting dim_real through.

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const FIXTURE_DIR = path.join(ROOT, '.danteforge', 'capability-tests', 'fixtures', 'orphan-audit');

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

await rmrf(FIXTURE_DIR);
await ensureDir(FIXTURE_DIR);

// Production source: dim_real's symbol is imported here.
await writeFile(path.join(FIXTURE_DIR, 'src', 'core', 'real-module.ts'), `
export function realCapability(): string {
  return 'real';
}
`);
await writeFile(path.join(FIXTURE_DIR, 'src', 'cli', 'commands', 'uses-real.ts'), `
import { realCapability } from '../../core/real-module.js';
export const result = realCapability();
`);

// Orphan source: dim_orphan's symbol exists but is only used from a test.
await writeFile(path.join(FIXTURE_DIR, 'src', 'core', 'orphan-module.ts'), `
export function orphanCapability(): string {
  return 'orphan';
}
`);
await writeFile(path.join(FIXTURE_DIR, 'tests', 'orphan-module.test.ts'), `
import { orphanCapability } from '../src/core/orphan-module.js';
console.log(orphanCapability());
`);

// Matrix with both dims declaring their callsites.
const matrix = {
  project: 'orphan-audit-fixture',
  competitors: [],
  competitors_closed_source: [],
  competitors_oss: [],
  lastUpdated: new Date().toISOString(),
  overallSelfScore: 7.5,
  dimensions: [
    {
      id: 'dim_real', label: 'Real Dim', weight: 1.0, category: 'core',
      scores: { self: 7.5 },
      capability_callsite: { file: 'src/core/real-module.ts', symbol: 'realCapability' },
    },
    {
      id: 'dim_orphan', label: 'Orphan Dim', weight: 1.0, category: 'core',
      scores: { self: 7.5 },
      capability_callsite: { file: 'src/core/orphan-module.ts', symbol: 'orphanCapability' },
    },
  ],
};
await writeFile(path.join(FIXTURE_DIR, '.danteforge', 'compete', 'matrix.json'), JSON.stringify(matrix, null, 2));

// package.json so SearchEngine treats this as a TS project.
await writeFile(path.join(FIXTURE_DIR, 'package.json'), JSON.stringify({
  name: 'orphan-audit-fixture', version: '0.0.0', type: 'module',
}, null, 2));

process.stdout.write(`PASS: fixture built at ${FIXTURE_DIR}\n`);
