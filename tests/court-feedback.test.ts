// Pin for self-challenge findings #1 (blind retry) + #2 (bar↔goal disconnect): the next build
// attempt's goal must carry THE BAR the judges judge against and the judges' verbatim reasons.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { composeBuildGoal, recordCourtFeedback, loadCourtFeedback, parseCourtFeedback } from '../src/core/court-feedback.js';
import type { FrontierSpec } from '../src/core/frontier-spec.js';

const ROOT = path.join('X:\\tmp', `court-feedback-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

const SPEC = {
  version: 1, target_score: 9, status: 'frozen',
  leader_target: {
    competitor: 'LangGraph', score: 9,
    observed_capability: 'observed: runnable typed state graphs',
    category_delta: 'LangGraph-grade runnable PDSE: typed state graph with clarify/research/architecture nodes, checkpoints, resume',
  },
  real_user_path: { required_callsite: 'src/x.ts', run_command: 'node dist/index.js x {input}', observable_artifacts: [{ kind: 'file', path: 'out.json' }], realistic_inputs: ['a', 'b'] },
  required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
} as unknown as FrontierSpec;

describe('court-feedback — every rejection becomes a course correction', () => {
  test('the build goal carries THE BAR (category_delta) and the judges\' verbatim reasons', () => {
    const goal = composeBuildGoal('convergence_self_healing', SPEC, {
      dimId: 'convergence_self_healing', verdict: 'REJECTED',
      summary: 'FAIL: 0% weighted pass (2 judges)',
      dissent: ['[claude-0] The simulation dry-run does not demonstrate the 9-row capability — no typed state graph executes.'],
      recordedAt: new Date().toISOString(),
    });
    assert.match(goal, /LangGraph-grade runnable PDSE/, 'the ladder bar is IN the goal');
    assert.match(goal, /REJECTED/, 'the verdict is named');
    assert.match(goal, /no typed state graph executes/, 'judges\' reasons verbatim');
    assert.match(goal, /do not repeat the rejected approach/i);
  });

  test('first attempt (no feedback yet) still gets the bar; a VALIDATED verdict adds no objections', () => {
    const fresh = composeBuildGoal('d', SPEC, null);
    assert.match(fresh, /LangGraph-grade runnable PDSE/);
    assert.doesNotMatch(fresh, /VERDICT/);
    const validated = composeBuildGoal('d', SPEC, { dimId: 'd', verdict: 'VALIDATED', summary: 'PASS', dissent: ['minor note'], recordedAt: '' });
    assert.doesNotMatch(validated, /JUDGES/, 'a validated dim needs no objection list');
  });

  test('append-only history + repeated-objection tripwire (council lever 3 pin)', async () => {
    const { repeatedObjection } = await import('../src/core/court-feedback.js');
    const dir = path.join(ROOT, 'history');
    await fs.mkdir(dir, { recursive: true });
    const reject = (n: number, reason: string) => ({
      dimId: 'dim_h', verdict: 'REJECTED', summary: `FAIL: 0% (attempt ${n})`,
      dissent: [reason], recordedAt: new Date().toISOString(),
    });
    await recordCourtFeedback(dir, reject(1, '[judge-a] the artifact cannot demonstrate failure-injection recovery, only triage output'));
    let fb = await loadCourtFeedback(dir, 'dim_h');
    assert.equal(repeatedObjection(fb), false, 'one rejection is iteration, not a wall');

    await recordCourtFeedback(dir, reject(2, '[judge-b] the artifact cannot demonstrate failure-injection recovery, still triage output'));
    fb = await loadCourtFeedback(dir, 'dim_h');
    assert.equal(fb?.history?.length, 1, 'prior verdict preserved in history, never overwritten');
    assert.equal(repeatedObjection(fb), true, 'same core objection twice → stop rebuilding, repair the evidence');

    await recordCourtFeedback(dir, reject(3, '[judge-a] entirely different objection: receipts lack session diversity across inputs'));
    fb = await loadCourtFeedback(dir, 'dim_h');
    assert.equal(fb?.history?.length, 2);
    assert.equal(repeatedObjection(fb), false, 'a NEW objection means the build moved — keep iterating');
    assert.equal(repeatedObjection({ dimId: 'd', verdict: 'VALIDATED', summary: 'PASS', dissent: [], recordedAt: '' }), false);
  });

  test('record/load roundtrip + lenient parse of frontier-review --json stdout', async () => {
    const dir = path.join(ROOT, 'repo');
    await fs.mkdir(dir, { recursive: true });
    const fb = parseCourtFeedback('noise\n{"result":{"verdict":"REJECTED","vote":{"summary":"FAIL: 0%"},"dissent":["judge said X"]}}', 'dim_a', 'REJECTED');
    assert.equal(fb.summary, 'FAIL: 0%');
    assert.deepEqual(fb.dissent, ['judge said X']);
    await recordCourtFeedback(dir, fb);
    const loaded = await loadCourtFeedback(dir, 'dim_a');
    assert.equal(loaded?.dissent[0], 'judge said X');
    assert.equal(await loadCourtFeedback(dir, 'other_dim'), null);
    // Garbage stdout never throws — feedback is best-effort.
    const lenient = parseCourtFeedback('total garbage', 'dim_a', 'REJECTED');
    assert.equal(lenient.summary, '');
  });
});
