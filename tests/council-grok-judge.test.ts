// council-grok-judge.test.ts — grok is the reserved JUDGE-ONLY third member (#3 court independence).
// Builders are Claude + codex; grok never builds, always sits in the judge pool — so a builder-excluded
// court convenes with ≥2 independent judges of three different model families.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assignRoles, type CouncilMember } from '../src/cli/commands/council.js';

const roster: CouncilMember[] = [
  { id: 'claude-code', label: 'Claude', available: true },
  { id: 'codex', label: 'Codex', available: true },
  { id: 'grok-build', label: 'Grok', available: true, judgeOnly: true },
];

describe('assignRoles — grok reserved as judge-only (grading-integrity #3)', () => {
  test('grok is NEVER the builder; it always sits in the judge pool', () => {
    const r = assignRoles(roster);
    assert.ok(r);
    assert.notEqual(r!.builder, 'grok-build', 'grok must never build');
    assert.ok(['claude-code', 'codex'].includes(r!.builder));
    assert.ok(r!.judges.includes('grok-build'), 'grok is always an independent judge');
  });

  test('even when grok is the builderPref, a build-eligible member is chosen instead', () => {
    const r = assignRoles(roster, 'grok-build');
    assert.notEqual(r!.builder, 'grok-build');
    assert.ok(r!.judges.includes('grok-build'));
  });

  test('a builder-excluded court still has ≥2 independent judges (the #3 unlock)', () => {
    // claude builds → judges = {codex, grok} = 2 of different model families. A 2-member roster could
    // only offer 1 here, which is why the court could never convene independently before.
    const r = assignRoles(roster, 'claude-code');
    assert.equal(r!.builder, 'claude-code');
    assert.deepEqual(r!.judges.sort(), ['codex', 'grok-build']);
    assert.ok(r!.judges.length >= 2);
  });

  test('with grok unavailable it degrades to the 2-member roster (graceful, no crash)', () => {
    const r = assignRoles([
      { id: 'claude-code', label: 'Claude', available: true },
      { id: 'codex', label: 'Codex', available: true },
      { id: 'grok-build', label: 'Grok', available: false, judgeOnly: true },
    ], 'claude-code');
    assert.equal(r!.builder, 'claude-code');
    assert.deepEqual(r!.judges, ['codex']); // only 1 judge — court won't convene, handled downstream
  });

  test('a roster with ONLY a judge-only member cannot assign a builder (null)', () => {
    const r = assignRoles([{ id: 'grok-build', label: 'Grok', available: true, judgeOnly: true }]);
    assert.equal(r, null, 'no build-eligible member → no roles');
  });
});
