import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planNextAction, isDimDone, reconcileAuditVerdict, type DimState } from '../src/core/ascend-frontier-engine.js';
import type { CeilingReceipt } from '../src/core/ceiling-receipt.js';

const NOW = '2026-06-03T00:00:00.000Z';
const OPTS = { maxAttemptsPerDim: 3, nowIso: NOW };

function dim(over: Partial<DimState> = {}): DimState {
  return { id: 'd', effectiveScore: 7.0, frontierStatus: 'frozen', ceiling: null, attempts: 0, isMarketCapped: false, ...over };
}
function ceiling(over: Partial<CeilingReceipt> = {}): CeilingReceipt {
  return { dimId: 'd', cap: 5.0, cause: 'market-cap', detail: '', failedGates: [], recordedAt: NOW, ...over };
}

describe('planNextAction — honest autonomous sequencing', () => {
  test('dims needing setup → setup first', () => {
    const a = planNextAction([dim({ id: 'a', needsSetup: true }), dim({ id: 'b' })], OPTS);
    assert.deepEqual(a, { type: 'setup', dims: ['a'] });
  });

  test('market-capped dim → write a market-cap ceiling (not pushed forever)', () => {
    const a = planNextAction([dim({ id: 'enterprise', effectiveScore: 5.0, isMarketCapped: true })], OPTS);
    assert.equal(a.type, 'ceiling');
    assert.equal((a as { cause: string }).cause, 'market-cap');
  });

  test('any dim below 7 → build-to-7 (breadth phase)', () => {
    const a = planNextAction([dim({ id: 'a', effectiveScore: 5.5 }), dim({ id: 'b', effectiveScore: 7.0 })], OPTS);
    assert.deepEqual(a, { type: 'build-to-7', dims: ['a'] });
  });

  test('all ≥7, not done → push the WEAKEST incomplete dim', () => {
    const a = planNextAction([dim({ id: 'a', effectiveScore: 8.0 }), dim({ id: 'b', effectiveScore: 7.0 })], OPTS);
    assert.deepEqual(a, { type: 'push-to-9', dimId: 'b' });
  });

  test('skipDims excludes a dim from EVERY selection (the cloud-only code_generation guard)', () => {
    const dims = [dim({ id: 'code_generation', effectiveScore: 4.0 }), dim({ id: 'safe', effectiveScore: 7.5 })];
    // Without skip, the below-7 dim is selected for build-to-7 (would trigger the heavy cloud grade):
    assert.deepEqual(planNextAction(dims, OPTS), { type: 'build-to-7', dims: ['code_generation'] });
    // With skip, code_generation never appears in ANY selected action — the loop advances to the safe dim:
    const withSkip = planNextAction(dims, { ...OPTS, skipDims: ['code_generation'] });
    assert.equal(withSkip.type, 'push-to-9');
    assert.ok(!JSON.stringify(withSkip).includes('code_generation'), 'a skipped dim must never be selected');
  });

  test('a dim that exhausted novel attempts → generator-ceiling (no infinite grind)', () => {
    // below its honest ceiling (7.5 < 8.0) so it's still a candidate, but out of attempts → generator-ceiling.
    const a = planNextAction([dim({ id: 'a', effectiveScore: 7.5, attempts: 3 })], OPTS);
    assert.equal(a.type, 'ceiling');
    assert.equal((a as { cause: string }).cause, 'generator-ceiling');
  });

  test('FINISH-mode: a no-demand dim at 8.0 is FINISHED (not pushed to 9); a demand-bound dim at 8.0 IS pushed', () => {
    const finished = planNextAction([dim({ id: 'a', effectiveScore: 8.0 })], OPTS);
    assert.equal(finished.type, 'done');
    assert.match((finished as { summary: string }).summary, /BUILD-COMPLETE/);
    const pushed = planNextAction([dim({ id: 'a', effectiveScore: 8.0, demandBound: true })], OPTS);
    assert.equal(pushed.type, 'push-to-9');
  });

  test('validated-at-9 and active-ceiling dims are complete → done', () => {
    const dims = [
      dim({ id: 'a', effectiveScore: 9.0, frontierStatus: 'validated' }),
      dim({ id: 'b', effectiveScore: 5.0, ceiling: ceiling({ dimId: 'b' }) }),
    ];
    const a = planNextAction(dims, OPTS);
    assert.equal(a.type, 'done');
  });

  test('an EXPIRED env ceiling is not done → the dim is re-attempted', () => {
    const expired = ceiling({ dimId: 'a', cause: 'environment', reviewAfter: '2026-05-01T00:00:00.000Z' });
    const a = planNextAction([dim({ id: 'a', effectiveScore: 7.0, ceiling: expired })], OPTS);
    assert.equal(a.type, 'push-to-9', 'expired ceiling re-opens the dim');
  });

  test('STALLED setup (attempts exhausted) → ceiling, so one stuck dim never wedges the loop', () => {
    const a = planNextAction([dim({ id: 'stuck', needsSetup: true, setupAttempts: 3 }), dim({ id: 'b', effectiveScore: 6.0 })], OPTS);
    assert.equal(a.type, 'ceiling');
    assert.equal((a as { dimId: string }).dimId, 'stuck');
    assert.equal((a as { cause: string }).cause, 'generator-ceiling');
  });

  test('setup with attempts REMAINING still runs setup (not ceilinged prematurely)', () => {
    const a = planNextAction([dim({ id: 'a', needsSetup: true, setupAttempts: 1 })], OPTS);
    assert.deepEqual(a, { type: 'setup', dims: ['a'] });
  });

  test('STALLED build-to-7 (un-buildable dim) → ceiling, letting the loop advance to push-to-9', () => {
    const a = planNextAction([dim({ id: 'gostuck', effectiveScore: 6.0, buildAttempts: 3 }), dim({ id: 'ok', effectiveScore: 8.0 })], OPTS);
    assert.equal(a.type, 'ceiling');
    assert.equal((a as { dimId: string }).dimId, 'gostuck');
  });

  test('build-to-7 with attempts remaining still builds (not ceilinged prematurely)', () => {
    const a = planNextAction([dim({ id: 'a', effectiveScore: 6.0, buildAttempts: 1 })], OPTS);
    assert.deepEqual(a, { type: 'build-to-7', dims: ['a'] });
  });

  test('maxBuildAttempts is independent of push maxAttemptsPerDim', () => {
    const a = planNextAction([dim({ id: 'a', effectiveScore: 6.0, buildAttempts: 2 })], { ...OPTS, maxBuildAttempts: 2 });
    assert.equal(a.type, 'ceiling', 'buildAttempts 2 >= maxBuildAttempts 2 → ceiling even though push max is 3');
  });

  test('isDimDone: validated-9, active ceiling, or no-demand BUILD-COMPLETE; demand-bound frozen-8 is NOT done', () => {
    assert.equal(isDimDone(dim({ effectiveScore: 9.0, frontierStatus: 'validated' }), NOW), true);
    assert.equal(isDimDone(dim({ ceiling: ceiling() }), NOW), true);
    // FINISH-mode: a NO-demand dim at 8.0 is BUILD-COMPLETE = done; a DEMAND-bound dim at 8.0 still needs 9.
    assert.equal(isDimDone(dim({ effectiveScore: 8.0, frontierStatus: 'frozen' }), NOW), true);
    assert.equal(isDimDone(dim({ effectiveScore: 8.0, frontierStatus: 'frozen', demandBound: true }), NOW), false);
    assert.equal(isDimDone(dim({ effectiveScore: 7.5, frontierStatus: 'frozen' }), NOW), false);
  });
});

