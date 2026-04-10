// prompt-builder-code-format.test.ts — tests for buildTaskPromptWithCodeFormat
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskPromptWithCodeFormat, buildTaskPrompt } from '../src/core/prompt-builder.js';

const TASK = { name: 'Add authentication endpoint', verify: 'Returns 200 for valid JWT' };
const PROFILE = 'balanced';
const CONSTITUTION = 'Always write tests. Never expose secrets.';

describe('buildTaskPromptWithCodeFormat', () => {
  // 1. Returns a string containing SEARCH/REPLACE format instructions
  it('returns a string containing SEARCH/REPLACE format instructions', () => {
    const prompt = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    assert.ok(
      prompt.includes('SEARCH/REPLACE'),
      `Prompt must include SEARCH/REPLACE instructions. Got: ${prompt.slice(0, 300)}`,
    );
  });

  // 2. Contains NEW_FILE: format instructions
  it('contains NEW_FILE: format instructions for creating files', () => {
    const prompt = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    assert.ok(
      prompt.includes('NEW_FILE:'),
      `Prompt must include NEW_FILE: format instructions. Got: ${prompt.slice(0, 300)}`,
    );
  });

  // 3. Contains >>>>>>> REPLACE and <<<<<<< SEARCH delimiters as examples
  it('contains both <<<<<<< SEARCH and >>>>>>> REPLACE delimiters', () => {
    const prompt = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    assert.ok(prompt.includes('<<<<<<< SEARCH'), 'Prompt must show <<<<<<< SEARCH delimiter');
    assert.ok(prompt.includes('>>>>>>> REPLACE'), 'Prompt must show >>>>>>> REPLACE delimiter');
  });

  // 4. Contains filepath: instruction
  it('contains filepath: instruction showing where to specify the file path', () => {
    const prompt = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    assert.ok(
      prompt.includes('filepath:'),
      `Prompt must include filepath: instruction. Got: ${prompt.slice(0, 300)}`,
    );
  });

  // 5. Starts with the same base prompt as buildTaskPrompt (task name is present in both)
  it('contains the same task name as buildTaskPrompt', () => {
    const base = buildTaskPrompt(TASK, PROFILE);
    const extended = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    assert.ok(
      base.includes(TASK.name),
      'buildTaskPrompt must include the task name',
    );
    assert.ok(
      extended.includes(TASK.name),
      'buildTaskPromptWithCodeFormat must also include the task name',
    );
  });

  // 6. Includes task name, profile, verification criteria
  it('includes task name, profile, and verification criteria', () => {
    const prompt = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    assert.ok(prompt.includes(TASK.name), 'Must include task name');
    assert.ok(prompt.includes(PROFILE), 'Must include profile');
    assert.ok(prompt.includes(TASK.verify!), 'Must include verification criteria');
  });

  // 7. Includes constitution when provided
  it('includes constitution text when provided', () => {
    const prompt = buildTaskPromptWithCodeFormat(TASK, PROFILE, CONSTITUTION);
    assert.ok(
      prompt.includes(CONSTITUTION),
      `Prompt must include the constitution text. Got: ${prompt.slice(0, 400)}`,
    );
  });

  // 8. Format instructions now come BEFORE base prompt content (v0.17.0 — moved to top for LLM attention)
  it('format instructions appear before the base task prompt content', () => {
    const base = buildTaskPrompt(TASK, PROFILE);
    const extended = buildTaskPromptWithCodeFormat(TASK, PROFILE);

    // The extended prompt must contain the base prompt (now as suffix, not prefix)
    assert.ok(
      extended.includes(base),
      'buildTaskPromptWithCodeFormat must contain the base buildTaskPrompt output',
    );

    // Format instructions come BEFORE task content (moved to top for higher LLM attention weight)
    const formatStart = extended.indexOf('## Code Output Format');
    const taskNamePos = extended.indexOf(TASK.name);
    assert.ok(
      formatStart < taskNamePos,
      'Format instructions must appear BEFORE the task name (instructions moved to top in v0.17.0)',
    );
  });

  // 9. Works with a task that has no files or verify fields
  it('works for a minimal task with only a name', () => {
    const minimalTask = { name: 'Minimal task' };
    const prompt = buildTaskPromptWithCodeFormat(minimalTask, PROFILE);
    assert.ok(prompt.includes('Minimal task'), 'Must include task name');
    assert.ok(prompt.includes('SEARCH/REPLACE'), 'Must include format instructions');
  });

  // 10. Extended prompt is strictly longer than the base prompt
  it('returns a longer string than buildTaskPrompt (format instructions are appended)', () => {
    const base = buildTaskPrompt(TASK, PROFILE);
    const extended = buildTaskPromptWithCodeFormat(TASK, PROFILE);
    assert.ok(
      extended.length > base.length,
      `Extended prompt (${extended.length} chars) must be longer than base (${base.length} chars)`,
    );
  });
});
