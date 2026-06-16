import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVisibleExamples,
  buildVisibleCheckProgram,
  pipelineSolve,
} from '../src/matrix/engines/pipeline-solver.ts';
import type { PythonRunner } from '../src/matrix/engines/humaneval-grounding.ts';

const PROMPT = [
  'def has_close(xs, t):',
  '    """Return True if any two numbers are closer than t.',
  '    >>> has_close([1.0, 2.0, 3.0], 0.5)',
  '    False',
  '    >>> has_close([1.0, 2.8, 3.0], 0.3)',
  '    True',
  '    """',
  '',
].join('\n');

test('parseVisibleExamples extracts call/expected doctest pairs', () => {
  const ex = parseVisibleExamples(PROMPT);
  assert.equal(ex.length, 2);
  assert.equal(ex[0]!.call, 'has_close([1.0, 2.0, 3.0], 0.5)');
  assert.equal(ex[0]!.expected, 'False');
  assert.equal(ex[1]!.expected, 'True');
});

test('parseVisibleExamples returns [] when there are no doctests', () => {
  assert.deepEqual(parseVisibleExamples('def f(x):\n    """no examples"""\n'), []);
});

test('buildVisibleCheckProgram emits guarded assertions for each example', () => {
  const prog = buildVisibleCheckProgram(PROMPT, 'has_close', '    return False\n', parseVisibleExamples(PROMPT));
  assert.match(prog, /_failures = \[\]/);
  assert.match(prog, /has_close\(\[1\.0, 2\.0, 3\.0\], 0\.5\)/);
  assert.match(prog, /sys\.exit\(1\)/);
});

test('buildVisibleCheckProgram with no examples falls back to a definition check', () => {
  const prog = buildVisibleCheckProgram('def f(x):\n    """x"""\n', 'f', '    return x\n', []);
  assert.match(prog, /assert callable\(f\)/);
});

test('pipelineSolve returns the first candidate that clears the visible check', async () => {
  // fake runner: a body containing "GOOD" passes (status 0), otherwise fails.
  const runner: PythonRunner = (program) => (program.includes('GOOD') ? { status: 0, stderr: '' } : { status: 1, stderr: 'AssertionError' });
  let calls = 0;
  const generate = async () => { calls++; return calls < 2 ? '    return BAD\n' : '    return GOOD\n'; };
  const r = await pipelineSolve({ prompt: PROMPT, entry_point: 'has_close' }, generate, runner, { maxIterations: 3 });
  assert.ok(r.visiblePassed);
  assert.equal(r.iterations, 2);
  assert.match(r.body, /GOOD/);
});

test('pipelineSolve feeds failures back into the next generation', async () => {
  const runner: PythonRunner = (program) => (program.includes('GOOD') ? { status: 0, stderr: '' } : { status: 1, stderr: 'example 1 failed' });
  const feedbacks: (string | undefined)[] = [];
  let calls = 0;
  const generate = async (_p: string, fb?: string) => { feedbacks.push(fb); calls++; return calls < 2 ? '    return BAD\n' : '    return GOOD\n'; };
  await pipelineSolve({ prompt: PROMPT, entry_point: 'has_close' }, generate, runner, { maxIterations: 3 });
  assert.equal(feedbacks[0], undefined);          // first attempt: no feedback
  assert.match(feedbacks[1]!, /failed these checks/); // second attempt: carries the failure
});

test('pipelineSolve returns best-effort last candidate when nothing passes', async () => {
  const runner: PythonRunner = () => ({ status: 1, stderr: 'AssertionError' });
  const generate = async () => '    return BAD\n';
  const r = await pipelineSolve({ prompt: PROMPT, entry_point: 'has_close' }, generate, runner, { maxIterations: 2 });
  assert.ok(!r.visiblePassed);
  assert.equal(r.iterations, 2);
  assert.match(r.body, /BAD/);
});

test('pipelineSolve survives a throwing generator and retries with feedback', async () => {
  const runner: PythonRunner = (program) => (program.includes('GOOD') ? { status: 0, stderr: '' } : { status: 1, stderr: 'x' });
  let calls = 0;
  const generate = async () => { calls++; if (calls === 1) throw new Error('model timeout'); return '    return GOOD\n'; };
  const r = await pipelineSolve({ prompt: PROMPT, entry_point: 'has_close' }, generate, runner, { maxIterations: 3 });
  assert.ok(r.visiblePassed);
  assert.equal(r.iterations, 2);
});