describe('reconcileAuditVerdict — CH-027 human audit propagation', () => {
  test('a FAILED audit on a validated dim → downgraded away from validated + audit-failed ceiling minted', () => {
    const r = reconcileAuditVerdict({ dimId: 'd', frontierStatus: 'validated', ceiling: null, score: 9.0, hasFailedAudit: true, nowIso: NOW });
    assert.notEqual(r.frontierStatus, 'validated', 'a human-rejected dim can no longer read as a validated frontier 9');
    assert.equal(r.ceiling?.cause, 'audit-failed');
    assert.ok(r.mintedCeiling, 'a fresh ceiling is minted for the caller to persist');
    assert.ok((r.ceiling?.cap ?? 99) <= 8.0, 'held at or below the frontier-gate cap');
    // The loop treats it done via the CEILING (stops the re-push) — not via a fake validated status.
    assert.equal(isDimDone(dim({ id: 'd', frontierStatus: r.frontierStatus, ceiling: r.ceiling }), NOW), true);
  });

  test('a FAILED audit with an existing audit-failed ceiling is idempotent (not re-minted each cycle)', () => {
    const existing = ceiling({ dimId: 'd', cause: 'audit-failed', cap: 8.0 });
    const r = reconcileAuditVerdict({ dimId: 'd', frontierStatus: 'frozen', ceiling: existing, score: 8.0, hasFailedAudit: true, nowIso: NOW });
    assert.equal(r.mintedCeiling, null);
    assert.equal(r.ceiling, existing);
  });

  test('a RESOLVED audit clears a lingering audit-failed ceiling → the dim re-opens for another push', () => {
    const stale = ceiling({ dimId: 'd', cause: 'audit-failed', cap: 8.0 });
    const r = reconcileAuditVerdict({ dimId: 'd', frontierStatus: 'frozen', ceiling: stale, score: 8.0, hasFailedAudit: false, nowIso: NOW });
    assert.equal(r.ceiling, null, 'the human rejection no longer holds → re-open');
    assert.equal(isDimDone(dim({ id: 'd', frontierStatus: 'frozen', ceiling: r.ceiling }), NOW), false);
  });

  test('no audit failure leaves an unrelated ceiling untouched', () => {
    const mc = ceiling({ dimId: 'd', cause: 'market-cap' });
    const r = reconcileAuditVerdict({ dimId: 'd', frontierStatus: 'frozen', ceiling: mc, score: 5.0, hasFailedAudit: false, nowIso: NOW });
    assert.equal(r.ceiling, mc);
    assert.equal(r.mintedCeiling, null);
  });
});
