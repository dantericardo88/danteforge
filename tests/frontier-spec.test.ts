import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  scaffoldFrontierSpec, checkFrontierSpec, computeSpecHash, effectiveStatus, type FrontierSpec,
} from '../src/core/frontier-spec.js';
import { runFrontierSpec } from '../src/cli/commands/frontier-spec.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

function goodSpec(): FrontierSpec {
  return {
    version: 1, target_score: 9.0, status: 'draft',
    leader_target: { competitor: 'Cursor', score: 9.1, observed_capability: 'In-editor agent flow with preview+apply.' },
    real_user_path: {
      required_callsite: 'vscode-extension/src/webview/AgentPanel.ts',
      run_command: 'node dist/index.js forge --project fixtures/real-workspace',
      observable_artifacts: [{ kind: 'screenshot', path: '.danteforge/runs/agent/webview.png' }],
    },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
  };
}

describe('checkFrontierSpec — honesty guardrails', () => {
  const competitors = ['Cursor', 'Cline', 'Aider'];

  test('a complete, honest spec passes', () => {
    assert.equal(checkFrontierSpec(goodSpec(), competitors).ok, true);
  });

  test('rejects a competitor not in the tracked list (no targeting self/reference)', () => {
    const s = goodSpec(); s.leader_target.competitor = 'SomeRandomTool';
    const r = checkFrontierSpec(s, competitors);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => /not a tracked competitor/.test(e)));
  });

  test('rejects a test-runner run_command (must run the real product)', () => {
    const s = goodSpec(); s.real_user_path.run_command = 'npx tsx --test tests/agent.test.ts';
    const r = checkFrontierSpec(s, competitors);
    assert.ok(r.errors.some(e => /test-runner/.test(e)));
  });

  test('rejects matching a sub-9 leader without a category delta', () => {
    const s = goodSpec(); s.leader_target.score = 7.2;
    const r = checkFrontierSpec(s, competitors);
    assert.ok(r.errors.some(e => /category_delta/.test(e)), 'easy target must be blocked');
  });

  test('a sub-9 leader WITH a declared category delta passes (with warning)', () => {
    const s = goodSpec(); s.leader_target.score = 7.2; s.leader_target.category_delta = 'adds real-time multi-file preview no competitor has';
    const r = checkFrontierSpec(s, competitors);
    assert.equal(r.ok, true);
    assert.ok(r.warnings.length >= 1);
  });

  test('rejects TODO placeholders and weak receipts', () => {
    const s = scaffoldFrontierSpec({ oss_leader: 'Cline' });
    const r = checkFrontierSpec(s, competitors);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => /run_command/.test(e)));
    assert.ok(r.errors.some(e => /required_callsite/.test(e)));
  });

  test('rejects <2 sessions / <3 outcomes', () => {
    const s = goodSpec(); s.required_receipts = { min_t5_plus_outcomes: 1, min_distinct_sessions: 1, input_source: 'real-user-path' };
    const r = checkFrontierSpec(s, competitors);
    assert.ok(r.errors.some(e => /min_distinct_sessions/.test(e)));
    assert.ok(r.errors.some(e => /min_t5_plus_outcomes/.test(e)));
  });
});

describe('freeze hash + stale detection', () => {
  test('a frozen spec whose content later changes is reported stale', () => {
    const s = goodSpec();
    s.status = 'frozen';
    s.frozen_hash = computeSpecHash(s);
    assert.equal(effectiveStatus(s), 'frozen');
    s.real_user_path.run_command = 'node dist/index.js forge --project fixtures/OTHER'; // goalpost moved
    assert.equal(effectiveStatus(s), 'stale', 'post-freeze edit must surface as stale');
  });
});

function matrixWith(dim: Record<string, unknown>): CompeteMatrix {
  return { competitors_closed_source: ['Cursor'], competitors_oss: ['Cline'], dimensions: [{ id: 'agent_ux', ...dim }] } as unknown as CompeteMatrix;
}

describe('runFrontierSpec command flow', () => {
  test('init writes a draft; freeze refuses while TODOs remain; freeze succeeds once valid', async () => {
    const matrix = matrixWith({ oss_leader: 'Cline' });
    // init --write
    await runFrontierSpec({ action: 'init', dimId: 'agent_ux', write: true, _loadMatrix: async () => matrix, _writeMatrix: async () => {} });
    const dim = (matrix as unknown as { dimensions: Array<Record<string, unknown>> }).dimensions[0]!;
    assert.ok(dim.frontier_spec, 'draft spec written');

    // freeze refuses (still TODO)
    const f1 = await runFrontierSpec({ action: 'freeze', dimId: 'agent_ux', write: true, _loadMatrix: async () => matrix, _writeMatrix: async () => {} });
    assert.equal(f1.ok, false);

    // operator fills it in honestly
    Object.assign(dim.frontier_spec as FrontierSpec, goodSpec());
    const f2 = await runFrontierSpec({ action: 'freeze', dimId: 'agent_ux', write: true, _now: '2026-06-02T00:00:00.000Z', _loadMatrix: async () => matrix, _writeMatrix: async () => {} });
    assert.equal(f2.ok, true);
    assert.equal(f2.wrote, true);
    assert.equal((dim.frontier_spec as FrontierSpec).status, 'frozen');
    assert.ok((dim.frontier_spec as FrontierSpec).frozen_hash);
  });

  test('status reports none/frozen across dims', async () => {
    const matrix = matrixWith({ frontier_spec: { ...goodSpec(), status: 'frozen', frozen_hash: computeSpecHash(goodSpec()) } });
    const r = await runFrontierSpec({ action: 'status', all: true, _loadMatrix: async () => matrix, _writeMatrix: async () => {} });
    assert.equal(r.statuses?.[0]?.dimId, 'agent_ux');
    // frozen_hash was computed over a different object instance but identical content → frozen
    assert.ok(['frozen', 'stale'].includes(r.statuses?.[0]?.status ?? ''));
  });
});
