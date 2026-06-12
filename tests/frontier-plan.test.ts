// Pins for the BUILD PLAN engine (CH-014): deterministic-gated items, never builder-asserted;
// malformed/softened plans install NOTHING; re-frozen specs invalidate plans; audit fails closed.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parsePlanItems, parseAuditVerdict, planComplete, nextItems, refreshPlanItems,
  saveFrontierPlan, loadFrontierPlan, decomposeFrontierPlan, type FrontierPlan,
} from '../src/core/frontier-plan.js';
import type { FrontierSpec } from '../src/core/frontier-spec.js';

const ROOT = path.join('X:\\tmp', `frontier-plan-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

const GOOD_ITEMS = JSON.stringify([
  { title: 'Sandboxed execution kernel', what: 'Implement a sandboxed runner module that executes agent commands inside an isolated worktree with resource caps.', capability_test: { command: 'npx tsx --test tests/sandbox-kernel.test.ts' } },
  { title: 'Durable pause/resume', what: 'Persist runner state so a paused execution resumes byte-identical after process restart, covering open leases.', capability_test: { command: 'node dist/index.js runner-demo --pause-resume-check' } },
  { title: 'Replay/fork from checkpoint', what: 'Add checkpoint replay and fork so any prior step can be re-executed deterministically with diverging continuations.', capability_test: { command: 'npx tsx --test tests/replay-fork.test.ts' } },
]);

function spec(hash: string): FrontierSpec {
  return {
    version: 1, target_score: 9, status: 'frozen', frozen_hash: hash,
    leader_target: { competitor: 'OpenHands', score: 9, observed_capability: 'runtime kernel', category_delta: 'OpenHands-grade runtime kernel: sandboxed execution, durable pause/resume, replay/fork' },
    real_user_path: { required_callsite: 'src/x.ts', run_command: 'node dist/index.js x {input}', observable_artifacts: [{ kind: 'file', path: 'out.json' }], realistic_inputs: ['a', 'b'] },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
  } as unknown as FrontierSpec;
}

describe('frontier-plan — the bar becomes a deterministic checklist, never an easy exam', () => {
  test('parsePlanItems: valid plans parse; vague/TODO/too-few plans install NOTHING', () => {
    const items = parsePlanItems(`Here is the plan:\n${GOOD_ITEMS}\nDone.`);
    assert.equal(items.length, 3);
    assert.equal(items[0]!.id, 'it-01');
    assert.equal(items[0]!.status, 'todo');
    assert.equal(parsePlanItems('[]').length, 0, 'too few');
    assert.equal(parsePlanItems('[{"title":"x","what":"short","capability_test":{"command":"node t"}}]').length, 0);
    assert.equal(parsePlanItems(JSON.stringify([
      { title: 'A real item title', what: 'A sufficiently long and concrete build instruction here.', capability_test: { command: 'TODO: write one' } },
      { title: 'Another item title', what: 'Another sufficiently long and concrete build instruction.', capability_test: { command: 'node ok' } },
    ])).length, 0, 'a TODO gate poisons the whole plan');
    assert.equal(parsePlanItems('no json at all').length, 0);
  });

  test('items complete ONLY by their gate exiting 0; flips persist; plan completes', async () => {
    const dir = path.join(ROOT, 'repo');
    await fs.mkdir(dir, { recursive: true });
    const plan: FrontierPlan = {
      dimId: 'dim_p', bar: 'the bar', barHash: 'h1',
      items: parsePlanItems(GOOD_ITEMS), createdAt: new Date().toISOString(),
    };
    await saveFrontierPlan(dir, plan);
    // Gate 1 passes, gates 2-3 still red.
    const pass = new Set(['npx tsx --test tests/sandbox-kernel.test.ts']);
    let r = await refreshPlanItems(dir, plan, async (cmd) => (pass.has(cmd) ? 0 : 1));
    assert.deepEqual(r.flipped, ['it-01']);
    assert.equal(planComplete(plan), false);
    assert.equal(nextItems(plan, 2).length, 2);
    const reloaded = await loadFrontierPlan(dir, 'dim_p');
    assert.equal(reloaded?.items[0]?.status, 'done', 'flips persist to disk');
    // All gates green → complete.
    r = await refreshPlanItems(dir, plan, async () => 0);
    assert.equal(r.flipped.length, 2);
    assert.equal(planComplete(plan), true);
  });

  test('decompose installs only an AUDIT-PASSED plan; audit fails closed on garbage', async () => {
    const dir = path.join(ROOT, 'repo2');
    await fs.mkdir(dir, { recursive: true });
    const calls: string[] = [];
    const okMember = async (id: string, prompt: string) => {
      calls.push(id);
      return prompt.includes('VERDICT') ? 'VERDICT: PASS — covers all three capabilities' : GOOD_ITEMS;
    };
    const plan = await decomposeFrontierPlan(dir, 'dim_a', spec('hash1'), ['codex', 'claude-code'], okMember);
    assert.ok(plan, 'audited plan installs');
    assert.equal(plan!.decompositionAudit?.verdict, 'PASS');
    assert.equal(calls[0], 'codex', 'first member decomposes');
    assert.equal(calls[1], 'claude-code', 'a DIFFERENT member audits');

    const failAudit = async (_id: string, prompt: string) =>
      prompt.includes('VERDICT') ? 'VERDICT: FAIL — item 2 gate is vacuous' : GOOD_ITEMS;
    assert.equal(await decomposeFrontierPlan(dir, 'dim_b', spec('h'), ['codex', 'claude-code'], failAudit), null, 'audit FAIL installs nothing');
    const garbled = async () => 'no verdict here';
    assert.equal(await decomposeFrontierPlan(dir, 'dim_c', spec('h'), ['codex'], garbled), null, 'garbled responses fail closed');
    assert.equal(parseAuditVerdict('???').verdict, 'FAIL');
  });
});
