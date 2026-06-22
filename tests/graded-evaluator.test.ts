// The continuous-evaluator contract (the frontier loop fix): a graded evaluator returns a CONTINUOUS
// combinedScore the build loop CLIMBS, with artifacts that ARE the evidence — modeled on OpenEvolve's
// EvaluationResult + AIDE's MetricValue. These pin the parse contract, the fail-closed invariant, and the
// climb/selection logic.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvaluation, runGradedEvaluator, isBetter, shouldClimb, type EvaluationResult } from '../src/core/graded-evaluator.js';
import { runEvaluateCli } from '../src/cli/commands/evaluate.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

const R = (score: number, ran = true): EvaluationResult => ({ combinedScore: score, metrics: {}, artifacts: {}, ran });

describe('parseEvaluation — OpenEvolve-style JSON + sentinel + fail-closed', () => {
  test('a JSON line with combined_score is parsed (score + metrics + artifacts)', () => {
    const out = 'building...\nran 5 checks\n{"combined_score": 0.65, "metrics": {"checks_passed": 13}, "artifacts": {"detail": "13/20 frontier capabilities"}}';
    const r = parseEvaluation(out);
    assert.equal(r.ran, true);
    assert.equal(r.combinedScore, 0.65);
    assert.equal(r.metrics['checks_passed'], 13);
    assert.match(r.artifacts['detail']!, /13\/20/);
  });

  test('the LAST combined_score line wins (the evaluator may log freely, then print its verdict)', () => {
    const out = '{"combined_score": 0.20}\nmore work\n{"combined_score": 0.80}';
    assert.equal(parseEvaluation(out).combinedScore, 0.80);
  });

  test('a bare EVAL_SCORE sentinel is parsed for simple shell evaluators', () => {
    assert.equal(parseEvaluation('...\nEVAL_SCORE: 0.42\n').combinedScore, 0.42);
  });

  test('scores are clamped to [0,1]', () => {
    assert.equal(parseEvaluation('{"combined_score": 1.7}').combinedScore, 1);
    assert.equal(parseEvaluation('{"combined_score": -0.3}').combinedScore, 0);
  });

  test('NO parseable score → ran=false, score 0 (fail closed — never a fabricated pass)', () => {
    const r = parseEvaluation('the command printed only logs, no score');
    assert.equal(r.ran, false);
    assert.equal(r.combinedScore, 0);
    assert.match(r.reason ?? '', /fail closed/i);
  });

  test('garbage JSON that mentions combined_score does not crash → keeps scanning → fail closed', () => {
    const r = parseEvaluation('{combined_score: not-json}');
    assert.equal(r.ran, false);
  });
});

describe('isBetter / shouldClimb — the selection + climb logic (AIDE MetricValue)', () => {
  test('a higher score is better; a non-ran candidate is never better; ran beats non-ran', () => {
    assert.equal(isBetter(R(0.7), R(0.5)), true);
    assert.equal(isBetter(R(0.5), R(0.7)), false);
    assert.equal(isBetter(R(0, false), R(0.1)), false, 'a crashed evaluator never wins');
    assert.equal(isBetter(R(0.1), R(0, false)), true, 'a real low score beats no-run');
  });

  test('shouldClimb stays true at a passing-but-imperfect score (no plateau), false at/above target', () => {
    assert.equal(shouldClimb(R(0.6), 0.9), true, 'still climbing — the binary gate would have stopped here');
    assert.equal(shouldClimb(R(0.9), 0.9), false);
    assert.equal(shouldClimb(R(0.95), 0.9), false);
    assert.equal(shouldClimb(R(0, false), 0.9), true, 'a non-run always needs another attempt');
  });
});

describe('runGradedEvaluator — runs a command + parses, attaches stderr as evidence', () => {
  test('parses the combined_score from a seamed run and attaches stderr', async () => {
    const r = await runGradedEvaluator('does-not-matter', '/tmp', {
      _run: async () => ({ exitCode: 0, stdout: '{"combined_score": 0.5}', stderr: 'a warning' }),
    });
    assert.equal(r.combinedScore, 0.5);
    assert.equal(r.ran, true);
    assert.equal(r.artifacts['stderr'], 'a warning');
  });

  test('a non-zero exit does NOT fail the result — the evaluator legitimately reports a LOW score', async () => {
    const r = await runGradedEvaluator('x', '/tmp', {
      _run: async () => ({ exitCode: 1, stdout: '{"combined_score": 0.15}', stderr: '' }),
    });
    assert.equal(r.ran, true);
    assert.equal(r.combinedScore, 0.15, 'low but real — a graded evaluator scores failing runs, not just rejects them');
  });

  test('a run that emits no score is ran=false even on exit 0 (fail closed)', async () => {
    const r = await runGradedEvaluator('x', '/tmp', {
      _run: async () => ({ exitCode: 0, stdout: 'ok, did stuff', stderr: '' }),
    });
    assert.equal(r.ran, false);
  });
});

describe('runEvaluateCli — the wired command surface (danteforge evaluate <dim>)', () => {
  const matrix = (graded?: string): CompeteMatrix =>
    ({ dimensions: [{ id: 'mao', label: 'MAO', ...(graded ? { graded_evaluator: graded } : {}) }] } as unknown as CompeteMatrix);

  test('a dim with a graded_evaluator returns its continuous score', async () => {
    const r = await runEvaluateCli({
      dimId: 'mao', _loadMatrix: async () => matrix('npx tsx scripts/eval-mao.ts'),
      _run: async () => ({ exitCode: 0, stdout: '{"combined_score": 0.571, "metrics": {"passed": 4}}', stderr: '' }),
    });
    assert.equal(r.ran, true);
    assert.equal(r.combinedScore, 0.571);
  });

  test('a dim with NO graded_evaluator → ran=false with actionable guidance (not a fake pass)', async () => {
    const r = await runEvaluateCli({ dimId: 'mao', _loadMatrix: async () => matrix() });
    assert.equal(r.ran, false);
    assert.match(r.reason ?? '', /graded_evaluator/);
  });
});
