// The autonomy-loop wiring (operator's core ask, council 2026-06-24): retry-decompose was a SLOGAN —
// routeStallAction returned { exec: null } and named "decompose" without producing any sub-problems. Now a stall
// fans into >=2 DEFINED children and resolveStall records them to the ledger via the canonical solveOrDecompose
// engine. These tests pin: (1) children are produced, (2) the result carries them, (3) resolveStall records them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decomposeStall,
  routeStallAction,
  resolveStall,
  type StallDiagnosis,
  type StallCategory,
} from '../src/core/frontier-course-corrector.js';
import type { ChildObstacle, DecompositionReceipt } from '../src/core/obstacle-decomposition.js';

function diag(category: StallCategory, rationale = 'the approach keeps tripping a gate'): StallDiagnosis {
  return {
    dimId: 'testing',
    category,
    action: 'retry-decompose',
    evidence: [{ kind: 'gate', detail: 'gate "anti-stub" failed' }],
    rationale,
  };
}

test('decomposeStall produces >=2 DEFINED children per stall category', () => {
  for (const cat of ['build-failed', 'no-op-build', 'wrong-approach'] as StallCategory[]) {
    const children = decomposeStall(diag(cat));
    assert.ok(children.length >= 2, `${cat} fans into >=2 children`);
    for (const c of children) {
      assert.ok(c.signal.length > 20, 'each child is an observably DEFINED problem, not noise');
      assert.ok(c.rationale.length > 0, 'each child explains why it is a genuine sub-problem');
    }
  }
});

test('routeStallAction retry-decompose is no longer a slogan — it carries children', () => {
  const r = routeStallAction(diag('wrong-approach'));
  assert.equal(r.exec, null);
  assert.equal(r.plateau, false);
  assert.ok(r.children && r.children.length >= 2, 'retry-decompose now produces real sub-problems');
});

test('routeStallAction non-decompose actions carry NO children (unchanged behavior)', () => {
  const ceil = routeStallAction({ ...diag('build-failed'), category: 'unbuildable', action: 'mark-unbuildable' });
  assert.equal(ceil.plateau, true);
  assert.equal(ceil.children, undefined);
});

test('resolveStall fans a retry-decompose stall into recorded ledger sub-problems', async () => {
  let recorded: ChildObstacle[] = [];
  const out = await resolveStall(diag('wrong-approach'), '/tmp/ps-test', {
    _recordStall: async (receipt: DecompositionReceipt) => {
      recorded = receipt.resolution.kind === 'decomposed' ? receipt.resolution.children : [];
      return recorded.map((_, i) => `CH-test-${i}`);
    },
  });
  assert.equal(out.plateau, false, 'a decomposable stall does not plateau — it becomes a worklist');
  assert.ok(recorded.length >= 2, 'resolveStall recorded the stall as >=2 tracked children (a wall → worklist)');
});

test('resolveStall with record:false does NOT record (dry-run safe)', async () => {
  let called = false;
  await resolveStall(diag('wrong-approach'), '/tmp/ps-test', {
    record: false,
    _recordStall: async () => { called = true; return []; },
  });
  assert.equal(called, false, 'record:false skips the ledger write');
});
