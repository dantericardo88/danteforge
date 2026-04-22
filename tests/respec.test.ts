import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runRespec } from '../src/cli/commands/respec.js';
import type { RefusedPatternsStore } from '../src/core/refused-patterns.js';

const MOCK_SPEC = '# MyApp Spec\n\n## Feature\nBuild a todo manager.\n\n## Acceptance Criteria\n- 1. Tasks can be added\n- 2. Tasks can be completed';
const MOCK_LESSONS = '- Do not use polling loops; use event-driven architecture instead\n- Always validate input at boundaries';
const EMPTY_REFUSED: RefusedPatternsStore = { version: '1.0.0', patterns: [], updatedAt: '' };

describe('respec command', () => {
  it('T1: loads spec + lessons and calls LLM with both', async () => {
    let promptReceived = '';
    const result = await runRespec({
      _loadSpec: async () => MOCK_SPEC,
      _loadLessons: async () => MOCK_LESSONS,
      _loadRefused: async () => EMPTY_REFUSED,
      _callLLM: async (p) => { promptReceived = p; return '# Revised Spec\n\nRevised content.'; },
      _writeSpec: async () => {},
    });
    assert.strictEqual(result.revised, true);
    assert.ok(promptReceived.includes('CURRENT SPEC'), 'prompt must include current spec header');
    assert.ok(promptReceived.includes('LESSONS LEARNED'), 'prompt must include lessons section');
    assert.ok(promptReceived.includes('Do not use polling loops'), 'prompt must include lesson content');
  });

  it('T2: writes revised spec via _writeSpec', async () => {
    let written = '';
    await runRespec({
      _loadSpec: async () => MOCK_SPEC,
      _loadLessons: async () => null,
      _loadRefused: async () => EMPTY_REFUSED,
      _callLLM: async () => '# Revised\nNew content.',
      _writeSpec: async (content) => { written = content; },
    });
    assert.ok(written.length > 0, 'spec content must be written');
    assert.ok(written.includes('Revised'), 'written content must be the LLM response');
  });

  it('T3: injects refused pattern names into prompt', async () => {
    let promptReceived = '';
    const refused: RefusedPatternsStore = {
      version: '1.0.0',
      patterns: [{ patternName: 'lazy-retry', sourceRepo: 'acme/repo', refusedAt: '', reason: 'hypothesis-falsified', laggingDelta: -0.2 }],
      updatedAt: '',
    };
    await runRespec({
      _loadSpec: async () => MOCK_SPEC,
      _loadLessons: async () => null,
      _loadRefused: async () => refused,
      _callLLM: async (p) => { promptReceived = p; return '# Revised'; },
      _writeSpec: async () => {},
    });
    assert.ok(promptReceived.includes('lazy-retry'), 'prompt must include refused pattern name');
    assert.ok(promptReceived.includes('REFUSED PATTERNS'), 'prompt must include refused patterns section');
  });

  it('T4: handles missing lessons gracefully (proceeds with spec only)', async () => {
    const result = await runRespec({
      _loadSpec: async () => MOCK_SPEC,
      _loadLessons: async () => null,
      _loadRefused: async () => EMPTY_REFUSED,
      _callLLM: async () => '# Revised',
      _writeSpec: async () => {},
    });
    assert.strictEqual(result.revised, true);
    assert.strictEqual(result.lessonsInjected, 0);
  });

  it('T5: handles missing spec — returns revised=false without calling LLM', async () => {
    let llmCalled = false;
    const result = await runRespec({
      _loadSpec: async () => null,
      _loadLessons: async () => null,
      _loadRefused: async () => EMPTY_REFUSED,
      _callLLM: async () => { llmCalled = true; return ''; },
      _writeSpec: async () => {},
    });
    assert.strictEqual(result.revised, false);
    assert.strictEqual(llmCalled, false, 'LLM must not be called when spec is missing');
  });

  it('T6: result includes lessonsInjected count', async () => {
    const result = await runRespec({
      _loadSpec: async () => MOCK_SPEC,
      _loadLessons: async () => MOCK_LESSONS,
      _loadRefused: async () => EMPTY_REFUSED,
      _callLLM: async () => '# Revised',
      _writeSpec: async () => {},
    });
    assert.strictEqual(result.revised, true);
    assert.ok(result.lessonsInjected > 0, 'lessonsInjected must be > 0 when lessons present');
  });
});
