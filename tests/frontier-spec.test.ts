import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  scaffoldFrontierSpec, seedLeaderTargetFromLadder, checkFrontierSpec, computeSpecHash, effectiveStatus, type FrontierSpec,
} from '../src/core/frontier-spec.js';
import { runFrontierSpec } from '../src/cli/commands/frontier-spec.js';
import { applyFrontierGate } from '../src/cli/commands/validate.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';
import type { DimensionRubricLevel } from '../src/matrix/types/dimension-graph.js';

function goodSpec(): FrontierSpec {
  return {
    version: 1, target_score: 9.0, status: 'draft',
    leader_target: { competitor: 'Cursor', score: 9.1, observed_capability: 'In-editor agent flow with preview+apply.' },
    real_user_path: {
      required_callsite: 'vscode-extension/src/webview/AgentPanel.ts',
      run_command: 'node dist/index.js forge --project {input}',
      realistic_inputs: ['fixtures/real-workspace', 'fixtures/other-workspace'],
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

describe('scaffoldFrontierSpec — honest auto-derivation (never fabricate, never target self)', () => {
  test('derives the highest-scoring TRACKED peer (not self) + run_command/callsite; leaves only human fields TODO', () => {
    const dim = {
      id: 'planning_quality',
      scores: { self: 9, 'Kiro (AWS)': 8.5, Cursor: 6.5, derived: 7 },
      oss_leader: 'self', closed_source_leader: 'self',
      capability_test: { command: 'node dist/index.js plan --help' },
      outcomes: [
        { id: 'b', tier: 'T2', required_callsite: 'src/core/task-router.ts' },
        { id: 'a', tier: 'T4', required_callsite: 'src/core/plan-quality-scorer.ts' },
      ],
    };
    const s = scaffoldFrontierSpec(dim);
    assert.equal(s.leader_target.competitor, 'Kiro (AWS)', 'targets the highest-scoring tracked peer, never self');
    assert.equal(s.leader_target.score, 8.5);
    assert.equal(s.real_user_path.run_command, 'node dist/index.js plan --help', 'run_command derived from the product capability_test');
    assert.equal(s.real_user_path.required_callsite, 'src/core/plan-quality-scorer.ts', 'callsite from the highest-tier grounded outcome');
    assert.ok(s.leader_target.category_delta && /TODO/.test(s.leader_target.category_delta), 'a sub-9 leader gets a category_delta TODO to author');

    // The honest residue: competitor + run_command are NOT violations (auto-derived); only the
    // genuinely-human fields remain — which is exactly the actionable build-list the ceiling reports.
    const r = checkFrontierSpec(s, ['Kiro (AWS)', 'Cursor']);
    assert.equal(r.ok, false, 'still incomplete — the human fields need authoring');
    assert.ok(!r.errors.some(e => /competitor/.test(e)), 'competitor auto-derived → not a violation');
    assert.ok(!r.errors.some(e => /run_command/.test(e)), 'run_command auto-derived → not a violation');
    assert.ok(!r.errors.some(e => /required_callsite/.test(e)), 'callsite auto-derived → not a violation');
    assert.ok(r.errors.some(e => /observed_capability/.test(e)), 'observed_capability flagged — the real human work');
    assert.ok(r.errors.some(e => /observable_artifacts/.test(e)), 'observable_artifacts flagged');
    assert.ok(r.errors.some(e => /category_delta/.test(e)), 'category_delta flagged for the sub-9 leader');
  });

  test('a test-runner capability_test is NOT seeded as run_command (9.0 needs a real product run)', () => {
    const s = scaffoldFrontierSpec({ id: 'x', scores: { 'Kiro (AWS)': 8.5 }, capability_test: { command: 'npx tsx --test tests/x.test.ts' } });
    assert.ok(/TODO/.test(s.real_user_path.run_command), 'a test-runner probe cannot honestly become the product run_command');
  });

  test('no scores + no capability_test → all TODO (nothing to fabricate)', () => {
    const s = scaffoldFrontierSpec({ id: 'y' });
    assert.ok(/TODO/.test(s.leader_target.competitor));
    assert.ok(/TODO/.test(s.real_user_path.run_command));
    assert.ok(/TODO/.test(s.real_user_path.required_callsite));
  });
});

describe('seedLeaderTargetFromLadder — ground the 9.0 bar in the competitor-grounded Score Ladder', () => {
  const ladder: DimensionRubricLevel[] = [
    { score: 7, descriptor: 'Heuristic planner with templated phases.' },
    { score: 8, descriptor: 'Kiro-grade spec workflow: clarify + plan + tasks with hard gates.' },
    { score: 9, descriptor: 'LangGraph-grade runnable PDSE: a typed state graph with clarify/research/architecture/risk/tasking nodes.' },
    { score: 10, descriptor: 'Cross-assistant planning control plane across Claude Code, Codex, Cursor, Aider.' },
  ];

  test('fills observed_capability (competitor-score row) + category_delta (target rung) VERBATIM, with provenance', () => {
    const s = scaffoldFrontierSpec({ id: 'planning_quality', scores: { 'Kiro (AWS)': 8.5 } });
    assert.ok(/TODO/.test(s.leader_target.observed_capability), 'pre-seed: TODO');
    const res = seedLeaderTargetFromLadder(s, ladder);

    assert.equal(res.seeded.observed_capability, true);
    assert.equal(res.seeded.category_delta, true);
    assert.deepEqual(res.ladder_rows_used, [8, 9], 'observed=row at/below competitor 8.5; delta=row at/above target 9.0');
    assert.ok(/Kiro-grade spec workflow/.test(s.leader_target.observed_capability), 'observed_capability copied from the 8-row');
    assert.ok(/LangGraph-grade runnable PDSE/.test(s.leader_target.category_delta ?? ''), 'category_delta copied from the 9-row');
    assert.ok(/score-ladder:rows 8,9/.test(s.leader_target.evidence_ref ?? ''), 'provenance stamped');

    // The seeded fields are no longer flagged as the human TODO work.
    const r = checkFrontierSpec(s, ['Kiro (AWS)'], ladder);
    assert.ok(!r.errors.some(e => /observed_capability/.test(e)), 'observed_capability now grounded → not a violation');
    assert.ok(!r.errors.some(e => /category_delta/.test(e)), 'category_delta now grounded → not a violation');
  });

  test('never overwrites human-authored fields', () => {
    const s = scaffoldFrontierSpec({ id: 'q', scores: { 'Kiro (AWS)': 8.0 } });
    s.leader_target.observed_capability = 'HUMAN: a specific authored capability';
    s.leader_target.category_delta = 'HUMAN: a specific beyond-parity delta';
    const res = seedLeaderTargetFromLadder(s, ladder);
    assert.equal(res.seeded.observed_capability, false);
    assert.equal(res.seeded.category_delta, false);
    assert.equal(s.leader_target.observed_capability, 'HUMAN: a specific authored capability');
  });

  test('no ladder → no-op (never invents a level)', () => {
    const s = scaffoldFrontierSpec({ id: 'z', scores: { 'Kiro (AWS)': 8.5 } });
    const before = JSON.stringify(s);
    const res = seedLeaderTargetFromLadder(s, []);
    assert.equal(JSON.stringify(res.spec), before);
    assert.equal(res.ladder_rows_used.length, 0);
  });

  test('ANTI-LAUNDERING: a softened category_delta (replacing the ladder bar) is rejected when the rubric is supplied', () => {
    const s = scaffoldFrontierSpec({ id: 'planning_quality', scores: { 'Kiro (AWS)': 8.5 } });
    seedLeaderTargetFromLadder(s, ladder);
    // Agent tries to write its own easy exam, softening the 9.0 bar.
    s.leader_target.category_delta = 'add a couple more planning heuristics';
    const r = checkFrontierSpec(s, ['Kiro (AWS)'], ladder);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => /not grounded in the competitor-grounded Score Ladder/.test(e)), 'softened bar blocked by the gate, not an LLM');
    // …and with NO rubric supplied, the legacy behavior is unchanged (back-compat).
    assert.ok(!checkFrontierSpec(s, ['Kiro (AWS)']).errors.some(e => /not grounded in the competitor-grounded/.test(e)));
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

describe('applyFrontierGate — 9.0 = frontier is now BINDING', () => {
  test('a score <= 8.0 is never gated (no frontier target needed for "proven but not frontier")', () => {
    assert.deepEqual(applyFrontierGate(8.0, {}), { score: 8.0, capped: false });
    assert.deepEqual(applyFrontierGate(7.0, {}), { score: 7.0, capped: false });
  });

  test('a 9.0 with NO frontier_spec is capped to 8.0', () => {
    const r = applyFrontierGate(9.0, {});
    assert.equal(r.score, 8.0);
    assert.equal(r.capped, true);
  });

  test('a 9.0 with a FROZEN-but-unvalidated spec is now capped to 8.0 (court sign-off required)', () => {
    const spec = { ...goodSpec(), status: 'frozen' as const };
    spec.frozen_hash = computeSpecHash(spec);
    const r = applyFrontierGate(9.0, { frontier_spec: spec });
    assert.equal(r.score, 8.0, 'frozen alone no longer reaches 9.0 — the frontier-review-court must validate it');
    assert.equal(r.capped, true);
  });

  test('a 9.0 with a court-VALIDATED (non-stale) spec is allowed through', () => {
    const spec = { ...goodSpec(), status: 'validated' as const };
    spec.frozen_hash = computeSpecHash(spec);
    const r = applyFrontierGate(9.0, { frontier_spec: spec });
    assert.equal(r.score, 9.0);
    assert.equal(r.capped, false);
  });

  test('a 9.0 with a STALE (edited-after-freeze) spec is capped to 8.0', () => {
    const spec = { ...goodSpec(), status: 'frozen' as const };
    spec.frozen_hash = computeSpecHash(spec);
    spec.real_user_path.run_command = 'node dist/index.js forge --project fixtures/MOVED'; // goalpost moved
    const r = applyFrontierGate(9.0, { frontier_spec: spec });
    assert.equal(r.score, 8.0, 'stale spec cannot certify the frontier');
    assert.equal(r.capped, true);
  });
});

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
