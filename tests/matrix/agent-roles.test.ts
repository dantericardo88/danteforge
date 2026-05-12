// Phase 14 — Tests for built-in agent role registry (harvested from CrewAI)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_ROLES,
  getRole,
  listRoles,
  registerRole,
  buildRolePromptBlock,
} from '../../src/matrix/engines/agent-roles.js';

describe('agent-roles registry', () => {
  it('exposes the six built-in roles', () => {
    const ids = BUILT_IN_ROLES.map(r => r.id).sort();
    assert.deepEqual(ids, [
      'dimension-engineer',
      'merge-court',
      'red-team',
      'retro-analyst',
      'taste-gate',
      'verification-court',
    ]);
  });

  it('every built-in role has role + goal + backstory populated', () => {
    for (const r of BUILT_IN_ROLES) {
      assert.ok(r.role.length > 10, `${r.id}: role too short`);
      assert.ok(r.goal.length > 10, `${r.id}: goal too short`);
      assert.ok(r.backstory.length > 10, `${r.id}: backstory too short`);
    }
  });

  it('getRole returns a known role and undefined for unknown', () => {
    assert.equal(getRole('dimension-engineer')?.label, 'Dimension Engineer');
    assert.equal(getRole('nonexistent-role'), undefined);
  });

  it('listRoles includes all built-ins', () => {
    assert.ok(listRoles().length >= BUILT_IN_ROLES.length);
  });

  it('registerRole adds a custom role accessible via getRole', () => {
    registerRole({
      id: 'custom-test-role',
      label: 'Custom Test',
      role: 'A test-only role.',
      goal: 'Verify registration works.',
      backstory: 'You exist solely to confirm the registry mutates.',
      toolHints: [],
    });
    assert.equal(getRole('custom-test-role')?.label, 'Custom Test');
  });

  it('red-team + retro-analyst have persistentMemory=true', () => {
    assert.equal(getRole('red-team')?.persistentMemory, true);
    assert.equal(getRole('retro-analyst')?.persistentMemory, true);
  });

  it('dimension-engineer has persistentMemory=false (default)', () => {
    assert.notEqual(getRole('dimension-engineer')?.persistentMemory, true);
  });
});

describe('buildRolePromptBlock', () => {
  it('returns a non-empty block for a known role', () => {
    const block = buildRolePromptBlock('dimension-engineer');
    assert.ok(block.includes('Dimension Engineer'));
    assert.ok(block.includes('Goal:'));
    assert.ok(block.includes('Voice:'));
  });

  it('returns empty string for an unknown role', () => {
    assert.equal(buildRolePromptBlock('not-a-real-role-xyz'), '');
  });
});
