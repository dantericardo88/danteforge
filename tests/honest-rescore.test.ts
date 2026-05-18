import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  runHonestRescore,
  mapPackageToDim,
  computeHighestPassedTier,
  TIER_SCORE_CAPS,
  type MatrixLite,
} from '../src/cli/commands/honest-rescore.js';
import type { ProbeResult } from '../src/cli/commands/probe.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProbeResult(overrides: Partial<ProbeResult>): ProbeResult {
  return {
    tier: 'T1', passed: true, exitCode: 0, gitSha: 'abc',
    worktreeFingerprint: 'abc', durationMs: 1000, runner: 'turbo',
    command: 'npx turbo run build', failedPackages: [],
    stdoutTail: '', stderrTail: '',
    evidencePath: '/p/.danteforge/runtime-evidence/abc-T1.json',
    ranAt: new Date().toISOString(), cachedHit: false,
    ...overrides,
  };
}

function makeFs(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const written = new Map<string, string>();
  return {
    written,
    _readFile: async (p: string) => {
      const norm = p.replace(/\\/g, '/');
      const exact = Array.from(store.keys()).find(k => k.replace(/\\/g, '/') === norm);
      if (!exact) throw new Error(`ENOENT: ${p}`);
      return store.get(exact)!;
    },
    _writeFile: async (p: string, d: string) => { written.set(p, d); },
    _exists: async (p: string) => {
      const norm = p.replace(/\\/g, '/');
      const dirPrefix = norm.endsWith('/') ? norm : norm + '/';
      // Mirror real fs: directory exists if any stored file lives under it,
      // file exists if its exact path is in the store.
      return Array.from(store.keys()).some(k => {
        const kn = k.replace(/\\/g, '/');
        return kn === norm || kn.startsWith(dirPrefix);
      });
    },
    _readdir: async (p: string) => {
      const norm = p.replace(/\\/g, '/');
      const prefix = norm.endsWith('/') ? norm : norm + '/';
      return Array.from(store.keys())
        .map(k => k.replace(/\\/g, '/'))
        .filter(k => k.startsWith(prefix))
        .map(k => k.slice(prefix.length))
        .filter(k => !k.includes('/'));
    },
  };
}

const SIMPLE_MATRIX: MatrixLite = {
  project: 'testproj',
  overallSelfScore: 9.0,
  dimensions: [
    { id: 'security', scores: { self: 9.0 } },
    { id: 'testing', scores: { self: 9.0 } },
    { id: 'performance', scores: { self: 9.0 } },
  ],
};

// ── mapPackageToDim ───────────────────────────────────────────────────────────

describe('mapPackageToDim', () => {
  it('uses explicit map entry first', () => {
    const m = mapPackageToDim('@org/security-scanner', { '@org/security-scanner': 'security' });
    assert.equal(m, 'security');
  });

  it('prefix-matches when no explicit entry', () => {
    const m = mapPackageToDim('@org/security-scanner', {});
    assert.equal(m, 'security');
  });

  it('strips @scope/ prefix when prefix-matching', () => {
    const m = mapPackageToDim('@dirtydlite/cli-tools', {});
    assert.equal(m, 'cli');
  });

  it('falls back to _default key when set', () => {
    const m = mapPackageToDim('', { _default: '_unknown' } as any);
    assert.equal(m, '_unknown');
  });
});

// ── computeHighestPassedTier ──────────────────────────────────────────────────

describe('computeHighestPassedTier', () => {
  it('returns null when no evidence', () => {
    const t = computeHighestPassedTier(new Map(), new Map());
    assert.equal(t, null);
  });

  it('returns T1 when T1 passes and T2 not probed', () => {
    const ev = new Map();
    ev.set('T1', makeProbeResult({ tier: 'T1', passed: true }));
    const t = computeHighestPassedTier(ev, new Map());
    assert.equal(t, 'T1');
  });

  it('returns T2 when T1 and T2 both pass', () => {
    const ev = new Map();
    ev.set('T1', makeProbeResult({ tier: 'T1', passed: true }));
    ev.set('T2', makeProbeResult({ tier: 'T2', passed: true }));
    const t = computeHighestPassedTier(ev, new Map());
    assert.equal(t, 'T2');
  });

  it('passes T1 when dim has no attributed failures (other dims took the hit)', () => {
    // Per-package attribution: if @org/broken maps to a different dim, this dim escapes.
    const ev = new Map();
    ev.set('T1', makeProbeResult({ tier: 'T1', passed: false, failedPackages: ['@org/broken'] }));
    const t = computeHighestPassedTier(ev, new Map());
    assert.equal(t, 'T1');
  });

  it('returns null when unattributed failure (exit non-zero, no packages parsed)', () => {
    // Conservative: a global non-zero exit with no per-package error means we cannot
    // attribute the failure, so every dim must fail too.
    const ev = new Map();
    ev.set('T1', makeProbeResult({ tier: 'T1', passed: false, exitCode: 1, failedPackages: [] }));
    const t = computeHighestPassedTier(ev, new Map());
    assert.equal(t, null);
  });

  it('returns null when this dim has attributed failures even if probe globally passed', () => {
    const ev = new Map();
    ev.set('T1', makeProbeResult({ tier: 'T1', passed: true }));
    const dimFailures = new Map();
    dimFailures.set('T1', ['@org/myDim-broken']);
    const t = computeHighestPassedTier(ev, dimFailures);
    assert.equal(t, null);
  });

  it('caps at T1 when this dim has failing packages at T2', () => {
    const ev = new Map();
    ev.set('T1', makeProbeResult({ tier: 'T1', passed: true }));
    ev.set('T2', makeProbeResult({ tier: 'T2', passed: true }));
    const dimFailures = new Map();
    dimFailures.set('T2', ['@org/myDim-broken']);  // this dim has failures at T2
    const t = computeHighestPassedTier(ev, dimFailures);
    assert.equal(t, 'T1');
  });

  it('TIER_SCORE_CAPS exposes the canonical ladder', () => {
    assert.equal(TIER_SCORE_CAPS.T0, 1.0);
    assert.equal(TIER_SCORE_CAPS.T1, 4.0);
    assert.equal(TIER_SCORE_CAPS.T2, 5.0);
    assert.equal(TIER_SCORE_CAPS.T6, 8.5);
  });
});

