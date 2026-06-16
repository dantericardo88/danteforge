import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signHarvestedSignal,
  signedHarvestedSignal,
  verifyHarvestedSignalSignature,
} from '../src/core/harvested-signal-signer.ts';
import { seedLeaderTargetFromHarvest, checkHarvestProvenance, type HarvestedSignal } from '../src/core/harvested-bar.ts';
import type { FrontierSpec } from '../src/core/frontier-spec.ts';

const bench = (o: Partial<HarvestedSignal> = {}): HarvestedSignal => ({
  kind: 'benchmark', source: 'https://swebench.com', fetched_at: '2026-06-16T00:00:00Z',
  claim: 'top agent 65%', suite: 'swe-bench-lite', numeric: 0.65, verified_live: true, ...o,
});
const cap = (o: Partial<HarvestedSignal> = {}): HarvestedSignal => ({
  kind: 'capability', source: 'github.com/aider', fetched_at: '2026-06-16T00:00:00Z',
  claim: 'repo-aware edits', ratified_by: 'operator', ...o,
});

function spec(): FrontierSpec {
  return {
    version: 1, target_score: 9.0, status: 'draft',
    leader_target: { competitor: 'aider', score: 0, observed_capability: 'TODO', category_delta: 'TODO' },
    real_user_path: { required_callsite: 'src/x.ts', run_command: 'node dist/index.js solve', observable_artifacts: [{ kind: 'json', path: 'o.json' }] },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'external-benchmark' },
  };
}

test('signHarvestedSignal is deterministic over content', () => {
  assert.equal(signHarvestedSignal(bench()), signHarvestedSignal(bench()));
});

test('verifyHarvestedSignalSignature: signed passes, unsigned + tampered fail', () => {
  const s = signedHarvestedSignal(bench());
  assert.ok(verifyHarvestedSignalSignature(s));
  assert.ok(!verifyHarvestedSignalSignature(bench())); // no sig
  // tamper with a trust field after signing → signature no longer matches
  const tampered = { ...s, verified_live: true, numeric: 9.9 };
  assert.ok(!verifyHarvestedSignalSignature(tampered));
});

test('flipping verified_live false→true after signing invalidates the signature', () => {
  const honest = signedHarvestedSignal(bench({ verified_live: false }));
  const forged = { ...honest, verified_live: true }; // the exact self-set forgery CH-030 blocks
  assert.ok(!verifyHarvestedSignalSignature(forged));
});

test('gate with requireSigned: ratified-but-unsigned fails; signed passes', () => {
  const signals = [bench(), cap()];
  const sp = spec();
  seedLeaderTargetFromHarvest(sp, signals);

  // unsigned trust claims rejected under enforcement
  const unsigned = checkHarvestProvenance(sp, signals, { enabled: true, requireSigned: true });
  assert.ok(!unsigned.ok);
  assert.ok(unsigned.errors.some(e => /no valid kernel signature/.test(e)));

  // sign both → gate clears
  const sp2 = spec();
  const signedSignals = [signedHarvestedSignal(bench()), signedHarvestedSignal(cap())];
  seedLeaderTargetFromHarvest(sp2, signedSignals);
  const ok = checkHarvestProvenance(sp2, signedSignals, { enabled: true, requireSigned: true });
  assert.ok(ok.ok, ok.errors.join('; '));
});

test('gate without requireSigned still accepts unsigned (migration path)', () => {
  const signals = [bench(), cap()];
  const sp = spec();
  seedLeaderTargetFromHarvest(sp, signals);
  const ok = checkHarvestProvenance(sp, signals, { enabled: true, requireSigned: false });
  assert.ok(ok.ok, ok.errors.join('; '));
});
