import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  prefilterCandidate, nonBlankLoc, touchesTrustSurface, FILE_SIZE_HARD_CAP,
} from '../src/core/candidate-prefilter.js';
import {
  runBestOfN, defaultReward, type Candidate, type BestOfNDeps,
} from '../src/core/best-of-n.js';

function cand(id: string, files: { path: string; content: string }[], diffHash = id): Candidate {
  return { id, diffHash, files, source: 'test' };
}

describe('candidate-prefilter — Layer 1 cheap gate', () => {
  test('clean file passes', () => {
    const r = prefilterCandidate([{ path: 'src/a.ts', content: 'export const x = 1;\n' }]);
    assert.equal(r.pass, true);
  });

  test('touching the score/trust surface is rejected', () => {
    const r = prefilterCandidate([{ path: '.danteforge/compete/matrix.json', content: '{}' }]);
    assert.equal(r.pass, false);
    assert.equal(r.findings[0]!.check, 'forbidden-path');
  });

  test('supervisor state is part of the trust boundary', () => {
    assert.deepEqual(touchesTrustSurface(['.danteforge/supervisor-state.json']), ['.danteforge/supervisor-state.json']);
    assert.deepEqual(touchesTrustSurface(['src/ok.ts']), []);
  });

  test('file over the hard cap is rejected', () => {
    const big = Array.from({ length: FILE_SIZE_HARD_CAP + 5 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const r = prefilterCandidate([{ path: 'src/big.ts', content: big }]);
    assert.ok(r.findings.some((f) => f.check === 'file-size'));
  });

  test('stub / not-implemented is rejected', () => {
    const r = prefilterCandidate([{ path: 'src/s.ts', content: 'export function f() {\n  throw new Error("not implemented");\n}\n' }]);
    assert.ok(r.findings.some((f) => f.check === 'stub'));
  });

  test('nonBlankLoc ignores blank lines', () => {
    assert.equal(nonBlankLoc('a\n\n\nb\n'), 2);
  });
});

describe('runBestOfN — three-layer measured selection', () => {
  const baseDeps = (gens: (Candidate | null)[], legality: BestOfNDeps['legality']): BestOfNDeps => ({
    generate: async (i) => gens[i] ?? null,
    legality,
    log: () => {},
  });

  test('promotes the legal candidate with the highest MEASURED reward', async () => {
    const gens = [
      cand('a', [{ path: 'src/a.ts', content: 'export const a=1;' }]),
      cand('b', [{ path: 'src/b.ts', content: 'export const b=1;' }]),
      cand('c', [{ path: 'src/c.ts', content: 'export const c=1;' }]),
    ];
    const metricsById: Record<string, number> = { a: 1, b: 5, c: 2 };
    const deps = baseDeps(gens, async (c) => ({ legal: true, reason: 'ok', metrics: { passDelta: metricsById[c.id] } }));
    const res = await runBestOfN(deps, { n: 3 });
    assert.equal(res.best!.candidate.id, 'b');
    assert.equal(res.evaluated.length, 3);
  });

  test('memoizes duplicate diffs by hash', async () => {
    const gens = [
      cand('a', [{ path: 'src/a.ts', content: 'x' }], 'H'),
      cand('a2', [{ path: 'src/a.ts', content: 'x' }], 'H'), // same diff
    ];
    const deps = baseDeps(gens, async () => ({ legal: true, reason: 'ok', metrics: { passDelta: 1 } }));
    const res = await runBestOfN(deps, { n: 2 });
    assert.equal(res.skippedDuplicates, 1);
    assert.equal(res.evaluated.length, 1);
  });

  test('rejects a candidate at Layer 1 (forbidden path) before Layer 2 runs', async () => {
    let legalityCalls = 0;
    const gens = [cand('evil', [{ path: '.danteforge/outcome-evidence/x.json', content: '{}' }])];
    const deps = baseDeps(gens, async () => { legalityCalls++; return { legal: true, reason: 'ok' }; });
    const res = await runBestOfN(deps, { n: 1 });
    assert.equal(res.best, null);
    assert.equal(legalityCalls, 0, 'Layer 2 never ran for an L1 reject');
    assert.equal(res.rejected[0]!.layer, 'prefilter');
  });

  test('rejects an illegal candidate at Layer 2', async () => {
    const gens = [cand('a', [{ path: 'src/a.ts', content: 'export const a=1;' }])];
    const deps = baseDeps(gens, async () => ({ legal: false, reason: 'suite failed: 3 tests red' }));
    const res = await runBestOfN(deps, { n: 1 });
    assert.equal(res.best, null);
    assert.equal(res.rejected[0]!.layer, 'legality');
  });

  test('skips a declined generator (dead/declining council member)', async () => {
    const deps = baseDeps([null], async () => ({ legal: true, reason: 'ok' }));
    const res = await runBestOfN(deps, { n: 1 });
    assert.equal(res.best, null);
    assert.equal(res.evaluated.length, 0);
  });

  test('Goodhart guard: cannot win on token-cost alone over a real pass gain', () => {
    const passWin = defaultReward({ passDelta: 3 });
    const tokenOnly = defaultReward({ tokenCostDelta: -50_000 });
    assert.ok(passWin > tokenOnly, 'a real pass gain outranks a pure token-cost drop');
  });

  test('PDSE firewall: reward depends ONLY on measured metrics (soft fields ignored)', () => {
    const measured = { passDelta: 2 };
    const withSoft = { passDelta: 2, pdse: 99, vibes: 'great' } as unknown as Parameters<typeof defaultReward>[0];
    assert.equal(defaultReward(measured), defaultReward(withSoft));
  });
});