// ── runHonestRescore ──────────────────────────────────────────────────────────

describe('runHonestRescore — end-to-end', () => {
  it('clamps every dim to T0 (1.0) when no evidence exists', async () => {
    const fs = makeFs({
      [path.join('/p', '.danteforge', 'compete', 'matrix.json')]:
        JSON.stringify(SIMPLE_MATRIX),
    });
    const result = await runHonestRescore({ cwd: '/p', ...fs });
    for (const d of result.perDimension) {
      assert.equal(d.honestScore, 1.0, `${d.id} should clamp to T0=1.0 with no evidence`);
      assert.equal(d.capTier, null);
      assert.match(d.reason, /No runtime evidence/);
    }
    assert.ok(result.honestOverall <= 1.5, 'overall should crater without evidence');
  });

  it('clamps to T1 (4.0) when build passes', async () => {
    const probe = makeProbeResult({ tier: 'T1', passed: true, failedPackages: [] });
    const fs = makeFs({
      [path.join('/p', '.danteforge', 'compete', 'matrix.json')]:
        JSON.stringify(SIMPLE_MATRIX),
      [path.join('/p', '.danteforge', 'runtime-evidence', 'abc-T1.json')]:
        JSON.stringify(probe),
    });
    const result = await runHonestRescore({ cwd: '/p', ...fs });
    for (const d of result.perDimension) {
      assert.equal(d.capTier, 'T1');
      assert.equal(d.honestScore, 4.0);
    }
  });

  it('attributes per-package failures to the right dimension', async () => {
    const probe = makeProbeResult({
      tier: 'T1', passed: false, exitCode: 1,
      failedPackages: ['@org/security-scanner', '@org/testing-runner'],
    });
    const fs = makeFs({
      [path.join('/p', '.danteforge', 'compete', 'matrix.json')]:
        JSON.stringify(SIMPLE_MATRIX),
      [path.join('/p', '.danteforge', 'runtime-evidence', 'abc-T1.json')]:
        JSON.stringify(probe),
    });
    const result = await runHonestRescore({ cwd: '/p', ...fs });
    const security = result.perDimension.find(d => d.id === 'security')!;
    const testing = result.perDimension.find(d => d.id === 'testing')!;
    const performance = result.perDimension.find(d => d.id === 'performance')!;
    // security and testing should be capped (their packages failed)
    assert.equal(security.honestScore, 1.0);
    assert.equal(testing.honestScore, 1.0);
    // performance should reach T1 (no packages mapped to it failed)
    assert.equal(performance.honestScore, 4.0);
  });

  it('writes the honest matrix and diff report without mutating matrix.json', async () => {
    const probe = makeProbeResult({ tier: 'T1', passed: true });
    const fs = makeFs({
      [path.join('/p', '.danteforge', 'compete', 'matrix.json')]:
        JSON.stringify(SIMPLE_MATRIX),
      [path.join('/p', '.danteforge', 'runtime-evidence', 'abc-T1.json')]:
        JSON.stringify(probe),
    });
    const result = await runHonestRescore({ cwd: '/p', ...fs });
    assert.ok(result.honestMatrixPath.endsWith('matrix.honest.json'));
    assert.ok(result.diffReportPath.endsWith('matrix.honest.diff.md'));
    assert.ok(fs.written.has(result.honestMatrixPath));
    assert.ok(fs.written.has(result.diffReportPath));
    // matrix.json was never in the written map
    const matrixJsonPath = path.join('/p', '.danteforge', 'compete', 'matrix.json');
    assert.ok(!fs.written.has(matrixJsonPath), 'matrix.json must NOT be written');
  });

  it('throws clearly when matrix.json is missing', async () => {
    const fs = makeFs({});
    await assert.rejects(
      () => runHonestRescore({ cwd: '/p', ...fs }),
      /No matrix.json/,
    );
  });

  it('respects an explicit package-to-dimension map', async () => {
    const probe = makeProbeResult({
      tier: 'T1', passed: false, exitCode: 1,
      failedPackages: ['totally-unrelated-name'],
    });
    const fs = makeFs({
      [path.join('/p', '.danteforge', 'compete', 'matrix.json')]:
        JSON.stringify({
          project: 'testproj',
          overallSelfScore: 9.0,
          dimensions: [
            { id: 'security', scores: { self: 9.0 } },
            { id: 'testing', scores: { self: 9.0 } },
          ],
        }),
      [path.join('/p', '.danteforge', 'runtime-evidence', 'abc-T1.json')]:
        JSON.stringify(probe),
      [path.join('/p', '.danteforge', 'package-to-dimension.json')]:
        JSON.stringify({ 'totally-unrelated-name': 'security' }),
    });
    const result = await runHonestRescore({ cwd: '/p', ...fs });
    const security = result.perDimension.find(d => d.id === 'security')!;
    const testing = result.perDimension.find(d => d.id === 'testing')!;
    assert.equal(security.honestScore, 1.0, 'security caps because its mapped pkg failed');
    // testing has no failed packages mapped via the explicit map, so it reaches T1
    // (well, security and "_unmapped" took the failure)
    // Actually since failedPackage maps explicitly to security via the map, testing escapes.
    assert.equal(testing.honestScore, 4.0);
  });
});
