// Tests for the INTAKE half of the problem-solving DNA (DFPP-001): the lazy-verb gate must reign in TRULY vague
// goals while letting terse-but-complete ones pass (the council's false-decomposition guard), and /ps must render
// a resolve-then-proceed contract that carries the Operating Contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyIntake,
  wrapWithOperatingContract,
  OPERATING_CONTRACT,
  ROLE_LENSES,
} from '../src/core/problem-solving-contract.js';
import { runPs } from '../src/cli/commands/ps.js';

test('a vague lazy verb with no fields is under-specified', () => {
  const c = classifyIntake('fix the bug');
  assert.equal(c.lazy, true);
  assert.equal(c.underSpecified, true, '"fix the bug" must be reigned in');
  assert.equal(c.missingFields.length, 3);
});

test('"make it work" / "optimize this" are caught as vague phrases', () => {
  assert.equal(classifyIntake('make it work').underSpecified, true);
  assert.equal(classifyIntake('optimize this').underSpecified, true);
  assert.equal(classifyIntake('clean it up').underSpecified, true);
});

test('a terse-but-complete goal is NOT blocked (false-decomposition guard)', () => {
  // Specific object ("typo in README") — lazy verb present, but not a vague object → pass through.
  const c = classifyIntake('fix typo in README:42');
  assert.equal(c.lazy, true, 'still flags the verb informationally');
  assert.equal(c.underSpecified, false, 'a specific object must NOT be blocked');
});

test('supplying the required fields resolves a vague goal (bias to action)', () => {
  const c = classifyIntake('fix the bug', {
    symptom: '/orders 500s on empty cart',
    doneCriteria: 'repro test passes; happy path unchanged',
    scope: 'only the orders controller',
  });
  assert.equal(c.underSpecified, false, 'fields present → proceed, do not gate');
  assert.equal(c.missingFields.length, 0);
});

test('suggestLens maps a goal to an analysis frame', () => {
  assert.equal(classifyIntake('the login endpoint has an injection risk').suggestedLens, 'security');
  assert.equal(classifyIntake('this query is slow under load').suggestedLens, 'performance');
  assert.equal(classifyIntake('the app crashes on startup').suggestedLens, 'debugging');
});

test('runPs reigns in a lazy verb into a resolve-then-proceed contract', () => {
  const r = runPs({ goal: 'fix the bug' });
  assert.equal(r.underSpecified, true);
  // Carries the Operating Contract (harness discipline) and flags unresolved fields for the ladder, not a hard stop.
  assert.ok(r.contract.includes(OPERATING_CONTRACT), 'contract embeds the Operating Contract');
  assert.ok(r.contract.includes('RESOLVE FROM CONTEXT'), 'unresolved fields flagged for the resolution ladder');
  assert.ok(r.contract.includes('reversible'), 'states the bias-to-action-on-reversible rule');
});

test('runPs attaches the supplied/suggested role-lens as one line, not a persona', () => {
  const r = runPs({ goal: 'audit the auth flow', lens: 'security' });
  assert.equal(r.lens, 'security');
  assert.ok(r.contract.includes(ROLE_LENSES.security));
});

test('wrapWithOperatingContract prepends the contract to a dispatched prompt', () => {
  const wrapped = wrapWithOperatingContract('do the thing');
  assert.ok(wrapped.startsWith(OPERATING_CONTRACT));
  assert.ok(wrapped.endsWith('do the thing'));
});
