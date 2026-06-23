import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dossierToCapabilitySignals,
  intelToDemandSignals,
  benchmarkSignal,
  collectHarvestedSignals,
} from '../src/core/harvest-to-signals.ts';
import type { Dossier } from '../src/dossier/types.ts';
import type { IntelReport } from '../src/core/competitor-intel-fetcher.ts';
import { seedLeaderTargetFromHarvest, checkHarvestProvenance, hasHarvestProvenance } from '../src/core/harvested-bar.ts';
import type { FrontierSpec } from '../src/core/frontier-spec.ts';

function dossier(over: Partial<Dossier> = {}): Dossier {
  return {
    competitor: 'aider', displayName: 'Aider', type: 'open-source', lastBuilt: '2026-06-16T00:00:00Z',
    sources: [], composite: 7, compositeMethod: 'mean_28_dims', rubricVersion: 1,
    dimensions: {
      '3': {
        score: 8, scoreJustification: 'repo-aware multi-file edits', humanOverride: null, humanOverrideReason: null,
        evidence: [
          { claim: 'edits across many files in one pass', quote: 'Aider can edit multiple files', source: 'https://aider.chat/docs', dim: 3 },
          { claim: 'unverified note', quote: '', source: 'https://x', dim: 3 }, // empty quote → ignored
        ],
      },
    },
    ...over,
  };
}

function intel(over: Partial<IntelReport> = {}): IntelReport {
  return {
    generatedAt: '2026-06-16T00:00:00Z',
    opportunities: [],
    signals: [
      { tool: 'Aider', source: 'github-issues', title: 'auto-retry on failing tests', snippet: 'please iterate until green', url: 'https://gh/1', demandScore: 42, category: 'code_generation', foundAt: '2026-06-16T00:00:00Z' },
      { tool: 'Aider', source: 'reddit', title: 'low-signal', snippet: '', url: 'https://r/2', demandScore: 1, category: 'code_generation', foundAt: '2026-06-16T00:00:00Z' },
      { tool: 'Cline', source: 'hackernews', title: 'unrelated dim', snippet: '', url: 'https://hn/3', demandScore: 99, category: 'security', foundAt: '2026-06-16T00:00:00Z' },
    ],
    ...over,
  };
}

test('dossierToCapabilitySignals keeps only verified (non-empty-quote) evidence', () => {
  const sigs = dossierToCapabilitySignals(dossier(), '3');
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0]!.kind, 'capability');
  assert.match(sigs[0]!.claim, /Aider: edits across many files/);
  assert.equal(sigs[0]!.ratified_by, undefined); // subjective — needs ratification
  assert.deepEqual(dossierToCapabilitySignals(dossier(), '99'), []); // absent dim
});

test('dossierToCapabilitySignals skips wholly-unverified dimensions', () => {
  const d = dossier();
  d.dimensions['3']!.unverified = true;
  assert.deepEqual(dossierToCapabilitySignals(d, '3'), []);
});

test('intelToDemandSignals filters by dim id + min demand, never marks ratified', () => {
  const sigs = intelToDemandSignals(intel(), 'code_generation', { minDemand: 10 });
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0]!.kind, 'demand');
  assert.match(sigs[0]!.claim, /github-issues ·42.*auto-retry on failing tests/);
  assert.equal(sigs[0]!.ratified_by, undefined);
  assert.equal(intelToDemandSignals(intel(), 'security').length, 1); // different dim
});

test('benchmarkSignal never self-certifies verified_live', () => {
  const s = benchmarkSignal({ suite: 'swe-bench-lite', numeric: 0.65, sourceUrl: 'https://swebench.com', fetchedAt: '2026-06-16T00:00:00Z', verifiedLive: false });
  assert.equal(s.verified_live, false);
  assert.equal(s.suite, 'swe-bench-lite');
});

test('collectHarvestedSignals fuses all three sources for one dimension', () => {
  const sigs = collectHarvestedSignals({
    dossiers: [dossier()], dossierDimNumber: '3',
    intel: intel(), dimensionId: 'code_generation', minDemand: 10,
    benchmark: benchmarkSignal({ suite: 'swe-bench-lite', numeric: 0.65, sourceUrl: 'https://swebench.com', fetchedAt: '2026-06-16T00:00:00Z', verifiedLive: true }),
  });
  assert.equal(sigs.filter(s => s.kind === 'benchmark').length, 1);
  assert.equal(sigs.filter(s => s.kind === 'capability').length, 1);
  assert.equal(sigs.filter(s => s.kind === 'demand').length, 1);
});

test('end-to-end: collected harvest seeds a bar that clears the posture gate after ratification', () => {
  const signals = collectHarvestedSignals({
    dossiers: [dossier()], dossierDimNumber: '3',
    intel: intel(), dimensionId: 'code_generation', minDemand: 10,
    benchmark: benchmarkSignal({ suite: 'swe-bench-lite', numeric: 0.65, sourceUrl: 'https://swebench.com', fetchedAt: '2026-06-16T00:00:00Z', verifiedLive: true }),
  });
  const spec: FrontierSpec = {
    version: 1, target_score: 9.0, status: 'draft',
    leader_target: { competitor: 'aider', score: 0, observed_capability: 'TODO', category_delta: 'TODO' },
    real_user_path: { required_callsite: 'src/x.ts', run_command: 'node dist/index.js solve', observable_artifacts: [{ kind: 'json', path: 'o.json' }] },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'external-benchmark' },
  };
  seedLeaderTargetFromHarvest(spec, signals);
  assert.equal(spec.leader_target.score, 6.5);
  assert.ok(hasHarvestProvenance(spec.leader_target.evidence_ref));

  // Before ratification: subjective (capability/demand) bars block.
  const before = checkHarvestProvenance(spec, signals, { enabled: true });
  assert.ok(!before.ok);
  assert.ok(before.errors.some(e => /awaits ratification/.test(e)));

  // The gate clears once each subjective bar is cleared by its OWN posture (autonomy flip, council 2026-06-23):
  // CAPABILITY bars still need a human ratify; DEMAND bars clear AUTONOMOUSLY on a signed verified_live re-fetch.
  const cleared = signals.map(s => {
    if (s.kind === 'benchmark') return s;
    if (s.kind === 'demand') return { ...s, verified_live: true };
    return { ...s, ratified_by: 'operator' };
  });
  const after = checkHarvestProvenance(spec, cleared, { enabled: true });
  assert.ok(after.ok, after.errors.join('; '));
});
