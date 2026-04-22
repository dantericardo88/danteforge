import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runDeterministicChecks,
  parseCritiqueResponse,
  buildCritiquePrompt,
} from '../src/core/plan-critic.js';

describe('runDeterministicChecks', () => {
  it('returns empty array for clean plan content', () => {
    const result = runDeterministicChecks('A clean plan with no issues.', '');
    assert.ok(Array.isArray(result));
  });

  it('detects hardcoded paths in combined content', () => {
    const result = runDeterministicChecks('', 'path.join("~/Documents")');
    const found = result.some(g => g.category === 'platform');
    assert.ok(found, `Expected platform gap for hardcoded path, got categories: ${result.map(g => g.category).join(', ')}`);
  });

  it('detects vague language when 3+ vague signals present', () => {
    // Uses actual PLAN_VAGUENESS_SIGNALS: somehow, maybe, probably, TBD, etc.
    const vagueText = 'We will somehow implement this. Maybe it works. TBD. Roughly speaking, probably.';
    const result = runDeterministicChecks(vagueText, '');
    const honesty = result.find(g => g.category === 'honesty');
    assert.ok(honesty, `Expected honesty gap for vague language`);
  });

  it('returns CritiqueGap objects with required fields', () => {
    const result = runDeterministicChecks('We will simply do this trivial simple just basic task.', '');
    for (const gap of result) {
      assert.ok(typeof gap.category === 'string');
      assert.ok(typeof gap.description === 'string');
      assert.ok(typeof gap.severity === 'string');
    }
  });
});

describe('parseCritiqueResponse', () => {
  it('returns empty array for empty string', () => {
    const result = parseCritiqueResponse('');
    assert.deepEqual(result, []);
  });

  it('returns empty array for invalid JSON', () => {
    const result = parseCritiqueResponse('not json');
    assert.deepEqual(result, []);
  });

  it('parses valid JSON critique response', () => {
    const json = JSON.stringify([
      { category: 'reality', severity: 'blocking', description: 'Function does not exist', specificFix: 'Create it.' },
    ]);
    const result = parseCritiqueResponse(json);
    assert.equal(result.length, 1);
    assert.equal(result[0].category, 'reality');
    assert.equal(result[0].severity, 'blocking');
  });

  it('strips markdown code fences', () => {
    const json = '```json\n[{"category": "security", "severity": "high", "description": "Exposed key"}]\n```';
    const result = parseCritiqueResponse(json);
    assert.equal(result.length, 1);
    assert.equal(result[0].category, 'security');
  });

  it('defaults invalid category to "honesty"', () => {
    const json = JSON.stringify([{ category: 'unknown-xyz', severity: 'high', description: 'Some issue' }]);
    const result = parseCritiqueResponse(json);
    assert.equal(result.length, 1);
    assert.equal(result[0].category, 'honesty');
  });

  it('defaults invalid severity to "medium"', () => {
    const json = JSON.stringify([{ category: 'reality', severity: 'unknown', description: 'Issue' }]);
    const result = parseCritiqueResponse(json);
    assert.equal(result.length, 1);
    assert.equal(result[0].severity, 'medium');
  });

  it('filters out non-object items', () => {
    const json = JSON.stringify([null, 'string-item', { category: 'ordering', severity: 'medium', description: 'Ok' }]);
    const result = parseCritiqueResponse(json);
    assert.equal(result.length, 1);
  });

  it('includes relatedFiles when provided as string array', () => {
    const json = JSON.stringify([{
      category: 'platform',
      severity: 'high',
      description: 'Platform issue',
      relatedFiles: ['src/core/state.ts', 'src/cli/index.ts'],
    }]);
    const result = parseCritiqueResponse(json);
    assert.ok(Array.isArray(result[0].relatedFiles));
    assert.equal(result[0].relatedFiles?.length, 2);
  });
});

describe('buildCritiquePrompt', () => {
  it('includes plan content in the prompt', () => {
    const prompt = buildCritiquePrompt('general', 'My plan content', 'source files', 'lessons', 'high stakes');
    assert.ok(prompt.includes('My plan content'));
  });

  it('includes source files in the prompt', () => {
    const prompt = buildCritiquePrompt('security', 'plan', 'import auth from "auth"', 'lessons', 'medium');
    assert.ok(prompt.includes('import auth from "auth"'));
  });

  it('is a non-empty string', () => {
    const prompt = buildCritiquePrompt('platform', 'plan', '', '', 'low');
    assert.ok(typeof prompt === 'string' && prompt.length > 0);
  });

  it('varies by persona (platform vs security)', () => {
    const platformPrompt = buildCritiquePrompt('platform', 'plan', '', '', '');
    const securityPrompt = buildCritiquePrompt('security', 'plan', '', '', '');
    assert.notEqual(platformPrompt, securityPrompt);
  });
});
