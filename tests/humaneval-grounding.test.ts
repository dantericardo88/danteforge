// Phase 2 (HumanEval): verify the real grounding runner — loader + Python execution + aggregation —
// with a self-contained synthetic problem of HumanEval's shape (the canonical solution passes, a wrong
// one fails). No LLM compute: the agent solver is the run-time seam. Python-execution tests skip cleanly
// where python is unavailable so the suite stays portable.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  runHumanEvalGrounding, runHumanEvalTest, parseHumanEvalJsonl, formatPassRateLine,
  type HumanEvalProblem, type PythonRunner,
} from '../src/matrix/engines/humaneval-grounding.js';
import { parsePassRate } from '../src/matrix/engines/external-benchmark-runner.js';

const PYTHON_OK = (() => { try { return spawnSync('python', ['--version']).status === 0; } catch { return false; } })();
const pyGuard = PYTHON_OK ? false : 'python interpreter not available';

// A synthetic problem with HumanEval's exact execution shape (prompt + body + check(candidate) + call).
const ADD: HumanEvalProblem = {
  task_id: 'Synthetic/add',
  prompt: 'def add(a, b):\n    """Add two numbers."""\n',
  entry_point: 'add',
  test: 'def check(candidate):\n    assert candidate(1, 2) == 3\n    assert candidate(-1, 1) == 0\n',
  canonical_solution: '    return a + b\n',
};

describe('humaneval grounding runner — Phase 2', () => {
  test('the canonical solution PASSES under real Python', { skip: pyGuard }, async () => {
    const report = await runHumanEvalGrounding([ADD], async () => ADD.canonical_solution);
    assert.equal(report.pass_rate, 1, `expected the gold body to pass; results=${JSON.stringify(report.results)}`);
  });

  test('a wrong completion FAILS under real Python (assertion error)', { skip: pyGuard }, async () => {
    const report = await runHumanEvalGrounding([ADD], async () => '    return 0\n');
    assert.equal(report.pass_rate, 0);
    assert.match(report.results[0]!.error ?? '', /Assert|Error|exit/i);
  });

  test('the assembled program is prompt + completion + test + check(entry) — verified via an injected runner', () => {
    let program = '';
    const fakePython: PythonRunner = (p) => { program = p; return { status: 0, stderr: '' }; };
    runHumanEvalTest(ADD, '    return a + b\n', fakePython);
    assert.ok(program.startsWith(ADD.prompt), 'starts with the prompt');
    assert.ok(program.includes('    return a + b'), 'includes the completion body');
    assert.ok(program.includes('def check(candidate)'), 'includes the test');
    assert.ok(program.trimEnd().endsWith('check(add)'), 'ends by invoking check(entry_point)');
  });

  test('the solver NEVER receives the canonical_solution (gold withheld)', async () => {
    let leaked = false;
    await runHumanEvalGrounding([ADD], async (spec) => {
      if ('canonical_solution' in (spec as Record<string, unknown>)) leaked = true;
      return '';
    }, () => ({ passed: false }));
    assert.equal(leaked, false);
  });

  test('a throwing solver scores that problem unresolved (never crashes, never silently passes)', async () => {
    const report = await runHumanEvalGrounding([ADD], async () => { throw new Error('agent timeout'); }, () => ({ passed: true }));
    assert.equal(report.resolved, 0);
    assert.match(report.results[0]!.error ?? '', /solver error: agent timeout/);
  });

  test('parseHumanEvalJsonl parses valid problems and skips blank/garbage lines', () => {
    const jsonl = [
      JSON.stringify({ task_id: 'A/1', prompt: 'p', entry_point: 'f', test: 't', canonical_solution: 'c' }),
      '',
      'not json',
      JSON.stringify({ task_id: 'A/2', prompt: 'p2', entry_point: 'g', test: 't2' }), // no canonical → defaults ''
    ].join('\n');
    const problems = parseHumanEvalJsonl(jsonl);
    assert.equal(problems.length, 2);
    assert.equal(problems[1]!.canonical_solution, '');
  });

  test('the output line round-trips through external-benchmark-runner.parsePassRate', () => {
    const report = { total: 4, resolved: 1, pass_rate: 0.25, results: [] };
    assert.equal(parsePassRate(formatPassRateLine(report)), 0.25);
  });
});
