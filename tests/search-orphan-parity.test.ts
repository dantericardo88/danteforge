// search-orphan-parity.test.ts — Phase M.1 parity assertion.
//
// The orphan-audit harden check now has TWO code paths:
//   1. Legacy: inline fs.readdir + regex (preserved as `__test_legacyOrphanAudit`)
//   2. New: SearchEngine.findImports (called when an engine is injected)
//
// PRD M section invariant: zero behavioral divergence. This test runs both
// paths on the same dim fixtures and asserts identical findings.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { checkOrphanAudit } from '../src/matrix/engines/hardener.js';
import { createSearchEngine } from '../src/matrix/search/factory.js';
import type { MatrixDimension } from '../src/core/compete-matrix.js';

// ── Fixture ──────────────────────────────────────────────────────────────────

let fixtureDir = '';
const origCwd = process.cwd();

before(async () => {
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orphan-parity-'));
  const srcDir = path.join(fixtureDir, 'src');
  const cmdDir = path.join(srcDir, 'cli', 'commands');
  await fs.mkdir(cmdDir, { recursive: true });

  // Wired callsite: src/cli/commands/wired.ts exports doWired, imported by
  // src/cli/register.ts.
  await fs.writeFile(path.join(cmdDir, 'wired.ts'),
    `export function doWired(): string {\n` +
    `  return 'wired';\n` +
    `}\n`,
  );
  await fs.writeFile(path.join(srcDir, 'cli', 'register.ts'),
    `import { doWired } from './commands/wired.js';\n` +
    `export function register(): string {\n` +
    `  return doWired();\n` +
    `}\n`,
  );
  // Orphan callsite: src/cli/commands/orphan.ts exports doOrphan, NEVER imported.
  await fs.writeFile(path.join(cmdDir, 'orphan.ts'),
    `export function doOrphan(): string {\n` +
    `  return 'orphan';\n` +
    `}\n`,
  );
  process.chdir(fixtureDir);
});

after(async () => {
  process.chdir(origCwd);
  await fs.rm(fixtureDir, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDim(callsite: { file: string; symbol: string }): MatrixDimension {
  return {
    id: 'fixture',
    label: 'Fixture',
    weight: 1,
    category: 'quality',
    frequency: 'high',
    scores: { self: 5 },
    gap_to_leader: 0,
    leader: 'none',
    gap_to_closed_source_leader: 0,
    closed_source_leader: 'none',
    gap_to_oss_leader: 0,
    oss_leader: 'none',
    status: 'in-progress',
    sprint_history: [],
    next_sprint_target: 7,
    capability_callsite: callsite,
  } as unknown as MatrixDimension;
}

// ── Parity tests ─────────────────────────────────────────────────────────────

describe('orphan-audit parity — legacy vs SearchEngine', () => {
  it('WIRED callsite: both paths agree (passed=true, no findings)', async () => {
    const dim = makeDim({ file: 'src/cli/commands/wired.ts', symbol: 'doWired' });
    const legacy = await checkOrphanAudit(dim, fixtureDir);
    const fresh = await checkOrphanAudit(dim, fixtureDir, undefined, createSearchEngine());
    assert.equal(legacy.passed, fresh.passed, `passed disagreed: legacy=${legacy.passed} fresh=${fresh.passed}`);
    assert.equal(legacy.findings.length, fresh.findings.length);
    assert.equal(legacy.passed, true);
  });

  it('ORPHAN callsite: both paths agree (passed=false, 1 finding)', async () => {
    const dim = makeDim({ file: 'src/cli/commands/orphan.ts', symbol: 'doOrphan' });
    const legacy = await checkOrphanAudit(dim, fixtureDir);
    const fresh = await checkOrphanAudit(dim, fixtureDir, undefined, createSearchEngine());
    assert.equal(legacy.passed, fresh.passed, `passed disagreed: legacy=${legacy.passed} fresh=${fresh.passed}`);
    assert.equal(legacy.findings.length, fresh.findings.length);
    assert.equal(legacy.passed, false);
    assert.equal(legacy.findings.length, 1);
  });

  it('NO callsite declared: both paths agree (skipped)', async () => {
    const dim = {
      id: 'no-callsite', label: 'No callsite', weight: 1, category: 'quality', frequency: 'high',
      scores: { self: 5 }, gap_to_leader: 0, leader: 'none',
      gap_to_closed_source_leader: 0, closed_source_leader: 'none',
      gap_to_oss_leader: 0, oss_leader: 'none',
      status: 'in-progress', sprint_history: [], next_sprint_target: 7,
    } as unknown as MatrixDimension;
    const legacy = await checkOrphanAudit(dim, fixtureDir);
    const fresh = await checkOrphanAudit(dim, fixtureDir, undefined, createSearchEngine());
    assert.equal(legacy.skipped, true);
    assert.equal(fresh.skipped, true);
  });
});
