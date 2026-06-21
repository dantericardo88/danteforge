import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyChallenge, dispatchChallenges, type DispatchableChallenge } from '../src/core/challenge-dispatch.ts';

const ch = (id: string, title: string, problem = 'x', opportunity = 'y'): DispatchableChallenge =>
  ({ id, title, problem, opportunity, status: 'open' });

test('classifyChallenge routes each challenge to the lane that can (or cannot) close it', () => {
  assert.equal(classifyChallenge({ title: 'community_adoption needs real users', problem: 'spend' }).lane, 'capped');
  assert.equal(classifyChallenge({ title: 'run inside the grader Docker env', problem: 'env' }).lane, 'infra');
  assert.equal(classifyChallenge({ title: 'mint a SWE-bench-Live contamination-resistant receipt', problem: 'p' }).lane, 'external');
  assert.equal(classifyChallenge({ title: 'author T5 outcome + cold validate', problem: 'p' }).lane, 'outcome');
  assert.equal(classifyChallenge({ title: 'measure the improved solver (unmeasured hypothesis)', problem: 'p' }).lane, 'measure');
  assert.equal(classifyChallenge({ title: 'narrow the wide-blast-radius fix in the parser', problem: 'p' }).lane, 'code');
  // infra is checked before external: a "SWE-bench" challenge that needs Docker routes to infra (the real blocker)
  const c = classifyChallenge({ title: 'SWE-bench grader env mismatch needs docker', problem: 'p' });
  assert.equal(c.lane, 'infra');
  assert.equal(c.blockedBy, 'docker');
});

test('dispatchChallenges: world-capped → escalated, never fabricated', async () => {
  const s = await dispatchChallenges([ch('CH-1', 'community_adoption real users needed')]);
  assert.equal(s.outcomes[0]!.result, 'escalated');
  assert.equal(s.byLane.capped, 1);
});

test('dispatchChallenges: a lane with no handler is the honest build/provision worklist', async () => {
  const s = await dispatchChallenges([
    ch('CH-1', 'narrow the parser fix'),               // code, no handler
    ch('CH-2', 'run in the grader docker env'),        // infra, no handler
  ]);
  assert.equal(s.outcomes.every(o => o.result === 'no-handler'), true);
  assert.deepEqual(s.needsHandler.sort(), ['code', 'infra']);
  assert.equal(s.resolved, 0);
});

test('dispatchChallenges: a verified handler RESOLVES (and closes the ledger entry); a failing one BLOCKS', async () => {
  const resolved: string[] = [];
  const s = await dispatchChallenges(
    [ch('CH-1', 'narrow the parser fix'), ch('CH-2', 'narrow the other fix')],
    {
      handlers: {
        code: async (c) => (c.id === 'CH-1'
          ? { resolved: true, detail: 'implemented + verified in commit abc' }
          : { resolved: false, detail: 'tests still red' }),
      },
      resolve: async (id) => { resolved.push(id); },
    },
  );
  assert.equal(s.resolved, 1);
  assert.deepEqual(resolved, ['CH-1'], 'only a verified handler closes the ledger entry — never auto-declared');
  assert.equal(s.outcomes.find(o => o.id === 'CH-2')!.result, 'blocked');
});

test('dispatchChallenges only touches OPEN challenges + respects the maxDispatch budget', async () => {
  const all: DispatchableChallenge[] = [
    { ...ch('CH-1', 'a'), status: 'solved' },
    ch('CH-2', 'b'), ch('CH-3', 'c'), ch('CH-4', 'd'),
  ];
  const s = await dispatchChallenges(all, { maxDispatch: 2 });
  assert.equal(s.outcomes.length, 2, 'skips solved + caps at the budget');
});
