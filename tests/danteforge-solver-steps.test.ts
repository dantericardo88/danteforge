import { test } from 'node:test';
import assert from 'node:assert/strict';
import { understandPrompt, implementPrompt, verifyPrompt, solvePhases, parseTaskFile } from '../src/matrix/engines/danteforge-solver-steps.ts';

const task = { problem_statement: 'Foo() crashes on empty input', hints_text: 'see bar.py' };

test('the structured solve is 3 ordered phases: understand → implement → verify', () => {
  const phases = solvePhases(task);
  assert.deepEqual(phases.map(p => p.phase), ['understand', 'implement', 'verify']);
});

test('UNDERSTAND localizes + plans without editing, and carries hints', () => {
  const p = understandPrompt(task);
  assert.match(p, /ROOT CAUSE/);
  assert.match(p, /Do NOT edit anything yet/);
  assert.match(p, /Foo\(\) crashes/);
  assert.match(p, /see bar\.py/);
});

test('IMPLEMENT demands the smallest surgical change', () => {
  assert.match(implementPrompt(task), /SMALLEST possible surgical change/);
});

test('VERIFY enforces regression discipline (existing tests must stay green)', () => {
  const p = verifyPrompt(task);
  assert.match(p, /EVERY test that passed before your change MUST still pass/);
  assert.match(p, /narrow it/);
});

test('every phase forbids editing test files (source-only — ungameable, matches the grader)', () => {
  for (const { prompt } of solvePhases(task)) assert.match(prompt, /SOURCE files only|never modify, add, or delete test files/);
});

test('parseTaskFile keeps the full task text (so regression-feedback rounds carry through)', () => {
  assert.equal(parseTaskFile('  the issue\n+ feedback  ').problem_statement, 'the issue\n+ feedback');
});
