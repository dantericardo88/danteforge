import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBenchmarkScore,
  harvestTag,
  classifyBarProvenance,
  hasHarvestProvenance,
  seedLeaderTargetFromHarvest,
  checkHarvestProvenance,
  type HarvestedSignal,
} from '../src/core/harvested-bar.ts';
import type { FrontierSpec } from '../src/core/frontier-spec.ts';

function draftSpec(overrides: Partial<FrontierSpec['leader_target']> = {}): FrontierSpec {
  return {
    version: 1,
    target_score: 9.0,
    status: 'draft',
    leader_target: {
      competitor: 'aider',
      score: 0,
      observed_capability: 'TODO: what the leader does',
      category_delta: 'TODO: the beyond-parity bar',
      ...overrides,
    },
    real_user_path: {
      required_callsite: 'src/x.ts',
      run_command: 'node dist/index.js solve',
      observable_artifacts: [{ kind: 'json', path: 'out.json' }],
    },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'external-benchmark' },
  };
}

const bench = (o: Partial<HarvestedSignal> = {}): HarvestedSignal => ({
  kind: 'benchmark', source: 'https://swebench.com/leaderboard', fetched_at: '2026-06-16T00:00:00Z',
  claim: 'top agent resolves 65% of swe-bench-lite', suite: 'swe-bench-lite', numeric: 0.65, verified_live: true, ...o,
});
const cap = (o: Partial<HarvestedSignal> = {}): HarvestedSignal => ({
  kind: 'capability', source: 'github.com/paul-gauthier/aider', fetched_at: '2026-06-16T00:00:00Z',
  claim: 'multi-file repo-aware edits with auto test-repair loop', ratified_by: 'operator', ...o,
});
const demand = (o: Partial<HarvestedSignal> = {}): HarvestedSignal => ({
  kind: 'demand', source: 'cluster:auto-repair-on-fail', fetched_at: '2026-06-16T00:00:00Z',
  claim: 'users want the agent to iterate until tests pass unattended', ratified_by: 'operator', ...o,
});

test('normalizeBenchmarkScore reads 0-1 as pass_rate and clamps 0-10', () => {
  assert.equal(normalizeBenchmarkScore(0.65), 6.5);
  assert.equal(normalizeBenchmarkScore(1), 10);
  assert.equal(normalizeBenchmarkScore(7.2), 7.2);
  assert.equal(normalizeBenchmarkScore(99), 10);
  assert.equal(normalizeBenchmarkScore(-3), 0);
});

test('harvestTag + classifyBarProvenance round-trip', () => {
  assert.equal(harvestTag(bench()), 'harvest-benchmark:swe-bench-lite@6.5');
  assert.equal(harvestTag(cap()), 'harvest-capability:github.com/paul-gauthier/aider');
  const p = classifyBarProvenance('score-ladder:rows 8,9; harvest-benchmark:swe-bench-lite@6.5; harvest-capability:github.com/x');
  assert.equal(p.benchmark.length, 1);
  assert.equal(p.benchmark[0]!.suite, 'swe-bench-lite');
  assert.equal(p.benchmark[0]!.numeric, 6.5);
  assert.deepEqual(p.capability, ['github.com/x']);
  assert.ok(hasHarvestProvenance('harvest-demand:cluster:x'));
  assert.ok(!hasHarvestProvenance('score-ladder:rows 9'));
  assert.ok(!hasHarvestProvenance(undefined));
});

test('seedLeaderTargetFromHarvest fills TODO fields + score and tags provenance', () => {
  const spec = draftSpec();
  const r = seedLeaderTargetFromHarvest(spec, [bench(), cap(), demand()]);
  assert.ok(r.seeded.score && r.seeded.observed_capability && r.seeded.category_delta);
  assert.equal(spec.leader_target.score, 6.5);
  assert.match(spec.leader_target.observed_capability, /harvested — github.com\/paul-gauthier\/aider/);
  assert.match(spec.leader_target.category_delta!, /harvested — cluster:auto-repair-on-fail/);
  assert.ok(hasHarvestProvenance(spec.leader_target.evidence_ref));
});

test('seedLeaderTargetFromHarvest NEVER overwrites authored (non-TODO) fields', () => {
  const spec = draftSpec({ observed_capability: 'hand-authored real capability' });
  seedLeaderTargetFromHarvest(spec, [cap()]);
  assert.equal(spec.leader_target.observed_capability, 'hand-authored real capability');
});

test('checkHarvestProvenance is a no-op when disabled or target <= grounding threshold', () => {
  const spec = draftSpec();
  assert.ok(checkHarvestProvenance(spec, [], { enabled: false }).ok);
  const low = draftSpec(); low.target_score = 6.5;
  assert.ok(checkHarvestProvenance(low, [], { enabled: true }).ok);
});

test('checkHarvestProvenance: a non-harvested bar fails loudly (the laundering hole)', () => {
  const spec = draftSpec();
  spec.leader_target.evidence_ref = 'score-ladder:rows 8,9'; // ladder prose only — the soft spot
  const r = checkHarvestProvenance(spec, [], { enabled: true });
  assert.ok(!r.ok);
  assert.ok(r.errors.some(e => /not harvest-grounded/.test(e)));
});

test('checkHarvestProvenance: benchmark bar passes only when verified live', () => {
  const spec = draftSpec();
  seedLeaderTargetFromHarvest(spec, [bench({ verified_live: false })]);
  const unverified = checkHarvestProvenance(spec, [bench({ verified_live: false })], { enabled: true });
  assert.ok(!unverified.ok);
  assert.ok(unverified.errors.some(e => /not verified live/.test(e)));

  const spec2 = draftSpec();
  seedLeaderTargetFromHarvest(spec2, [bench({ verified_live: true })]);
  const verified = checkHarvestProvenance(spec2, [bench({ verified_live: true })], { enabled: true });
  assert.ok(verified.ok, verified.errors.join('; '));
});

test('checkHarvestProvenance: subjective bar passes only when ratified', () => {
  const spec = draftSpec();
  seedLeaderTargetFromHarvest(spec, [cap({ ratified_by: undefined })]);
  const unratified = checkHarvestProvenance(spec, [cap({ ratified_by: undefined })], { enabled: true });
  assert.ok(!unratified.ok);
  assert.ok(unratified.errors.some(e => /awaits ratification/.test(e)));

  const spec2 = draftSpec();
  seedLeaderTargetFromHarvest(spec2, [bench(), cap({ ratified_by: 'operator' })]);
  const ok = checkHarvestProvenance(spec2, [bench(), cap({ ratified_by: 'operator' })], { enabled: true });
  assert.ok(ok.ok, ok.errors.join('; '));
});

test('checkHarvestProvenance: a hand-written tag with no backing signal fails', () => {
  const spec = draftSpec();
  spec.leader_target.evidence_ref = 'harvest-benchmark:swe-bench-lite@9.9'; // forged tag, no record
  const r = checkHarvestProvenance(spec, [], { enabled: true });
  assert.ok(!r.ok);
  assert.ok(r.errors.some(e => /no backing harvested signal/.test(e)));
});
