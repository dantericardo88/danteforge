// DanteSanitize live-LLM E2E (Sprint 4 — opt-in)
//
// These tests fire REAL LLM calls and are skipped by default.
// Enable with: DANTEFORGE_LIVE_LLM=1 npx tsx --test tests/sanitize-live-llm.test.ts
//
// They validate that Tier 2 (LLM fallback) actually works against a real
// model — what the mocked tests cannot prove. The corpus uses the same
// fixtures as the Sprint 9 benchmark.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeBoundariesAst } from '../src/core/sanitize-boundary.js';
import { moveSymbolsViaAst } from '../src/core/sanitize-ast-mover.js';
import { executeSplit } from '../src/core/sanitize-splitter.js';
import { checkAstDelta } from '../src/core/sanitize-validators.js';

const LIVE = process.env.DANTEFORGE_LIVE_LLM === '1';

const CORPUS_DIR = path.join(import.meta.dirname ?? '', 'fixtures', 'sanitize-corpus');

describe('DanteSanitize live-LLM E2E (opt-in via DANTEFORGE_LIVE_LLM=1)', () => {
  it('Tier 2 LLM handles decorator-class.ts that Tier 1 refused', { skip: !LIVE }, async () => {
    const filePath = path.join(CORPUS_DIR, 'decorator-class.ts');
    const content = await fs.readFile(filePath, 'utf8');

    // Construct a plan manually for the fixture: extract Config interface to a separate file
    const plan = {
      valid: true as const,
      newFiles: [{ name: 'decorator-class-types.ts', purpose: 'Extract Config interface', exports: ['Config'] }],
      retainInOriginal: ['DecoratedService'],
    };

    // Tier 1 should refuse (decorator present somewhere in file)
    const tier1 = moveSymbolsViaAst({
      content,
      filePath,
      symbols: plan.newFiles[0]!.exports,
      newFileName: plan.newFiles[0]!.name,
    });
    if (tier1.success) {
      // Tier 1 actually handled it — that's fine, Tier 2 not needed
       
      console.log('  Tier 1 handled the move (no LLM needed)');
      return;
    }

    // Tier 2: call real LLM via the splitter
    const result = await executeSplit(filePath, content, plan);
    assert.ok(result.newFiles.size === 1, 'LLM should produce one new file');
    assert.ok(result.rewrittenOriginal.length > 0, 'rewritten original should be non-empty');

    // AST-delta check: no symbols dropped
    const delta = checkAstDelta({
      originalContent: content,
      originalPath: filePath,
      rewrittenOriginal: result.rewrittenOriginal,
      newFiles: result.newFiles,
    });
    assert.ok(delta.ok, `AST delta should pass: ${delta.reason ?? ''}`);
  });

  it('Tier 2 LLM splits a synthetically large file with closures', { skip: !LIVE }, async () => {
    // Build a synthetic file too coupled for Tier 1 (closures across symbols)
    const synth = `
const sharedCounter = (() => {
  let n = 0;
  return { inc: () => ++n, get: () => n };
})();

export function incrementAndReport(): number {
  sharedCounter.inc();
  return sharedCounter.get();
}

export function reset(): void {
  while (sharedCounter.get() > 0) {
    // no-op until counter back to 0 — just for the closure example
    break;
  }
}

export interface Config { name: string; }

export function loadConfig(): Config {
  return { name: 'default' };
}
`.trimStart();

    const plan = analyzeBoundariesAst(synth, 'src/synthetic.ts', { minLocPerFile: 1, minSymbolsPerFile: 1 });
    if (!plan.valid) {
      // Plan refused — that's still useful info (boundary selector correctly couldn't split)
       
      console.log(`  Boundary selector refused: ${plan.reason}`);
      return;
    }

    // Force Tier 2 by calling executeSplit directly with the plan
    const result = await executeSplit('src/synthetic.ts', synth, plan);
    const delta = checkAstDelta({
      originalContent: synth,
      originalPath: 'src/synthetic.ts',
      rewrittenOriginal: result.rewrittenOriginal,
      newFiles: result.newFiles,
    });
    assert.ok(delta.ok, `AST delta on synthetic split: ${delta.reason ?? ''}`);
  });
});
