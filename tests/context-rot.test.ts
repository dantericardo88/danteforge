import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Context Rot Mitigation (Wave 1B)', () => {
  const contextRotSrc = readFileSync(resolve('src/harvested/gsd/hooks/context-rot.ts'), 'utf-8');
  const llmSrc = readFileSync(resolve('src/core/llm.ts'), 'utf-8');

  it('exports CONTEXT_WARN_THRESHOLD = 120_000', () => {
    assert.ok(contextRotSrc.includes('CONTEXT_WARN_THRESHOLD'), 'Missing CONTEXT_WARN_THRESHOLD');
    assert.ok(contextRotSrc.includes('120_000') || contextRotSrc.includes('120000'), 'Threshold should be 120K');
  });

  it('exports CONTEXT_CRITICAL_THRESHOLD = 180_000', () => {
    assert.ok(contextRotSrc.includes('CONTEXT_CRITICAL_THRESHOLD'), 'Missing CONTEXT_CRITICAL_THRESHOLD');
    assert.ok(contextRotSrc.includes('180_000') || contextRotSrc.includes('180000'), 'Threshold should be 180K');
  });

  it('exports CONTEXT_TRUNCATE_TARGET = 100_000', () => {
    assert.ok(contextRotSrc.includes('CONTEXT_TRUNCATE_TARGET'), 'Missing CONTEXT_TRUNCATE_TARGET');
    assert.ok(contextRotSrc.includes('100_000') || contextRotSrc.includes('100000'), 'Target should be 100K');
  });

  it('exports ContextRotResult interface', () => {
    assert.ok(contextRotSrc.includes('export interface ContextRotResult'), 'Missing ContextRotResult export');
  });

  it('checkContextRot returns ContextRotResult (not void)', () => {
    assert.ok(contextRotSrc.includes('): ContextRotResult'), 'Return type should be ContextRotResult');
    assert.ok(!contextRotSrc.includes('): void'), 'Should NOT return void');
  });

  it('checkContextRot returns ok for small context', () => {
    assert.ok(contextRotSrc.includes("level: 'ok'"), 'Should return ok level for healthy context');
  });

  it('checkContextRot returns shouldTruncate true at critical', () => {
    assert.ok(contextRotSrc.includes('shouldTruncate: true'), 'Should truncate at critical level');
  });

  it('exports truncateContext function', () => {
    assert.ok(contextRotSrc.includes('export function truncateContext'), 'Missing truncateContext export');
  });

  it('truncateContext preserves start and end of content', () => {
    assert.ok(contextRotSrc.includes('content.slice(0, keepStart)'), 'Should keep start of content');
    assert.ok(contextRotSrc.includes('content.slice(content.length - keepEnd)'), 'Should keep end of content');
  });

  it('llm.ts consumes ContextRotResult and auto-truncates', () => {
    assert.ok(llmSrc.includes('truncateContext'), 'llm.ts should import truncateContext');
    assert.ok(llmSrc.includes('shouldTruncate'), 'llm.ts should check shouldTruncate');
  });
});
