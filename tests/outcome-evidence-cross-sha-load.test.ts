// outcome-evidence-cross-sha-load.test.ts
// Proves the fix for the fleet-wide "stale-evidence collapse": loadOutcomeEvidence
// must surface the freshest VALID receipt per (dim,outcome) across SHAs — so an
// UNRELATED commit (or tool telemetry shifting HEAD) does NOT orphan every receipt
// and collapse the matrix to 0.0 — WITHOUT weakening integrity (a receipt past its
// tier freshness window is still rejected; the exact current-SHA receipt still wins).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadOutcomeEvidence } from '../src/matrix/engines/outcome-runner.js';
import { makeEvidenceKey, type OutcomeEvidenceEntry } from '../src/matrix/types/outcome.js';

const SHA_A = 'a'.repeat(40); // a prior commit
const SHA_B = 'b'.repeat(40); // current HEAD (no receipt written here)
const SHA_C = 'c'.repeat(40); // another prior commit

function ev(over: Partial<OutcomeEvidenceEntry>): OutcomeEvidenceEntry {
  return {
    dimensionId: 'dimX', outcomeId: 'o1', tier: 'T4', gitSha: SHA_A,
    passed: true, exitCode: 0, durationMs: 1, stdoutTail: '', stderrTail: '',
    ranAt: new Date().toISOString(), evidencePath: '', ...over,
  };
}
const fileFor = (e: OutcomeEvidenceEntry) => `${e.gitSha ?? 'nogit'}-${e.dimensionId}-${e.outcomeId}.json`;

function seams(entries: OutcomeEvidenceEntry[]) {
  const files: Record<string, OutcomeEvidenceEntry> = {};
  for (const e of entries) files[fileFor(e)] = e;
  return {
    _exists: async () => true,
    _readdir: async () => Object.keys(files),
    _readFile: async (p: string) => JSON.stringify(files[p.split(/[\\/]/).pop() as string]),
    _readGitSha: async () => SHA_B,
  };
}
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

describe('loadOutcomeEvidence — cross-SHA freshness (the stale-evidence-collapse fix)', () => {
  test('FIX: a fresh receipt from a PRIOR sha is loaded at the current HEAD (no collapse)', async () => {
    const e = ev({ gitSha: SHA_A, ranAt: daysAgo(1), tier: 'T4' }); // 1 day old, T4 window = 14d
    const map = await loadOutcomeEvidence('/x', SHA_B, seams([e]));
    assert.equal(map.size, 1, 'prior-sha fresh receipt must survive a HEAD shift');
    assert.equal(map.get(makeEvidenceKey('dimX', 'o1'))?.passed, true);
  });

  test('INTEGRITY: a STALE prior-sha receipt is NOT loaded (freshness window is the gate)', async () => {
    const e = ev({ gitSha: SHA_A, ranAt: daysAgo(100), tier: 'T4' }); // 100 days old > 14d window
    const map = await loadOutcomeEvidence('/x', SHA_B, seams([e]));
    assert.equal(map.size, 0, 'a receipt past its tier freshness window must be rejected');
  });

  test('ACCURACY: the exact current-SHA receipt WINS over a prior-sha one', async () => {
    const prior = ev({ gitSha: SHA_A, ranAt: daysAgo(2), passed: false, outcomeId: 'o1' });
    const current = ev({ gitSha: SHA_B, ranAt: daysAgo(5), passed: true, outcomeId: 'o1' });
    // current has an OLDER ranAt but is the exact HEAD sha → it reflects current code → it wins.
    const map = await loadOutcomeEvidence('/x', SHA_B, seams([prior, current]));
    assert.equal(map.get(makeEvidenceKey('dimX', 'o1'))?.passed, true, 'current-sha receipt must win');
    assert.equal(map.get(makeEvidenceKey('dimX', 'o1'))?.gitSha, SHA_B);
  });

  test('FALLBACK: with NO current-sha receipt, the freshest non-stale prior wins', async () => {
    const older = ev({ gitSha: SHA_A, ranAt: daysAgo(6), passed: false });
    const newer = ev({ gitSha: SHA_C, ranAt: daysAgo(1), passed: true });
    const map = await loadOutcomeEvidence('/x', SHA_B, seams([older, newer]));
    assert.equal(map.get(makeEvidenceKey('dimX', 'o1'))?.gitSha, SHA_C, 'freshest prior receipt wins');
    assert.equal(map.get(makeEvidenceKey('dimX', 'o1'))?.passed, true);
  });

  test('multiple dims/outcomes are grouped independently', async () => {
    const a = ev({ dimensionId: 'dimA', outcomeId: 'oa', gitSha: SHA_A, ranAt: daysAgo(1) });
    const b = ev({ dimensionId: 'dimB', outcomeId: 'ob', gitSha: SHA_C, ranAt: daysAgo(1) });
    const map = await loadOutcomeEvidence('/x', SHA_B, seams([a, b]));
    assert.equal(map.size, 2);
    assert.ok(map.has(makeEvidenceKey('dimA', 'oa')));
    assert.ok(map.has(makeEvidenceKey('dimB', 'ob')));
  });
});
