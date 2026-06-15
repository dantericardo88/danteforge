// #10: per-dimension evidence freshness vs HEAD — "are these scores about the current code?"
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeEvidenceStaleness, formatStalenessLine } from '../src/core/evidence-staleness.js';
import type { OutcomeEvidence, OutcomeEvidenceEntry } from '../src/matrix/types/outcome.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

function entry(over: Partial<OutcomeEvidenceEntry>): OutcomeEvidenceEntry {
  return { dimensionId: 'd', outcomeId: 'o', tier: 'T5', gitSha: HEAD, passed: true, exitCode: 0, durationMs: 1, stdoutTail: '', stderrTail: '', ranAt: '2026-06-15T00:00:00Z', evidencePath: 'p', ...over } as OutcomeEvidenceEntry;
}
function ev(entries: OutcomeEvidenceEntry[]): OutcomeEvidence {
  const m: OutcomeEvidence = new Map();
  entries.forEach((e, i) => m.set(`${e.dimensionId}::${e.outcomeId}::${i}`, e));
  return m;
}
function matrix(ids: string[]): CompeteMatrix {
  return { dimensions: ids.map(id => ({ id })) } as unknown as CompeteMatrix;
}

describe('computeEvidenceStaleness', () => {
  it('classifies dims as current (HEAD), stale (borrowed prior SHA), or no-evidence', async () => {
    const r = await computeEvidenceStaleness({
      cwd: '/x', matrix: matrix(['fresh', 'stale', 'empty']),
      _headSha: async () => HEAD,
      _loadEvidence: async () => ev([
        entry({ dimensionId: 'fresh', gitSha: HEAD }),
        entry({ dimensionId: 'stale', gitSha: OLD }),
      ]),
    });
    assert.equal(r.headSha, HEAD);
    assert.equal(r.freshCount, 1);
    assert.equal(r.staleCount, 1);
    assert.equal(r.noEvidenceCount, 1);
    assert.deepEqual(r.perDim.find(p => p.dimId === 'stale')?.borrowedShas, [OLD]);
    assert.equal(r.perDim.find(p => p.dimId === 'fresh')?.freshAtHead, true);
  });

  it('a dim with both a HEAD receipt and an old one counts as current', async () => {
    const r = await computeEvidenceStaleness({
      cwd: '/x', matrix: matrix(['d']),
      _headSha: async () => HEAD,
      _loadEvidence: async () => ev([entry({ dimensionId: 'd', outcomeId: 'o1', gitSha: OLD }), entry({ dimensionId: 'd', outcomeId: 'o2', gitSha: HEAD })]),
    });
    assert.equal(r.freshCount, 1);
    assert.equal(r.staleCount, 0);
  });

  it('null HEAD (no git) → nothing is "fresh at HEAD"', async () => {
    const r = await computeEvidenceStaleness({
      cwd: '/x', matrix: matrix(['d']),
      _headSha: async () => null,
      _loadEvidence: async () => ev([entry({ dimensionId: 'd', gitSha: HEAD })]),
    });
    assert.equal(r.freshCount, 0);
    assert.equal(r.staleCount, 1);
  });
});

describe('formatStalenessLine', () => {
  it('is empty when no dim has evidence (keeps fresh/empty matrices quiet)', () => {
    const line = formatStalenessLine({ headSha: HEAD, perDim: [{ dimId: 'd', hasEvidence: false, freshAtHead: false, borrowedShas: [] }], freshCount: 0, staleCount: 0, noEvidenceCount: 1 });
    assert.equal(line, '');
  });

  it('names stale dims with their borrowed SHA + the refresh command', () => {
    const line = formatStalenessLine({
      headSha: HEAD,
      perDim: [{ dimId: 'stale', hasEvidence: true, freshAtHead: false, borrowedShas: [OLD] }],
      freshCount: 0, staleCount: 1, noEvidenceCount: 0,
    });
    assert.match(line, /Evidence freshness/);
    assert.match(line, /stale@bbbbbbb/);
    assert.match(line, /danteforge validate/);
    assert.match(line, /ZERO dims have receipts at HEAD/); // freshCount 0 with evidence → loud warning
  });
});
