import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  scaffoldFrontierSpec, seedLeaderTargetFromLadder, checkFrontierSpec, computeSpecHash, effectiveStatus,
  looksLikeProductRun, resolveRunCommand, signValidation, verifyValidation,
  signBuilderProvenance, verifyBuilderProvenance, signClaim, verifyClaim, type FrontierSpec,
} from '../src/core/frontier-spec.js';
import { completeFrontierSpec } from '../src/core/frontier-spec-complete.js';
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
  // A >8.0 target now requires a Score Ladder (#12 missing-ladder gate). Tests that assert a 9.0 spec
  // PASSES must supply one (real callers pass loadDimRubric); the gate's own behavior is pinned in
  // tests/ladder-coverage.test.ts. Error-presence tests below don't need it (the extra error is harmless).
  const RUBRIC = [{ score: 8, descriptor: 'eight' }, { score: 9, descriptor: 'nine — the frontier capability' }];

  test('a complete, honest spec passes', () => {
    assert.equal(checkFrontierSpec(goodSpec(), competitors, RUBRIC).ok, true);
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
    const s = goodSpec(); s.leader_target.score = 7.2; s.leader_target.category_delta = 'adds real-time multi-file preview no rival has';
    // Sub-target leader + a ladder activates anti-laundering (the delta must be GROUNDED in the target
    // rung), so ground the rung in the delta itself — this isolates "delta accepted" from that guard.
    const groundedLadder = [{ score: 9, descriptor: s.leader_target.category_delta! }];
    const r = checkFrontierSpec(s, competitors, groundedLadder);
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
      // a REAL product run on a realistic input — a --help-only command no longer qualifies
      capability_test: { command: 'node dist/index.js plan --project fixtures/sample' },
      outcomes: [
        { id: 'b', tier: 'T2', required_callsite: 'src/core/task-router.ts' },
        { id: 'a', tier: 'T4', required_callsite: 'src/core/plan-quality-scorer.ts' },
      ],
    };
    const s = scaffoldFrontierSpec(dim);
    assert.equal(s.leader_target.competitor, 'Kiro (AWS)', 'targets the highest-scoring tracked peer, never self');
    assert.equal(s.leader_target.score, 8.5);
    assert.equal(s.real_user_path.run_command, 'node dist/index.js plan --project fixtures/sample', 'run_command derived from the product capability_test');
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

  test('(3) a --help/--version-only capability_test is NOT seeded as run_command (a bare help screen proves nothing)', () => {
    for (const cmd of [
      'node dist/index.js plan --help',
      'node dist/index.js --help',
      'node dist/index.js plan -h',
      'danteforge help',
      'danteforge version',
      'danteforge compete --version',
    ]) {
      const s = scaffoldFrontierSpec({ id: 'x', scores: { Cursor: 8.5 }, capability_test: { command: cmd } });
      assert.ok(/TODO/.test(s.real_user_path.run_command), `"${cmd}" must not seed run_command`);
      assert.equal(looksLikeProductRun(cmd), false, `"${cmd}" is not a product run`);
    }
    // …while a real run on a realistic input still qualifies (the strengthening only TIGHTENS).
    assert.equal(looksLikeProductRun('node dist/index.js plan --project fixtures/sample'), true);
    assert.equal(looksLikeProductRun('danteforge assess --json'), true);
  });

  test('(d) scaffold never seeds an UNTRACKED leader when the tracked competitor list is supplied', () => {
    const dim = { id: 'x', scores: { self: 9, SomeRandomTool: 9.4, Cursor: 8.8 } };
    const s = scaffoldFrontierSpec(dim, ['Cursor', 'Cline']);
    assert.equal(s.leader_target.competitor, 'Cursor', 'highest-scoring TRACKED peer wins, not the untracked 9.4');
    const r = checkFrontierSpec(s, ['Cursor', 'Cline']);
    assert.ok(!r.errors.some(e => /not a tracked competitor/.test(e)), 'scaffold is consistent with the guardrail');
    // back-compat: with no tracked list supplied, legacy behavior (raw best score) is unchanged
    assert.equal(scaffoldFrontierSpec(dim).leader_target.competitor, 'SomeRandomTool');
  });

  test('(d) legacy named-leader fallback also respects the tracked list', () => {
    const s = scaffoldFrontierSpec({ id: 'x', oss_leader: 'GhostTool' }, ['Cursor']);
    assert.ok(/TODO/.test(s.leader_target.competitor), 'an untracked named leader stays an honest TODO');
    const tracked = scaffoldFrontierSpec({ id: 'x', oss_leader: 'Cline' }, ['Cursor', 'Cline']);
    assert.equal(tracked.leader_target.competitor, 'Cline');
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

describe('completeFrontierSpec — deterministic evidence-grounded completion (never inventing)', () => {
  const ladder: DimensionRubricLevel[] = [
    { score: 8, descriptor: 'Kiro-grade spec workflow: clarify + plan + tasks with hard gates.' },
    { score: 9, descriptor: 'LangGraph-grade runnable PDSE: a typed state graph with clarify/research/architecture/risk/tasking nodes.' },
  ];

  function evidenceDim(): Record<string, unknown> {
    return {
      id: 'planning_quality',
      scores: { 'Kiro (AWS)': 8.5 },
      capability_test: { command: 'node dist/index.js plan --project fixtures/sample' },
      outcomes: [
        { id: 'r1', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js plan --project fixtures/real-a', required_callsite: 'src/core/plan-quality-scorer.ts' },
        { id: 'r2', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js plan --project fixtures/real-b', required_callsite: 'src/core/plan-quality-scorer.ts' },
        { id: 'e1', kind: 'e2e-workflow', tier: 'T5', required_callsite: 'src/core/plan-quality-scorer.ts',
          steps: [{ cli_args: ['plan'], expected_artifacts: ['.danteforge/PLAN.md'] }] },
      ],
    };
  }

  test('(1) product capability_test + 2 runtime-exec outcomes with artifacts → completes to a spec that PASSES checkFrontierSpec with ZERO human edits', async () => {
    const dim = evidenceDim();
    const s = scaffoldFrontierSpec(dim, ['Kiro (AWS)']);
    seedLeaderTargetFromLadder(s, ladder);
    const res = await completeFrontierSpec(s, dim, {
      _probeRun: async () => { throw new Error('declared artifacts exist — must NOT probe'); },
    });

    assert.equal(res.probed, false, 'declared T5+ artifacts mean no probe run');
    assert.equal(res.completed.observable_artifacts, true);
    assert.equal(res.completed.realistic_inputs, true);
    assert.deepEqual(s.real_user_path.observable_artifacts, [{ kind: 'file', path: '.danteforge/PLAN.md' }]);

    // realistic_inputs are the genuinely distinct recorded variants, factored through {input} —
    // resolving a session reconstructs an EXACT recorded command (nothing synthesized).
    const inputs = s.real_user_path.realistic_inputs ?? [];
    assert.ok(inputs.length >= 2, `>=2 distinct variants (got ${inputs.length})`);
    assert.ok(s.real_user_path.run_command.includes('{input}'));
    const recorded = new Set([
      'node dist/index.js plan --project fixtures/sample',
      'node dist/index.js plan --project fixtures/real-a',
      'node dist/index.js plan --project fixtures/real-b',
    ]);
    for (let i = 0; i < inputs.length; i += 1) {
      assert.ok(recorded.has(resolveRunCommand(s, i)), `session ${i} resolves to a recorded real command`);
    }
    assert.notEqual(resolveRunCommand(s, 0), resolveRunCommand(s, 1), 'sessions exercise DIFFERENT real inputs');

    const check = checkFrontierSpec(s, ['Kiro (AWS)'], ladder);
    assert.deepEqual(check.errors, [], 'no guardrail violations remain');
    assert.equal(check.ok, true, 'autonomously court-checkable: zero human edits');
  });

  test('(2) a dim with NO real product evidence stays incomplete — nothing is invented', async () => {
    const dim = {
      id: 'x',
      scores: { Cursor: 9.2 },
      capability_test: { command: 'npx tsx --test tests/x.test.ts' },
      outcomes: [
        { id: 't1', kind: 'runtime-exec', tier: 'T5', command: 'npx tsx --test tests/y.test.ts', required_callsite: 'src/core/x.ts' },
        { id: 't2', kind: 'cli-smoke', tier: 'T5', cli_args: ['--help'], required_callsite: 'src/core/x.ts' },
      ],
    };
    const s = scaffoldFrontierSpec(dim, ['Cursor']);
    const res = await completeFrontierSpec(s, dim, {
      _probeRun: async () => { throw new Error('no run_command — must NOT probe'); },
    });
    assert.equal(res.completed.run_command, false);
    assert.equal(res.completed.observable_artifacts, false);
    assert.equal(res.completed.realistic_inputs, false);
    assert.equal(res.probed, false);
    assert.ok(/TODO/.test(s.real_user_path.run_command), 'run_command left unauthored');
    assert.ok(s.real_user_path.observable_artifacts.some(a => /TODO/.test(a.path)), 'artifacts left unauthored');
    assert.equal(s.real_user_path.realistic_inputs, undefined, 'no inputs invented');
    assert.equal(checkFrontierSpec(s, ['Cursor']).ok, false, 'the honest spec-incomplete ceiling stands');
  });

  test('(3) --help-only outcome commands are never promoted to run_command', async () => {
    const dim = {
      id: 'x',
      scores: { Cursor: 9.2 },
      outcomes: [
        { id: 'h1', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js plan --help', required_callsite: 'src/core/x.ts' },
        { id: 'h2', kind: 'cli-smoke', tier: 'T5', cli_args: ['plan', '--help'], required_callsite: 'src/core/x.ts' },
      ],
    };
    const s = scaffoldFrontierSpec(dim, ['Cursor']);
    const res = await completeFrontierSpec(s, dim, {
      _probeRun: async () => ({ exitCode: 0, durationMs: 2000 }),
    });
    assert.equal(res.completed.run_command, false);
    assert.equal(res.probed, false, 'nothing runnable — no probe');
    assert.ok(/TODO/.test(s.real_user_path.run_command), 'help screens prove nothing');
  });

  test('(4) probe-derived artifacts come ONLY from a real probe run (seam): files created/modified during the run', async () => {
    const dim = {
      id: 'x',
      scores: { Cursor: 9.2 },
      outcomes: [
        { id: 'r1', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js forge --project fixtures/a', required_callsite: 'src/core/x.ts' },
        { id: 'r2', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js forge --project fixtures/b', required_callsite: 'src/core/x.ts' },
      ],
    };
    const s = scaffoldFrontierSpec(dim, ['Cursor']);
    let probes = 0; let probedCmd = ''; let snapCalls = 0;
    const res = await completeFrontierSpec(s, dim, {
      _probeRun: async (cmd) => { probes += 1; probedCmd = cmd; return { exitCode: 0, durationMs: 1500 }; },
      _snapshotMtimes: async () => {
        snapCalls += 1;
        return snapCalls === 1
          ? new Map([['src/core/x.ts', 100], ['.danteforge/STATE.yaml', 100]])
          : new Map([['src/core/x.ts', 100], ['.danteforge/STATE.yaml', 200], ['.danteforge/reports/forge-run.json', 300]]);
      },
    });
    assert.equal(probes, 1, 'the probe runs exactly ONCE');
    assert.equal(probedCmd, 'node dist/index.js forge --project fixtures/a', 'probes the session-0 resolved real command');
    assert.equal(res.probed, true);
    assert.equal(res.completed.observable_artifacts, true);
    const paths = s.real_user_path.observable_artifacts.map(a => a.path).sort();
    assert.deepEqual(paths, ['.danteforge/STATE.yaml', '.danteforge/reports/forge-run.json'], 'only files the run actually created/modified');
    assert.ok(!paths.includes('src/core/x.ts'), 'untouched files are never claimed as artifacts');
  });

  test('(4b) a FAILING probe run leaves observable_artifacts unauthored (a failing run witnesses nothing)', async () => {
    const dim = {
      id: 'x', scores: { Cursor: 9.2 },
      outcomes: [
        { id: 'r1', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js forge --project fixtures/a', required_callsite: 'src/core/x.ts' },
        { id: 'r2', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js forge --project fixtures/b', required_callsite: 'src/core/x.ts' },
      ],
    };
    const s = scaffoldFrontierSpec(dim, ['Cursor']);
    const snap = async () => new Map([['out.txt', 100]]);
    const res = await completeFrontierSpec(s, dim, {
      _probeRun: async () => ({ exitCode: 1, durationMs: 1500 }),
      _snapshotMtimes: snap,
    });
    assert.equal(res.probed, true);
    assert.equal(res.completed.observable_artifacts, false);
    assert.ok(s.real_user_path.observable_artifacts.some(a => /TODO/.test(a.path)), 'no artifact claimed from a failed run');
  });

  test('(4c) a probe with NO observable file changes leaves the field unauthored (honest ceiling stands)', async () => {
    const dim = {
      id: 'x', scores: { Cursor: 9.2 },
      outcomes: [
        { id: 'r1', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js forge --project fixtures/a', required_callsite: 'src/core/x.ts' },
        { id: 'r2', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js forge --project fixtures/b', required_callsite: 'src/core/x.ts' },
      ],
    };
    const s = scaffoldFrontierSpec(dim, ['Cursor']);
    const res = await completeFrontierSpec(s, dim, {
      _probeRun: async () => ({ exitCode: 0, durationMs: 1500 }),
      _snapshotMtimes: async () => new Map([['out.txt', 100]]),
    });
    assert.equal(res.probed, true);
    assert.equal(res.completed.observable_artifacts, false);
    assert.ok(s.real_user_path.observable_artifacts.some(a => /TODO/.test(a.path)));
    assert.equal(checkFrontierSpec(s, ['Cursor']).ok, false, 'still honestly incomplete');
  });

  test('(5a) artifacts from a run UNDER the real-exercise floor are recorded with a loud session-record REJECT warning (live fleet-run-3 pin)', async () => {
    const dim = {
      id: 'x', scores: { Cursor: 9.2 },
      outcomes: [
        { id: 'r1', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js traceability --spec fixtures/a.md', required_callsite: 'src/core/x.ts' },
        { id: 'r2', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js traceability --spec fixtures/b.md', required_callsite: 'src/core/x.ts' },
      ],
    };
    const s = scaffoldFrontierSpec(dim, ['Cursor']);
    let snapCalls = 0;
    const res = await completeFrontierSpec(s, dim, {
      _probeRun: async () => ({ exitCode: 0, durationMs: 644 }), // real but too fast — the live planning_quality case
      _snapshotMtimes: async () => {
        snapCalls += 1;
        return snapCalls % 2 === 1
          ? new Map([['x.md', 100]])
          : new Map([['x.md', 100], ['.danteforge/traceability.md', 999]]);
      },
    });
    assert.equal(res.completed.observable_artifacts, true, 'real output is recorded (derivation, not invention)');
    assert.ok(res.notes.some(n => /REJECT/.test(n) && /too fast/i.test(n)),
      'the completer must say loudly that session-record will reject this run');
  });

  test('(5b) a machine-owned run_command that cannot satisfy the real-exercise protocol is SWITCHED to a viable recorded candidate', async () => {
    const dim = {
      id: 'x', scores: { Cursor: 9.2 },
      capability_test: { command: 'node dist/index.js gap x' }, // fast, artifact-less
      outcomes: [
        { id: 'r1', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js matrix-kernel simulate', required_callsite: 'src/core/x.ts' },
      ],
    };
    const s = scaffoldFrontierSpec(dim, ['Cursor']);
    s.real_user_path.realistic_inputs = ['human/one', 'human/two']; // pre-authored → no template derivation
    let snapCalls = 0;
    const res = await completeFrontierSpec(s, dim, {
      _probeRun: async (cmd) => cmd.includes('simulate')
        ? { exitCode: 0, durationMs: 2400 }
        : { exitCode: 0, durationMs: 500 },
      _snapshotMtimes: async () => {
        snapCalls += 1;
        // gap probe (calls 1-2): nothing changes; simulate probe (calls 3-4): plan file written
        return snapCalls <= 2
          ? new Map([['x.md', 100]])
          : (snapCalls === 3 ? new Map([['x.md', 100]]) : new Map([['x.md', 100], ['.danteforge/matrix/matrix.simulation-plan.json', 999]]));
      },
    });
    assert.equal(s.real_user_path.run_command, 'node dist/index.js matrix-kernel simulate', 'switched to the viable recorded candidate');
    assert.equal(res.completed.observable_artifacts, true);
    assert.ok(res.notes.some(n => /switched/.test(n)), 'the switch is named in the provenance notes');
  });

  test('never overwrites authored fields (mirrors the ladder seeder contract)', async () => {
    const dim = evidenceDim();
    const s = scaffoldFrontierSpec(dim, ['Kiro (AWS)']);
    s.real_user_path.observable_artifacts = [{ kind: 'report', path: '.danteforge/HUMAN-AUTHORED.md' }];
    s.real_user_path.realistic_inputs = ['human/one', 'human/two'];
    await completeFrontierSpec(s, dim, { probe: false });
    assert.deepEqual(s.real_user_path.observable_artifacts, [{ kind: 'report', path: '.danteforge/HUMAN-AUTHORED.md' }]);
    assert.deepEqual(s.real_user_path.realistic_inputs, ['human/one', 'human/two']);
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

  test('a 9.0 with a court-VALIDATED spec carrying a VERIFIABLE receipt is allowed through', () => {
    const spec = { ...goodSpec(), status: 'validated' as const };
    const hash = computeSpecHash(spec);
    spec.frozen_hash = hash;
    const judges = ['grok-build', 'gemini-cli'];
    spec.validated_by = { frozen_hash: hash, judge_member_ids: judges, validated_at: 'now', sig: signValidation('dimX', hash, judges) };
    const r = applyFrontierGate(9.0, { id: 'dimX', frontier_spec: spec });
    assert.equal(r.score, 9.0);
    assert.equal(r.capped, false);
  });

  test('court-audit #1: a bare status:validated with NO receipt is capped to 8.0 (the one-field forgery is closed)', () => {
    const spec = { ...goodSpec(), status: 'validated' as const }; // hand-edited: no frozen_hash, no validated_by
    const r = applyFrontierGate(9.0, { id: 'dimX', frontier_spec: spec });
    assert.equal(r.score, 8.0, 'a hand-written validated string can no longer mint a 9.0');
    assert.equal(r.capped, true);
  });

  test('court-audit #1: a receipt minted for ANOTHER dim does not validate this one (dim-bound)', () => {
    const spec = { ...goodSpec(), status: 'validated' as const };
    const hash = computeSpecHash(spec);
    spec.frozen_hash = hash;
    const judges = ['grok-build', 'gemini-cli'];
    spec.validated_by = { frozen_hash: hash, judge_member_ids: judges, validated_at: 'now', sig: signValidation('dimA', hash, judges) };
    const r = applyFrontierGate(9.0, { id: 'dimB', frontier_spec: spec }); // receipt was signed for dimA
    assert.equal(r.score, 8.0, 'a receipt copied from another dim fails verification');
    assert.equal(r.capped, true);
  });

  test('court-audit #1: editing content AFTER validation invalidates the receipt (goalpost move → capped)', () => {
    const spec = { ...goodSpec(), status: 'validated' as const };
    const hash = computeSpecHash(spec);
    spec.frozen_hash = hash;
    const judges = ['grok-build', 'gemini-cli'];
    spec.validated_by = { frozen_hash: hash, judge_member_ids: judges, validated_at: 'now', sig: signValidation('dimX', hash, judges) };
    spec.real_user_path.run_command = 'node dist/index.js forge --project fixtures/EASIER'; // moved after sign-off
    const r = applyFrontierGate(9.0, { id: 'dimX', frontier_spec: spec });
    assert.equal(r.score, 8.0, 'a post-validation edit breaks the frozen_hash binding');
    assert.equal(r.capped, true);
  });

  test('court-audit: a judge who ALSO built the dim invalidates the receipt (judge≠builder, bound)', () => {
    const spec = { ...goodSpec(), status: 'validated' as const };
    const hash = computeSpecHash(spec);
    spec.frozen_hash = hash;
    const judges = ['grok-build', 'codex'];
    const builders = ['codex']; // codex BUILT the dim AND is listed as a judge → self-certifying
    spec.validated_by = { frozen_hash: hash, judge_member_ids: judges, builder_member_ids: builders, validated_at: 'now', sig: signValidation('dimX', hash, judges, builders) };
    assert.equal(verifyValidation('dimX', spec), false, 'a judge who built the dim must invalidate the validation');
  });

  test('court-audit: judges disjoint from builders, correctly signed → verifies', () => {
    const spec = { ...goodSpec(), status: 'validated' as const };
    const hash = computeSpecHash(spec);
    spec.frozen_hash = hash;
    const judges = ['grok-build', 'gemini-cli'];
    const builders = ['codex', 'claude-code'];
    spec.validated_by = { frozen_hash: hash, judge_member_ids: judges, builder_member_ids: builders, validated_at: 'now', sig: signValidation('dimX', hash, judges, builders) };
    assert.equal(verifyValidation('dimX', spec), true);
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

    // operator fills it in honestly. Target the gate threshold (8.0): this test exercises the init→freeze
    // FLOW, and agent_ux has no Score Ladder on disk — the separate >8.0-needs-a-ladder gate (#12) is
    // pinned in tests/ladder-coverage.test.ts, so we don't conflate the two here.
    Object.assign(dim.frontier_spec as FrontierSpec, { ...goodSpec(), target_score: 8.0 });
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

  function dimWithEvidence(): Record<string, unknown> {
    return {
      oss_leader: 'Cline',
      capability_test: { command: 'node dist/index.js assess --project fixtures/p1' },
      outcomes: [
        { id: 'r1', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js assess --project fixtures/p2', required_callsite: 'src/core/assess.ts' },
        { id: 'e1', kind: 'e2e-workflow', tier: 'T5', required_callsite: 'src/core/assess.ts',
          steps: [{ cli_args: ['assess'], expected_artifacts: ['.danteforge/ASSESS.md'] }] },
      ],
    };
  }

  test('init --write runs the evidence-grounded completer by DEFAULT (autonomous path)', async () => {
    const matrix = matrixWith(dimWithEvidence());
    const r = await runFrontierSpec({
      action: 'init', dimId: 'agent_ux', write: true,
      _loadMatrix: async () => matrix, _writeMatrix: async () => {},
      _probeRun: async () => { throw new Error('declared artifacts — must NOT probe'); },
    });
    const dim = (matrix as unknown as { dimensions: Array<Record<string, unknown>> }).dimensions[0]!;
    const spec = dim.frontier_spec as FrontierSpec;
    assert.equal(r.wrote, true);
    assert.equal(r.completed?.observable_artifacts, true);
    assert.equal(r.completed?.realistic_inputs, true);
    assert.equal(r.probed, false);
    assert.ok(spec.real_user_path.run_command.includes('{input}'), 'distinct recorded variants factored through {input}');
    assert.deepEqual(spec.real_user_path.observable_artifacts, [{ kind: 'file', path: '.danteforge/ASSESS.md' }]);
    assert.ok((spec.real_user_path.realistic_inputs?.length ?? 0) >= 2);
  });

  test('init --write with complete:false (--no-complete) leaves the scaffold marks untouched', async () => {
    const matrix = matrixWith(dimWithEvidence());
    const r = await runFrontierSpec({
      action: 'init', dimId: 'agent_ux', write: true, complete: false,
      _loadMatrix: async () => matrix, _writeMatrix: async () => {},
    });
    const dim = (matrix as unknown as { dimensions: Array<Record<string, unknown>> }).dimensions[0]!;
    const spec = dim.frontier_spec as FrontierSpec;
    assert.equal(r.completed, undefined, 'completer skipped');
    assert.ok(spec.real_user_path.observable_artifacts.some(a => /TODO/.test(a.path)), 'scaffold sentinel remains');
    assert.equal(spec.real_user_path.realistic_inputs, undefined);
  });
});

describe('builder-provenance token — peer-review judging without re-opening self-certification (CH-061)', () => {
  test('a kernel-signed token verifies for EXACTLY its dim + builder set', () => {
    const tok = signBuilderProvenance('functionality', ['codex']);
    assert.equal(verifyBuilderProvenance('functionality', ['codex'], tok), true);
  });

  test('a forged / garbage token is REJECTED (the agent has no kernel secret)', () => {
    assert.equal(verifyBuilderProvenance('functionality', ['codex'], 'deadbeefdeadbeefdeadbeefdeadbeef'), false);
    assert.equal(verifyBuilderProvenance('functionality', ['codex'], undefined), false);
  });

  test('a token bound to one builder is REJECTED for a different builder (no self-seating)', () => {
    const tokForClaude = signBuilderProvenance('functionality', ['claude-code']);
    // An agent that built the dim (claude-code) cannot present claude's token while claiming codex built it
    // to re-seat itself as judge: the token only excludes who it names.
    assert.equal(verifyBuilderProvenance('functionality', ['codex'], tokForClaude), false);
  });

  test('a token is bound to its dim — not reusable across dims', () => {
    const tok = signBuilderProvenance('functionality', ['codex']);
    assert.equal(verifyBuilderProvenance('security', ['codex'], tok), false);
  });

  test('order-independent over the builder set; empty builders never verifies', () => {
    const tok = signBuilderProvenance('functionality', ['codex', 'claude-code']);
    assert.equal(verifyBuilderProvenance('functionality', ['claude-code', 'codex'], tok), true, 'sorted internally');
    assert.equal(verifyBuilderProvenance('functionality', [], signBuilderProvenance('functionality', [])), false);
  });

  test('signClaim/verifyClaim — a graded-evaluator gap check is non-gameable (no kernel secret = no valid sig)', () => {
    const sig = signClaim('mao_agent_benchmark');
    assert.equal(verifyClaim('mao_agent_benchmark', sig), true, 'a real kernel-signed claim verifies');
    assert.equal(verifyClaim('mao_agent_benchmark', undefined), false, 'a touched/empty file (no sig) never verifies');
    assert.equal(verifyClaim('mao_agent_benchmark', 'deadbeefdeadbeefdeadbeefdeadbeef'), false, 'a forged sig fails');
    assert.equal(verifyClaim('mao_head_to_head', sig), false, 'a claim is bound to its name — no cross-reuse');
  });
});
