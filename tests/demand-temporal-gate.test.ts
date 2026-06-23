import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHarvestProvenance, type HarvestedSignal } from '../src/core/harvested-bar.js';
import type { FrontierSpec } from '../src/core/frontier-spec.js';

// The anti-fabrication temporal gate, enforced in checkHarvestProvenance: a demand bar grounds a frontier score
// ONLY if the demand was FILED before the artifact build — post-hoc "demand" (filed to match what was shipped)
// is rejected. Fires when the caller supplies artifactBuiltAt (e.g. the earliest validate-receipt time).

function demandSpec(): FrontierSpec {
  return {
    version: 1, target_score: 9.0, status: 'frozen',
    leader_target: { competitor: 'harvested demand', score: 5, observed_capability: 'users want X', evidence_ref: 'harvest-demand:issue1' },
    real_user_path: { required_callsite: 'src/x.ts', run_command: 'node x', observable_artifacts: [{ kind: 'json', path: 'o.json' }] },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
  };
}
function demandSignal(over: Partial<HarvestedSignal> = {}): HarvestedSignal {
  return { kind: 'demand', source: 'issue1', fetched_at: '2026-06-23T00:00:00Z', claim: 'users want X', verified_live: true, ...over };
}
const BUILD = '2026-06-10T00:00:00Z';

test('temporal gate: demand filed BEFORE the build grounds it', () => {
  const r = checkHarvestProvenance(demandSpec(), [demandSignal({ demand_created_at: '2026-06-01T00:00:00Z' })], { enabled: true, artifactBuiltAt: BUILD });
  assert.ok(r.ok, r.errors.join('; '));
});

test('temporal gate: demand filed AT/AFTER the build is REJECTED (post-hoc anti-fabrication)', () => {
  const r = checkHarvestProvenance(demandSpec(), [demandSignal({ demand_created_at: '2026-06-15T00:00:00Z' })], { enabled: true, artifactBuiltAt: BUILD });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /post-hoc|at\/after the artifact/i.test(e)), r.errors.join('; '));
});

test('temporal gate: a demand with NO createdAt is FAIL-CLOSED when a build time is supplied', () => {
  const r = checkHarvestProvenance(demandSpec(), [demandSignal({})], { enabled: true, artifactBuiltAt: BUILD });
  assert.equal(r.ok, false);
});

test('temporal gate: omitting artifactBuiltAt skips the check (backward-compatible)', () => {
  const r = checkHarvestProvenance(demandSpec(), [demandSignal({})], { enabled: true });
  assert.ok(r.ok, r.errors.join('; '));
});
