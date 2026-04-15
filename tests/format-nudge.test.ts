// format-nudge.ts tests — detectCodePresence, buildFormatNudgePrompt

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCodePresence,
  buildFormatNudgePrompt,
  MAX_NUDGE_ATTEMPTS,
} from '../src/core/format-nudge.js';

describe('MAX_NUDGE_ATTEMPTS', () => {
  it('is a positive number', () => {
    assert.ok(typeof MAX_NUDGE_ATTEMPTS === 'number');
    assert.ok(MAX_NUDGE_ATTEMPTS > 0);
  });
});

describe('detectCodePresence', () => {
  it('returns true when fenced code block with no recognized format', () => {
    const response = 'Here is the code:\n```typescript\nconst x = 1;\n```';
    assert.equal(detectCodePresence(response), true);
  });

  it('returns false when SEARCH/REPLACE format present', () => {
    const response = '```\n<<<<<<< SEARCH\nold line\n=======\nnew line\n>>>>>>> REPLACE\n```';
    assert.equal(detectCodePresence(response), false);
  });

  it('returns false when NEW_FILE marker present', () => {
    const response = '```typescript\nNEW_FILE: src/foo.ts\ncontent\n```';
    assert.equal(detectCodePresence(response), false);
  });

  it('returns false when filepath marker present', () => {
    const response = '```\nfilepath: src/bar.ts\ncontent\n```';
    assert.equal(detectCodePresence(response), false);
  });

  it('returns false when no code content at all', () => {
    const response = 'This is plain text with no code.';
    assert.equal(detectCodePresence(response), false);
  });

  it('returns true for 4-backtick fenced block without format markers', () => {
    const response = '````\nsome code here\n````';
    assert.equal(detectCodePresence(response), true);
  });

  it('returns true for indented code without format markers', () => {
    const response = 'intro\n    function foo() {}\nend';
    assert.equal(detectCodePresence(response), true);
  });

  it('returns false for indented content with SEARCH/REPLACE', () => {
    const response = '    code\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE';
    assert.equal(detectCodePresence(response), false);
  });
});

describe('buildFormatNudgePrompt', () => {
  it('includes the task name', () => {
    const prompt = buildFormatNudgePrompt('implement auth', 'code here');
    assert.ok(prompt.includes('implement auth'));
  });

  it('includes the bad response', () => {
    const prompt = buildFormatNudgePrompt('task', 'const x = 1;');
    assert.ok(prompt.includes('const x = 1;'));
  });

  it('includes SEARCH/REPLACE format instructions', () => {
    const prompt = buildFormatNudgePrompt('task', 'code');
    assert.ok(prompt.includes('<<<<<<< SEARCH'));
    assert.ok(prompt.includes('>>>>>>> REPLACE'));
  });

  it('includes NEW_FILE format instructions', () => {
    const prompt = buildFormatNudgePrompt('task', 'code');
    assert.ok(prompt.includes('NEW_FILE:'));
  });

  it('truncates long responses at 3000 chars', () => {
    const longResponse = 'x'.repeat(4000);
    const prompt = buildFormatNudgePrompt('task', longResponse);
    assert.ok(prompt.includes('[response truncated]'));
    // The truncated portion should be 3000 chars
    assert.ok(!prompt.includes('x'.repeat(3001)));
  });

  it('does not truncate short responses', () => {
    const shortResponse = 'short code';
    const prompt = buildFormatNudgePrompt('task', shortResponse);
    assert.ok(!prompt.includes('[response truncated]'));
    assert.ok(prompt.includes(shortResponse));
  });

  it('returns a non-empty string', () => {
    const prompt = buildFormatNudgePrompt('my task', 'some code');
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 0);
  });
});
