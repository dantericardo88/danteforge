// prompt-builder-format.test.ts — tests for v0.17.0 prompt format changes
// Verifies that buildTaskPromptWithCodeFormat has few-shot examples at the top
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskPromptWithCodeFormat, buildTaskPrompt } from '../src/core/prompt-builder.js';

const TASK = { name: 'Add input validation', files: ['src/validator.ts'], verify: 'validation works' };
const PROFILE = 'balanced';

describe('buildTaskPromptWithCodeFormat — v0.17.0 format instructions', () => {
  it('result starts with ## Code Output Format', () => {
    const result = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    assert.ok(
      result.startsWith('## Code Output Format'),
      `Expected result to start with '## Code Output Format', got: ${result.slice(0, 60)}`,
    );
  });

  it('contains the few-shot example using src/example.ts', () => {
    const result = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    assert.ok(result.includes('src/example.ts'), 'should include few-shot example filepath src/example.ts');
  });

  it('contains the greet function in the example', () => {
    const result = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    assert.ok(result.includes('greet'), 'should include greet function in the example');
    assert.ok(result.includes('Hello,'), 'should show the expected replacement in the example');
  });

  it('contains all required format markers', () => {
    const result = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    assert.ok(result.includes('<<<<<<< SEARCH'), 'should include SEARCH marker');
    assert.ok(result.includes('======='), 'should include separator marker');
    assert.ok(result.includes('>>>>>>> REPLACE'), 'should include REPLACE marker');
    assert.ok(result.includes('filepath:'), 'should include filepath instruction');
    assert.ok(result.includes('NEW_FILE:'), 'should include NEW_FILE format');
  });

  it('format instructions appear BEFORE the task name', () => {
    const result = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    const formatStart = result.indexOf('## Code Output Format');
    const taskNamePos = result.indexOf(TASK.name);
    assert.ok(formatStart >= 0, 'should contain ## Code Output Format');
    assert.ok(taskNamePos >= 0, 'should contain task name');
    assert.ok(
      formatStart < taskNamePos,
      `Format instructions (pos ${formatStart}) should appear before task name (pos ${taskNamePos})`,
    );
  });

  it('task name and profile are still present in the result', () => {
    const result = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    assert.ok(result.includes(TASK.name), 'task name should be in result');
    assert.ok(result.includes('balanced'), 'profile should be in result');
  });

  it('constitution text is included when provided', () => {
    const constitution = 'Always write unit tests. Never use any.';
    const result = buildTaskPromptWithCodeFormat(TASK, PROFILE, constitution);
    assert.ok(result.includes(constitution), 'constitution should be included');
  });

  it('result is longer than buildTaskPrompt result', () => {
    const base = buildTaskPrompt(TASK, PROFILE);
    const extended = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    assert.ok(
      extended.length > base.length,
      `Extended (${extended.length}) should be longer than base (${base.length})`,
    );
  });
});
