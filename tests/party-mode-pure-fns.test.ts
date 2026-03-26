import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskSummary,
  buildContextFromState,
  computeQualityScore,
  isSyntheticAgentResult,
  type PartyState,
} from '../src/harvested/dante-agents/party-mode.js';

function makeState(overrides: Partial<PartyState> = {}): PartyState {
  return {
    project: 'test-project',
    currentPhase: 1,
    tasks: {},
    lastHandoff: 'none',
    profile: 'balanced',
    ...overrides,
  };
}

describe('buildTaskSummary edge cases', () => {
  it('sorts phase keys numerically not lexicographically (phase 2 before phase 10)', () => {
    const state = makeState({
      tasks: {
        10: [{ name: 'late task' }],
        2: [{ name: 'early task' }],
      },
    });
    const summary = buildTaskSummary(state);
    const phase2Idx = summary.indexOf('Phase 2');
    const phase10Idx = summary.indexOf('Phase 10');
    assert.ok(phase2Idx !== -1, 'Phase 2 should appear in output');
    assert.ok(phase10Idx !== -1, 'Phase 10 should appear in output');
    assert.ok(phase2Idx < phase10Idx, 'Phase 2 should appear before Phase 10 (numeric sort)');
  });

  it('handles non-contiguous phases (1, 3, 7) — all listed correctly', () => {
    const state = makeState({
      tasks: {
        1: [{ name: 'init' }],
        3: [{ name: 'build' }],
        7: [{ name: 'deploy' }],
      },
    });
    const summary = buildTaskSummary(state);
    assert.ok(summary.includes('Phase 1'), 'Phase 1 should be listed');
    assert.ok(summary.includes('Phase 3'), 'Phase 3 should be listed');
    assert.ok(summary.includes('Phase 7'), 'Phase 7 should be listed');
    // Verify ordering
    const idx1 = summary.indexOf('Phase 1');
    const idx3 = summary.indexOf('Phase 3');
    const idx7 = summary.indexOf('Phase 7');
    assert.ok(idx1 < idx3 && idx3 < idx7, 'Phases should appear in ascending order');
  });

  it('tasks with undefined files shows "0 files"', () => {
    const state = makeState({
      tasks: {
        1: [{ name: 'no-files-task' }],
      },
    });
    const summary = buildTaskSummary(state);
    assert.ok(summary.includes('0 files'), 'Should show "0 files" when files is undefined');
    assert.ok(summary.includes('no-files-task'), 'Task name should appear');
  });
});

describe('buildContextFromState edge cases', () => {
  it('all optional fields absent — no crash, still includes project/phase/profile', () => {
    const state = makeState();
    const context = buildContextFromState(state, {});
    assert.ok(context.includes('test-project'), 'Should include project name');
    assert.ok(context.includes('Current Phase: 1'), 'Should include current phase');
    assert.ok(context.includes('Developer Profile: balanced'), 'Should include profile');
    assert.ok(context.includes('Workflow Stage: unknown'), 'Should default workflow stage to unknown');
    // Ensure no crash — constitution, tddEnabled, lightMode all absent
    assert.ok(!context.includes('Constitution:'), 'Should not include constitution section when absent');
    assert.ok(!context.includes('TDD Mode'), 'Should not include TDD section when absent');
    assert.ok(!context.includes('Light Mode'), 'Should not include Light Mode section when absent');
  });

  it('whitespace-only context values are skipped', () => {
    const state = makeState();
    const fullContext: Record<string, string> = {
      spec: '   \n  \t  ',
      plan: 'Real plan content',
      lessons: '   ',
    };
    const context = buildContextFromState(state, fullContext);
    assert.ok(!context.includes('## spec'), 'Whitespace-only spec should be skipped');
    assert.ok(context.includes('## plan'), 'Non-empty plan should be included');
    assert.ok(context.includes('Real plan content'), 'Plan content should appear');
    assert.ok(!context.includes('## lessons'), 'Whitespace-only lessons should be skipped');
  });
});

describe('computeQualityScore edge cases', () => {
  it('boundary at exactly 500 chars scores 40 for length component', () => {
    // Exactly 500 chars, no headings, no action items → should score 40
    const input = 'x'.repeat(500);
    const score = computeQualityScore(input);
    assert.equal(score, 40, 'Exactly 500 chars with no structure should score 40');

    // 501 chars also scores 40 (the > 500 branch)
    const inputOver = 'x'.repeat(501);
    const scoreOver = computeQualityScore(inputOver);
    assert.equal(scoreOver, 40, '501 chars with no structure should also score 40');

    // 499 chars scores Math.round(499/12.5) = Math.round(39.92) = 40 as well,
    // but let's check a significantly lower value like 250 → Math.round(250/12.5) = 20
    const inputHalf = 'x'.repeat(250);
    const scoreHalf = computeQualityScore(inputHalf);
    assert.equal(scoreHalf, 20, '250 chars with no structure should score 20');
  });
});

describe('isSyntheticAgentResult edge cases', () => {
  it('case-insensitive matching — "OFFLINE MODE" and "Configure An LLM Provider" both detected', () => {
    assert.ok(isSyntheticAgentResult('OFFLINE MODE'), 'Should match uppercase OFFLINE MODE');
    assert.ok(isSyntheticAgentResult('offline mode'), 'Should match lowercase offline mode');
    assert.ok(isSyntheticAgentResult('Offline Mode'), 'Should match title case Offline Mode');
    assert.ok(
      isSyntheticAgentResult('Configure An LLM Provider'),
      'Should match "Configure An LLM Provider" (mixed case)',
    );
    assert.ok(
      isSyntheticAgentResult('Please configure an llm provider first'),
      'Should match embedded phrase',
    );
    assert.ok(isSyntheticAgentResult('No LLM Available'), 'Should match No LLM Available');
    assert.ok(isSyntheticAgentResult('MANUAL REVIEW REQUIRED'), 'Should match MANUAL REVIEW REQUIRED');

    // Non-synthetic results should return false
    assert.ok(!isSyntheticAgentResult('Here is a real analysis of your code'), 'Real output should not be flagged');
    assert.ok(!isSyntheticAgentResult(''), 'Empty string should not be flagged');
  });
});
