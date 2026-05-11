// Tests for DanteSanitize splitter — LLM analysis, generation, and prompt builders
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalysisPrompt,
  buildExtractionPrompt,
  buildRewritePrompt,
  analyzeSplitOpportunities,
  executeSplit,
  verifySplit,
} from '../src/core/sanitize-splitter.js';
import type { SplitPlan, SplitPlanFile } from '../src/core/sanitize-types.js';

// ── Prompt builder tests ──────────────────────────────────────────────────────

describe('buildAnalysisPrompt', () => {
  it('includes the file path and LOC count', () => {
    const prompt = buildAnalysisPrompt('src/core/foo.ts', 'const x = 1;', 900);
    assert.ok(prompt.includes('src/core/foo.ts'), 'should include file path');
    assert.ok(prompt.includes('900'), 'should include LOC count');
  });

  it('includes the file content', () => {
    const content = 'export function doTheThing() {}';
    const prompt = buildAnalysisPrompt('src/foo.ts', content, 800);
    assert.ok(prompt.includes(content), 'should include file content');
  });

  it('mentions the JSON schema fields', () => {
    const prompt = buildAnalysisPrompt('src/foo.ts', '', 800);
    assert.ok(prompt.includes('"valid"'), 'should mention valid field');
    assert.ok(prompt.includes('"newFiles"'), 'should mention newFiles field');
    assert.ok(prompt.includes('"exports"'), 'should mention exports field');
  });

  it('includes stem-based naming hints', () => {
    const prompt = buildAnalysisPrompt('src/core/ascend-engine.ts', '', 900);
    assert.ok(prompt.includes('ascend-engine-types.ts'), 'should suggest -types.ts name');
    assert.ok(prompt.includes('ascend-engine-utils.ts'), 'should suggest -utils.ts name');
  });
});

describe('buildExtractionPrompt', () => {
  const targetFile: SplitPlanFile = {
    name: 'foo-types.ts',
    purpose: 'TypeScript interfaces',
    exports: ['FooInterface', 'BarType'],
  };

  it('includes the target file name', () => {
    const prompt = buildExtractionPrompt('src/foo.ts', 'code', targetFile);
    assert.ok(prompt.includes('foo-types.ts'), 'should include target file name');
  });

  it('lists the exports to move', () => {
    const prompt = buildExtractionPrompt('src/foo.ts', 'code', targetFile);
    assert.ok(prompt.includes('FooInterface'), 'should include FooInterface');
    assert.ok(prompt.includes('BarType'), 'should include BarType');
  });

  it('includes original file content', () => {
    const content = 'export interface FooInterface {}';
    const prompt = buildExtractionPrompt('src/foo.ts', content, targetFile);
    assert.ok(prompt.includes(content), 'should include original file content');
  });

  it('injects typecheck error when provided', () => {
    const prompt = buildExtractionPrompt('src/foo.ts', 'code', targetFile, 'error TS2305: no export');
    assert.ok(prompt.includes('error TS2305'), 'should include typecheck error');
    assert.ok(prompt.includes('PREVIOUS ATTEMPT FAILED'), 'should include failure marker');
  });

  it('does not include error section when no typecheckError', () => {
    const prompt = buildExtractionPrompt('src/foo.ts', 'code', targetFile);
    assert.ok(!prompt.includes('PREVIOUS ATTEMPT FAILED'), 'should not include failure marker');
  });
});

describe('buildRewritePrompt', () => {
  const plan: SplitPlan = {
    valid: true,
    newFiles: [
      { name: 'foo-types.ts', purpose: 'types', exports: ['FooInterface'] },
      { name: 'foo-utils.ts', purpose: 'utils', exports: ['doThing'] },
    ],
    retainInOriginal: ['mainFn'],
  };

  it('lists all removed symbols', () => {
    const prompt = buildRewritePrompt('src/foo.ts', 'code', plan);
    assert.ok(prompt.includes('FooInterface'), 'should mention FooInterface');
    assert.ok(prompt.includes('doThing'), 'should mention doThing');
  });

  it('includes import statements for new files', () => {
    const prompt = buildRewritePrompt('src/foo.ts', 'code', plan);
    assert.ok(prompt.includes('./foo-types.js'), 'should include foo-types import');
    assert.ok(prompt.includes('./foo-utils.js'), 'should include foo-utils import');
  });

  it('injects typecheck error when provided', () => {
    const prompt = buildRewritePrompt('src/foo.ts', 'code', plan, 'TS2305 error here');
    assert.ok(prompt.includes('TS2305 error here'), 'should include typecheck error');
  });
});

// ── analyzeSplitOpportunities tests ──────────────────────────────────────────

