import { test } from 'node:test';
import assert from 'node:assert/strict';
import { understandPrompt, implementPrompt, verifyPrompt, solvePhases, parseTaskFile, rawTurns } from '../src/matrix/engines/danteforge-solver-steps.ts';

test('rawTurns is the BUDGET-MATCHED control: N unstructured turns, default matched to the 3 phases', () => {
  const t = rawTurns({ problem_statement: 'bug X' });
  assert.equal(t.length, 3, 'default turn count matches solvePhases length (isolates structure, not compute)');
  assert.ok(t.every(x => x.phase === 'raw'));
  assert.match(t[0]!.prompt, /Fix it/);
  assert.match(t[0]!.prompt, /bug X/);
  assert.match(t[1]!.prompt, /Continue working/);
  // the control has NO understand/implement/verify decomposition — that's the treatment's only edge
  assert.ok(!t.some(x => /PHASE \d of 3|ROOT CAUSE/.test(x.prompt)));
});

test('rawTurns is source-only too (so the ONLY A/B difference is structure, not the cheat-guard)', () => {
  for (const t of rawTurns({ problem_statement: 'x' }, 2)) assert.match(t.prompt, /SOURCE files only|never modify, add, or delete test files/);
  assert.equal(rawTurns({ problem_statement: 'x' }, 2).length, 2);
});

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
