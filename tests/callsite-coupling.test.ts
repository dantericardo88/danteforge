import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkOutcomeIntegrity, integrityCapFor, buildWiredBasenames } from '../src/matrix/engines/outcome-integrity.js';

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

// ── Import-graph reachability (the precision upgrade over basename matching) ──
//
// The old check passed any callsite whose module BASENAME appeared in an import
// line of any non-test file — including imports inside files nothing reaches.
// These tests pin the upgrade: wired now means REACHABLE from a production
// entrypoint through the static import graph (JS/TS only).

describe('checkOutcomeIntegrity — orphan via import-graph reachability', () => {
  const G1 = path.join('X:\\tmp', `orphan-graph1-${process.pid}`);
  const G2 = path.join('X:\\tmp', `orphan-graph2-${process.pid}`);
  const G3 = path.join('X:\\tmp', `orphan-graph3-${process.pid}`);
  const G5 = path.join('X:\\tmp', `orphan-graph5-${process.pid}`);
  const w = async (root: string, rel: string, content: string): Promise<void> => {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
  };

  before(async () => {
    // G1 — entrypoint src/cli/index.ts; a reachable chain; two basename-credited
    // but UNREACHABLE modules (test-support import + unconsumed barrel).
    await w(G1, 'package.json', '{ "name": "g1", "type": "module" }\n');
    await w(G1, 'src/cli/index.ts', `import { run } from '../core/app.js';\nrun();\n`);
    await w(G1, 'src/core/app.ts', `import { deep } from './deep/feature.js';\nexport function run(): void { deep(); }\n`);
    await w(G1, 'src/core/deep/feature.ts', `export function deep(): void {}\n`);
    // (a) basename appears ONLY in a test-support import: src/testing/ is not a
    // recognized test path, so the OLD basename check credited it — but nothing
    // reaches harness.ts from any entrypoint.
    await w(G1, 'src/core/token-only.ts', `export const t = 1;\n`);
    await w(G1, 'src/testing/harness.ts', `import { t } from '../core/token-only.js';\nexport const h = t;\n`);
    await w(G1, 'tests/app.test.ts', `import { h } from '../src/testing/harness.js';\nif (!h) throw new Error('h');\n`);
    // (b) a barrel re-exports the module, but nothing imports the barrel.
    await w(G1, 'src/core/lonely-mod.ts', `export const x = 2;\n`);
    await w(G1, 'src/core/barrel.ts', `export * from './lonely-mod.js';\n`);

    // G2 — entrypoint comes ONLY from package.json bin (no src/index, no src/cli/index);
    // bin is a real .js file whose imports resolve to .ts sources (ESM ext-twin).
    await w(G2, 'package.json', '{ "name": "g2", "type": "module", "bin": { "g2": "./bin/run.js" } }\n');
    await w(G2, 'bin/run.js', `import { boot } from '../src/app.js';\nboot();\n`);
    await w(G2, 'src/app.ts', `import { feat } from './deep/feature.js';\nexport function boot(): void { feat(); }\n`);
    await w(G2, 'src/deep/feature.ts', `export function feat(): void {}\n`);
    await w(G2, 'src/unwired.ts', `export function never(): void {}\n`);

    // G3 — NO resolvable entrypoint (no package.json, no src/index.*, no src/cli/index.*):
    // the graph cannot be built, so the audit must degrade to the basename check.
    await w(G3, 'app/main.ts', `import { used } from './used.js';\nused();\n`);
    await w(G3, 'app/used.ts', `export function used(): void {}\n`);
    await w(G3, 'app/never.ts', `export function never(): void {}\n`);

    // G5 — Python-only project: cross-language callsites stay on the basename check.
    await w(G5, 'prod.py', `from helper import h\nh()\n`);
    await w(G5, 'helper.py', `def h():\n    return 1\n`);
    await w(G5, 'lone.py', `def l():\n    return 2\n`);
  });

  after(async () => {
    for (const r of [G1, G2, G3, G5]) await fs.rm(r, { recursive: true, force: true }).catch(() => {});
  });

  test('(a) a module whose basename appears in a test-support import ONLY is an ORPHAN (the old check passed it)', async () => {
    // Pin the upgrade: the old basename set credits it...
    const oldWired = await buildWiredBasenames(G1);
    assert.ok(oldWired.has('token-only'), 'precondition: the OLD basename check credited the test-support import');
    // ...but the import graph does not.
    const dims = [
      { id: 'dimToken', outcomes: [{ id: 'o', tier: 'T5', command: 'npx tsx --test tests/app.test.ts', required_callsite: 'src/core/token-only.ts' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, G1);
    assert.ok(report.orphanDims.includes('dimToken'), 'a test-only-imported module must now be flagged as orphan');
    assert.ok(report.violations.some(v => v.kind === 'ORPHAN_CALLSITE' && v.dimId === 'dimToken'));
    assert.equal(report.wiringGraphDegraded, undefined, 'the graph built fine — no precision degradation');
  });

  test('(b) a module imported only by a barrel that nothing imports is an ORPHAN', async () => {
    const oldWired = await buildWiredBasenames(G1);
    assert.ok(oldWired.has('lonely-mod'), 'precondition: the OLD basename check credited the barrel re-export');
    const dims = [
      { id: 'dimBarrel', outcomes: [{ id: 'o', tier: 'T5', command: 'npx tsx --test tests/b.test.ts', required_callsite: 'src/core/lonely-mod.ts' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, G1);
    assert.ok(report.orphanDims.includes('dimBarrel'), 'an unconsumed barrel must not count as production wiring');
    assert.deepEqual(integrityCapFor(8.5, 'dimBarrel', report), { cappedScore: 7.0, integrityCap: 'ORPHAN_CALLSITE' });
  });

  test('(c) a module reachable via entrypoint → bin → chain of imports is WIRED; an unreachable sibling is not', async () => {
    const dims = [
      { id: 'dimChain', outcomes: [{ id: 'o1', tier: 'T5', command: 'npx tsx --test tests/c.test.ts', required_callsite: 'src/deep/feature.ts' }] },
      { id: 'dimUnwired', outcomes: [{ id: 'o2', tier: 'T5', command: 'npx tsx --test tests/c.test.ts', required_callsite: 'src/unwired.ts' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, G2);
    assert.ok(!report.orphanDims.includes('dimChain'), 'package.json bin → .js → .ts import chain must count as wired');
    assert.ok(report.orphanDims.includes('dimUnwired'), 'a module no entrypoint chain reaches is an orphan');
    assert.equal(report.wiringGraphDegraded, undefined);
  });

  test('(d) Python callsites stay on the language-aware basename check (reachability is JS/TS-only)', async () => {
    const dims = [
      { id: 'dimPyWired', outcomes: [{ id: 'o1', tier: 'T5', command: 'pytest tests/test_h.py', required_callsite: 'helper.py' }] },
      { id: 'dimPyLone', outcomes: [{ id: 'o2', tier: 'T5', command: 'pytest tests/test_l.py', required_callsite: 'lone.py' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, G5);
    assert.ok(!report.orphanDims.includes('dimPyWired'), 'a production-imported Python module must NOT be flagged');
    assert.ok(report.orphanDims.includes('dimPyLone'), 'an unimported Python module is still an orphan');
    assert.equal(report.wiringGraphDegraded, undefined, 'non-JS callsites never consult (or degrade) the JS import graph');
  });

  test('(e) graph-build failure (no resolvable entrypoints) falls back to the basename check and completes', async () => {
    const dims = [
      { id: 'dimUsed', outcomes: [{ id: 'o1', tier: 'T5', command: 'npx tsx --test tests/u.test.ts', required_callsite: 'app/used.ts' }] },
      { id: 'dimNever', outcomes: [{ id: 'o2', tier: 'T5', command: 'npx tsx --test tests/n.test.ts', required_callsite: 'app/never.ts' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, G3);
    assert.ok(!report.orphanDims.includes('dimUsed'), 'basename-wired module passes in degraded mode (old behavior preserved)');
    assert.ok(report.orphanDims.includes('dimNever'), 'a true orphan is still caught by the basename fallback');
    assert.match(report.wiringGraphDegraded ?? '', /no production entrypoints/, 'the degradation must be surfaced, not silent');
  });

  test('(f) budget exhaustion degrades to the basename check — the audit never hangs and never over-flags', async () => {
    const prev = process.env['DANTEFORGE_HARDEN_ORPHAN_TIMEOUT_MS'];
    process.env['DANTEFORGE_HARDEN_ORPHAN_TIMEOUT_MS'] = '-100';
    try {
      // token-only is graph-orphan but basename-wired: in degraded mode the check
      // must fall back to the OLD (basename) verdict — degradation never makes the
      // gate stricter than the precision it actually has.
      const dims = [
        { id: 'dimToken', outcomes: [{ id: 'o', tier: 'T5', command: 'npx tsx --test tests/app.test.ts', required_callsite: 'src/core/token-only.ts' }] },
      ];
      const report = await checkOutcomeIntegrity(dims, G1);
      assert.ok(!report.orphanDims.includes('dimToken'), 'degraded mode must match the basename verdict');
      assert.match(report.wiringGraphDegraded ?? '', /budget/, 'the budget trip must be surfaced as degraded precision');
    } finally {
      if (prev === undefined) delete process.env['DANTEFORGE_HARDEN_ORPHAN_TIMEOUT_MS'];
      else process.env['DANTEFORGE_HARDEN_ORPHAN_TIMEOUT_MS'] = prev;
    }
  });
});
