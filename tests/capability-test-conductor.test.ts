import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planRemediation, remediateYardsticks, MARKET_CAPPED_DIMS, type ConductorContext } from '../src/matrix/engines/capability-test-conductor.js';
import type { YardstickAudit, YardstickVerdict } from '../src/matrix/engines/capability-test-integrity.js';
import type { AuthorResult } from '../src/matrix/engines/capability-test-author.js';

function audit(dimId: string, verdict: YardstickVerdict, hasLadder: boolean): YardstickAudit {
  const needsAuthoring = !(verdict === 'REAL_TEST' || verdict === 'REAL_PRODUCT_PROBE');
  return { dimId, verdict, command: 'x', wiredCallsites: [], hasLadder, reason: '', needsAuthoring };
}

describe('planRemediation — the conductor routing brain', () => {
  test('REAL yardstick → PROCEED (the build loop can grip it)', () => {
    assert.equal(planRemediation(audit('a', 'REAL_TEST', true), false).action, 'PROCEED');
    assert.equal(planRemediation(audit('a', 'REAL_PRODUCT_PROBE', false), false).action, 'PROCEED');
  });
  test('stub WITH a ladder → AUTHOR_YARDSTICK', () => {
    assert.equal(planRemediation(audit('a', 'SELF_FULFILLING_STUB', true), false).action, 'AUTHOR_YARDSTICK');
  });
  test('stub WITHOUT a ladder → RESEARCH_LADDER first (bar must be grounded)', () => {
    assert.equal(planRemediation(audit('a', 'SELF_FULFILLING_STUB', false), false).action, 'RESEARCH_LADDER');
    assert.equal(planRemediation(audit('a', 'SCAFFOLD', false), false).action, 'RESEARCH_LADDER');
  });
  test('market-capped dim → CEILING, never authored (no fabricated adoption)', () => {
    assert.equal(planRemediation(audit('enterprise_readiness', 'SELF_FULFILLING_STUB', true), true).action, 'CEILING');
    assert.ok(MARKET_CAPPED_DIMS.has('community_adoption'));
  });
});

describe('remediateYardsticks — autonomous self-healing pass', () => {
  function ctx(over: Partial<ConductorContext> = {}): ConductorContext {
    return {
      authorFn: async (dimId): Promise<AuthorResult> => ({ dimId, installed: true, reason: 'installed real RED yardstick' }),
      researchLadderFn: async () => ({ ok: true, reason: 'authored ladder' }),
      ...over,
    };
  }

  test('authors stubs, proceeds on real, ceilings market-capped — in one pass', async () => {
    const audits = [
      audit('real', 'REAL_TEST', true),
      audit('stub', 'SELF_FULFILLING_STUB', true),
      audit('enterprise_readiness', 'SCAFFOLD', true),
    ];
    const r = await remediateYardsticks(audits, ctx());
    assert.equal(r.counts.PROCEED, 1);
    assert.equal(r.counts.AUTHORED, 1);
    assert.equal(r.counts.CEILING, 1);
  });

  test('RESEARCH_LADDER dim is researched THEN authored in the same pass', async () => {
    let researched = false, authored = false;
    const r = await remediateYardsticks([audit('noladder', 'SELF_FULFILLING_STUB', false)], ctx({
      researchLadderFn: async () => { researched = true; return { ok: true, reason: 'ok' }; },
      authorFn: async (dimId) => { authored = true; return { dimId, installed: true, reason: 'ok' }; },
    }));
    assert.ok(researched && authored, 'research must precede authoring');
    assert.equal(r.outcomes[0]!.status, 'AUTHORED');
    assert.equal(r.outcomes[0]!.ladderResearched, true);
  });

  test('a rejected authoring (green stub the gate caught) is recorded AUTHOR_REJECTED, not installed', async () => {
    const r = await remediateYardsticks([audit('stub', 'SELF_FULFILLING_STUB', true)], ctx({
      authorFn: async (dimId) => ({ dimId, installed: false, reason: 'rejected (reverted): red gate GREEN' }),
    }));
    assert.equal(r.counts.AUTHOR_REJECTED, 1);
  });

  test('sensitivity probe: a PROCEED metric the probe finds DECOUPLED is re-routed to authoring', async () => {
    let authored = false;
    const r = await remediateYardsticks([audit('fake-real', 'REAL_PRODUCT_PROBE', true)], ctx({
      verifyRealFn: async () => 'STUB',
      authorFn: async (dimId) => { authored = true; return { dimId, installed: true, reason: 'ok' }; },
    }));
    assert.ok(authored, 'a decoupled "real" metric must be re-authored, not trusted');
    assert.equal(r.outcomes[0]!.action, 'AUTHOR_YARDSTICK');
    assert.equal(r.counts.AUTHORED, 1);
  });

  test('sensitivity probe: a GENUINE metric stays PROCEED (verified by execution)', async () => {
    const r = await remediateYardsticks([audit('real', 'REAL_TEST', true)], ctx({ verifyRealFn: async () => 'GENUINE' }));
    assert.equal(r.counts.PROCEED, 1);
    assert.match(r.outcomes[0]!.detail ?? '', /GENUINE/);
  });

  test('without verifyRealFn, PROCEED is trusted statically (back-compat)', async () => {
    const r = await remediateYardsticks([audit('real', 'REAL_TEST', true)], ctx());
    assert.equal(r.counts.PROCEED, 1);
  });

  test('budget guard skips remaining authoring work (fleet-scale bound)', async () => {
    let calls = 0;
    const r = await remediateYardsticks([audit('s1', 'SELF_FULFILLING_STUB', true), audit('s2', 'SELF_FULFILLING_STUB', true)], ctx({
      hasBudget: () => false,
      authorFn: async (dimId) => { calls++; return { dimId, installed: true, reason: 'ok' }; },
    }));
    assert.equal(calls, 0, 'no authoring when budget exhausted');
    assert.equal(r.counts.SKIPPED, 2);
  });
});
