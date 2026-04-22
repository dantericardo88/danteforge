import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTask,
  generateCompensation,
  createEmptyProfile,
  computeTrend,
} from '../src/core/model-profile.js';
import type { WeaknessPattern } from '../src/core/model-profile.js';

function makeWeakness(overrides: Partial<WeaknessPattern> = {}): WeaknessPattern {
  return {
    id: 'w-001',
    description: 'Fails on auth token refresh',
    category: 'authentication',
    severity: 'high',
    occurrenceCount: 3,
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-15T00:00:00.000Z',
    compensated: false,
    ...overrides,
  };
}

describe('classifyTask', () => {
  it('returns ["general"] for unrecognized description', () => {
    const result = classifyTask('do something vague');
    assert.deepEqual(result, ['general']);
  });

  it('classifies authentication tasks', () => {
    const result = classifyTask('Implement JWT token refresh and OAuth2 login');
    assert.ok(result.includes('authentication'), `Expected authentication, got: ${result.join(', ')}`);
  });

  it('classifies database tasks', () => {
    const result = classifyTask('Write a SQL query to join the users table');
    assert.ok(result.includes('database'), `Expected database, got: ${result.join(', ')}`);
  });

  it('classifies testing tasks', () => {
    const result = classifyTask('Write unit tests for the payment module');
    assert.ok(result.includes('testing'), `Expected testing, got: ${result.join(', ')}`);
  });

  it('classifies UI tasks', () => {
    const result = classifyTask('Build a React component for the user dashboard');
    assert.ok(result.includes('ui'), `Expected ui, got: ${result.join(', ')}`);
  });

  it('classifies security tasks', () => {
    const result = classifyTask('Fix XSS vulnerability in the search input');
    assert.ok(result.includes('security'), `Expected security, got: ${result.join(', ')}`);
  });

  it('can return multiple categories', () => {
    const result = classifyTask('Write tests for the database migration');
    assert.ok(result.length >= 1);
  });
});

describe('generateCompensation', () => {
  it('returns a compensation rule with correct ids', () => {
    const weakness = makeWeakness();
    const result = generateCompensation(weakness);
    assert.equal(result.id, 'comp_w-001');
    assert.equal(result.weaknessId, 'w-001');
    assert.equal(result.source, 'auto');
    assert.ok(result.appliesTo.includes('authentication'));
  });

  it('includes category-specific instruction', () => {
    const weakness = makeWeakness({ category: 'database' });
    const result = generateCompensation(weakness);
    assert.ok(result.instruction.includes('database'), `Expected database instruction, got: ${result.instruction}`);
  });

  it('falls back to general instruction for unknown category', () => {
    const weakness = makeWeakness({ category: 'unknown-category-xyz' });
    const result = generateCompensation(weakness);
    assert.ok(result.instruction.includes('complete'), 'General fallback should mention completing requirements');
  });

  it('appends weakness description as context when non-empty', () => {
    const weakness = makeWeakness({ description: 'Specific context here' });
    const result = generateCompensation(weakness);
    assert.ok(result.instruction.includes('Specific context here'));
  });

  it('does not append context when description is empty', () => {
    const weakness = makeWeakness({ description: '' });
    const result = generateCompensation(weakness);
    assert.ok(!result.instruction.includes('Context:'));
  });
});

describe('createEmptyProfile', () => {
  it('creates a profile with correct modelKey', () => {
    const profile = createEmptyProfile('anthropic', 'claude-3-5');
    assert.equal(profile.modelKey, 'anthropic:claude-3-5');
  });

  it('starts with zero totalTasks', () => {
    const profile = createEmptyProfile('openai', 'gpt-4');
    assert.equal(profile.totalTasks, 0);
  });

  it('starts with empty arrays for weaknesses, strengths, compensations', () => {
    const profile = createEmptyProfile('openai', 'gpt-4');
    assert.deepEqual(profile.weaknesses, []);
    assert.deepEqual(profile.strengths, []);
    assert.deepEqual(profile.compensations, []);
  });

  it('starts with zero aggregate scores', () => {
    const profile = createEmptyProfile('openai', 'gpt-4');
    assert.equal(profile.aggregate.averagePdse, 0);
    assert.equal(profile.aggregate.firstPassSuccessRate, 0);
  });

  it('sets createdAt and updatedAt as ISO strings', () => {
    const profile = createEmptyProfile('test', 'model');
    assert.ok(!isNaN(Date.parse(profile.createdAt)));
    assert.ok(!isNaN(Date.parse(profile.updatedAt)));
  });
});

describe('computeTrend', () => {
  it('returns stable for fewer than 4 scores', () => {
    assert.equal(computeTrend([]), 'stable');
    assert.equal(computeTrend([{ timestamp: '2026-01-01', pdse: 80 }]), 'stable');
    assert.equal(computeTrend([
      { timestamp: '2026-01-01', pdse: 80 },
      { timestamp: '2026-01-02', pdse: 85 },
      { timestamp: '2026-01-03', pdse: 90 },
    ]), 'stable');
  });

  it('returns improving when second half average is > 3 above first half', () => {
    const scores = [
      { timestamp: '2026-01-01', pdse: 60 },
      { timestamp: '2026-01-02', pdse: 60 },
      { timestamp: '2026-01-03', pdse: 70 },
      { timestamp: '2026-01-04', pdse: 70 },
    ];
    assert.equal(computeTrend(scores), 'improving');
  });

  it('returns declining when second half average is > 3 below first half', () => {
    const scores = [
      { timestamp: '2026-01-01', pdse: 80 },
      { timestamp: '2026-01-02', pdse: 80 },
      { timestamp: '2026-01-03', pdse: 70 },
      { timestamp: '2026-01-04', pdse: 70 },
    ];
    assert.equal(computeTrend(scores), 'declining');
  });

  it('returns stable when delta is within ±3', () => {
    const scores = [
      { timestamp: '2026-01-01', pdse: 75 },
      { timestamp: '2026-01-02', pdse: 76 },
      { timestamp: '2026-01-03', pdse: 77 },
      { timestamp: '2026-01-04', pdse: 78 },
    ];
    assert.equal(computeTrend(scores), 'stable');
  });
});
