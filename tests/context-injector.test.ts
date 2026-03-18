// Context Injector tests — progressive disclosure, token budgets, formatting
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildProgressiveContext } from '../src/core/context-injector.js';
import type { MemoryEntry } from '../src/core/memory-store.js';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: `test-${Date.now()}-${Math.random()}`,
    timestamp: new Date().toISOString(),
    sessionId: 'test-session',
    category: 'command',
    summary: 'Test entry',
    detail: 'Detailed test information',
    tags: ['test'],
    relatedCommands: [],
    tokenCount: 10,
    ...overrides,
  };
}

describe('buildProgressiveContext', () => {
  it('returns empty string when no memories or lessons', () => {
    const result = buildProgressiveContext([], '', 1000);
    assert.strictEqual(result, '');
  });

  it('includes corrections in tier 1 (highest priority)', () => {
    const memories = [
      makeEntry({ category: 'correction', summary: 'Fix: use snake_case for DB columns' }),
      makeEntry({ category: 'command', summary: 'Ran npm test' }),
    ];
    const result = buildProgressiveContext(memories, '', 1000);
    assert.ok(result.includes('[CORRECTION]'));
    assert.ok(result.includes('snake_case'));
  });

  it('includes errors in tier 1', () => {
    const memories = [
      makeEntry({ category: 'error', summary: 'Build failed: missing import' }),
    ];
    const result = buildProgressiveContext(memories, '', 1000);
    assert.ok(result.includes('[ERROR]'));
    assert.ok(result.includes('missing import'));
  });

  it('includes decisions in tier 2', () => {
    const memories = [
      makeEntry({ category: 'decision', summary: 'Chose PostgreSQL over MongoDB' }),
    ];
    const result = buildProgressiveContext(memories, '', 1000);
    assert.ok(result.includes('[DECISION]'));
    assert.ok(result.includes('PostgreSQL'));
  });

  it('includes lessons from lessons file', () => {
    const lessons = '- Always validate input before DB write\n- Use parameterized queries';
    const result = buildProgressiveContext([], lessons, 1000);
    assert.ok(result.includes('[LESSON]'));
    assert.ok(result.includes('validate input'));
  });

  it('respects token budget by truncating lower tiers', () => {
    const memories = [
      makeEntry({ category: 'correction', summary: 'Critical fix: always sanitize HTML' }),
      makeEntry({ category: 'decision', summary: 'Chose React over Vue for the frontend framework' }),
      makeEntry({ category: 'command', summary: 'Executed full build pipeline successfully' }),
    ];
    // Very small budget — should only include tier 1
    const result = buildProgressiveContext(memories, '', 20);
    assert.ok(result.includes('[CORRECTION]'));
    // Tier 3 command may not fit
  });

  it('formats multiple tiers with headers', () => {
    const memories = [
      makeEntry({ category: 'correction', summary: 'Fix A' }),
      makeEntry({ category: 'decision', summary: 'Decision B' }),
      makeEntry({ category: 'command', summary: 'Command C' }),
    ];
    const result = buildProgressiveContext(memories, '', 10000);
    assert.ok(result.includes('### Critical Corrections'));
    assert.ok(result.includes('### Recent Decisions'));
    assert.ok(result.includes('### Historical Context'));
  });
});
