import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkOutcomeIntegrity, integrityCapFor } from '../src/matrix/engines/outcome-integrity.js';

// Real temp project on the X: drive (never C:/os.tmpdir for persistent artifacts).
const ROOT = path.join('X:\\tmp', `coupling-test-${process.pid}`);

before(async () => {
  await fs.mkdir(path.join(ROOT, 'tests'), { recursive: true });
  // A test that genuinely imports the forge engine (references the callsite token).
  await fs.writeFile(path.join(ROOT, 'tests', 'coupled.test.ts'),
    `import { runForge } from '../src/core/forge-engine.js';\nrunForge();\n`, 'utf8');
  // A benchmark test that imports something unrelated — the audit's seam case.
  await fs.writeFile(path.join(ROOT, 'tests', 'data-privacy-real-benchmark.test.ts'),
    `import { scrub } from '../src/core/privacy.js';\nscrub();\n`, 'utf8');
});

after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

describe('checkOutcomeIntegrity — callsite-coupling (CALLSITE_DECOUPLED)', () => {
  test('flags a high-tier outcome whose test does not reference its required_callsite', async () => {
    const dims = [
      // Genuinely coupled: test imports forge-engine, callsite is forge-engine.
      { id: 'forge', outcomes: [{ id: 'o1', tier: 'T7', command: 'npx tsx --test tests/coupled.test.ts', required_callsite: 'src/core/forge-engine.ts' }] },
      // Decoupled: outcome runs a privacy benchmark but claims the telemetry collector callsite.
      { id: 'observability_telemetry', outcomes: [{ id: 'o2', tier: 'T7', command: 'npx tsx --test tests/data-privacy-real-benchmark.test.ts', required_callsite: 'src/core/telemetry-collector.ts' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, ROOT);
    assert.ok(report.decoupledDims.includes('observability_telemetry'), 'the mismatched dim must be flagged');
    assert.ok(!report.decoupledDims.includes('forge'), 'the genuinely-coupled dim must NOT be flagged');
    assert.ok(report.violations.some(v => v.kind === 'CALLSITE_DECOUPLED' && v.dimId === 'observability_telemetry'));
  });

  test('does NOT flag a product run (no test file to inspect)', async () => {
    const dims = [
      { id: 'd', outcomes: [{ id: 'o', tier: 'T7', kind: 'e2e-workflow', command: 'node dist/index.js go', required_callsite: 'src/core/go.ts' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, ROOT);
    assert.equal(report.decoupledDims.includes('d'), false, 'product runs are not statically checkable — not flagged');
  });

  test('does NOT flag when the referenced test file cannot be read (conservative)', async () => {
    const dims = [
      { id: 'd', outcomes: [{ id: 'o', tier: 'T7', command: 'npx tsx --test tests/does-not-exist.test.ts', required_callsite: 'src/core/x.ts' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, ROOT);
    assert.equal(report.decoupledDims.includes('d'), false, 'unreadable test files cannot be judged — not flagged');
  });
});

describe('checkOutcomeIntegrity — orphan / production-wiring (ORPHAN_CALLSITE)', () => {
  const R = path.join('X:\\tmp', `orphan-test-${process.pid}`);
  before(async () => {
    await fs.mkdir(path.join(R, 'src', 'core'), { recursive: true });
    await fs.mkdir(path.join(R, 'src', 'cli'), { recursive: true });
    // A production (non-test) file that imports `wired` → 'wired' is production-wired.
    // It does NOT import `orphan` → 'orphan' is unwired.
    await fs.writeFile(path.join(R, 'src', 'cli', 'index.ts'), `import { go } from '../core/wired.js';\ngo();\n`, 'utf8');
    await fs.writeFile(path.join(R, 'src', 'core', 'wired.ts'), `export function go() {}\n`, 'utf8');
    await fs.writeFile(path.join(R, 'src', 'core', 'orphan.ts'), `export function lonely() {}\n`, 'utf8');
  });
  after(async () => { await fs.rm(R, { recursive: true, force: true }).catch(() => {}); });

  test('flags a T4+ outcome whose callsite is never imported by production, and caps it at 7.0', async () => {
    const dims = [
      { id: 'dimWired', outcomes: [{ id: 'ow', tier: 'T5', command: 'npx tsx --test tests/w.test.ts', required_callsite: 'src/core/wired.ts' }] },
      { id: 'dimOrphan', outcomes: [{ id: 'oo', tier: 'T5', command: 'npx tsx --test tests/o.test.ts', required_callsite: 'src/core/orphan.ts' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, R);
    assert.ok(report.orphanDims.includes('dimOrphan'), 'the unwired callsite must be flagged as orphan');
    assert.ok(!report.orphanDims.includes('dimWired'), 'a production-wired callsite must NOT be flagged');
    assert.ok(report.violations.some(v => v.kind === 'ORPHAN_CALLSITE' && v.dimId === 'dimOrphan'));
    // The cap flows through integrityCapFor (same path validate + the headline use).
    assert.deepEqual(integrityCapFor(8.0, 'dimOrphan', report), { cappedScore: 7.0, integrityCap: 'ORPHAN_CALLSITE' });
    assert.equal(integrityCapFor(8.0, 'dimWired', report).integrityCap, undefined, 'wired dim is not capped');
  });

  test('T1-T3 outcomes are NOT subject to the orphan check (only T4+ claim production wiring)', async () => {
    const dims = [
      { id: 'd', outcomes: [{ id: 'o', tier: 'T2', command: 'npx tsx --test tests/o.test.ts', required_callsite: 'src/core/orphan.ts' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, R);
    assert.equal(report.orphanDims.includes('d'), false, 'a T2 outcome may reference an unwired module — that is honest unit-level evidence');
  });
});