describe('analyzeSplitOpportunities', () => {
  it('returns a valid plan when LLM returns well-formed JSON', async () => {
    const mockPlan = {
      valid: true,
      newFiles: [{ name: 'foo-types.ts', purpose: 'Types', exports: ['Foo'] }],
      retainInOriginal: ['mainFn'],
    };
    const llm = async () => JSON.stringify(mockPlan);
    const result = await analyzeSplitOpportunities('src/foo.ts', 'content', 900, llm);
    assert.equal(result.valid, true);
    assert.equal(result.newFiles.length, 1);
    assert.equal(result.newFiles[0]!.name, 'foo-types.ts');
  });

  it('strips markdown fences from LLM response', async () => {
    const mockPlan = { valid: true, newFiles: [{ name: 'foo-types.ts', purpose: 'T', exports: ['A'] }], retainInOriginal: [] };
    const llm = async () => '```json\n' + JSON.stringify(mockPlan) + '\n```';
    const result = await analyzeSplitOpportunities('src/foo.ts', 'content', 900, llm);
    assert.equal(result.valid, true);
  });

  it('returns invalid plan when LLM returns valid:false', async () => {
    const llm = async () => JSON.stringify({ valid: false, reason: 'too coupled', newFiles: [], retainInOriginal: [] });
    const result = await analyzeSplitOpportunities('src/foo.ts', 'content', 900, llm);
    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes('too coupled'));
  });

  it('returns invalid plan on malformed JSON', async () => {
    const llm = async () => 'not valid json at all';
    const result = await analyzeSplitOpportunities('src/foo.ts', 'content', 900, llm);
    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes('parse'));
  });

  it('returns invalid plan on empty newFiles array', async () => {
    const llm = async () => JSON.stringify({ valid: true, newFiles: [], retainInOriginal: [] });
    const result = await analyzeSplitOpportunities('src/foo.ts', 'content', 900, llm);
    assert.equal(result.valid, false);
  });

  it('returns invalid plan when LLM throws', async () => {
    const llm = async (): Promise<string> => { throw new Error('network error'); };
    const result = await analyzeSplitOpportunities('src/foo.ts', 'content', 900, llm);
    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes('LLM error'));
  });
});

// ── executeSplit tests ────────────────────────────────────────────────────────

describe('executeSplit', () => {
  const plan: SplitPlan = {
    valid: true,
    newFiles: [
      { name: 'foo-types.ts', purpose: 'types', exports: ['FooType'] },
      { name: 'foo-utils.ts', purpose: 'utils', exports: ['helper'] },
    ],
    retainInOriginal: ['main'],
  };

  it('calls LLM once per new file plus once for rewrite (N+1 calls)', async () => {
    const calls: string[] = [];
    const llm = async (prompt: string) => { calls.push(prompt); return 'export const x = 1;'; };
    await executeSplit('src/foo.ts', 'original content', plan, llm);
    // 2 new files + 1 rewrite = 3 calls
    assert.equal(calls.length, 3, 'should call LLM once per new file + once for rewrite');
  });

  it('returns a map with one entry per new file', async () => {
    const llm = async () => 'export const x = 1;';
    const result = await executeSplit('src/foo.ts', 'content', plan, llm);
    assert.equal(result.newFiles.size, 2);
    assert.ok(result.newFiles.has('foo-types.ts'));
    assert.ok(result.newFiles.has('foo-utils.ts'));
  });

  it('strips markdown fences from generated file content', async () => {
    const llm = async () => '```typescript\nexport const x = 1;\n```';
    const result = await executeSplit('src/foo.ts', 'content', plan, llm);
    for (const content of result.newFiles.values()) {
      assert.ok(!content.includes('```'), 'should strip markdown fences');
    }
    assert.ok(!result.rewrittenOriginal.includes('```'), 'rewritten original should not have fences');
  });

  it('passes typecheckError to prompts on retry', async () => {
    const prompts: string[] = [];
    const llm = async (p: string) => { prompts.push(p); return 'export const x = 1;'; };
    await executeSplit('src/foo.ts', 'content', plan, llm, 'TS9999: some error');
    assert.ok(prompts.some(p => p.includes('TS9999')), 'typecheck error should appear in prompts');
  });
});

// ── verifySplit tests ─────────────────────────────────────────────────────────

describe('verifySplit', () => {
  it('returns success:true when _runTypecheck passes', async () => {
    const result = await verifySplit('/tmp/test', async () => ({ success: true, output: '' }));
    assert.equal(result.success, true);
  });

  it('returns success:false when _runTypecheck fails', async () => {
    const result = await verifySplit('/tmp/test', async () => ({ success: false, output: 'TS2305 error' }));
    assert.equal(result.success, false);
    assert.ok(result.output.includes('TS2305'));
  });
});
