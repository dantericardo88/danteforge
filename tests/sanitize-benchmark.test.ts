// DanteSanitize benchmark (Sprint 9 — local corpus)
//
// Exercises the AST splitter on a local fixture corpus mimicking the kinds of
// real-world files SWE Atlas Decomposition tests. Each fixture produces a
// pass/fail signal; the suite computes an aggregate "splitter quality" score.
//
// Future: extend with real SWE Atlas TS slice via scripts/sanitize-benchmark.mjs
// (fetches the dataset, runs each task, compares against frontier baseline).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeBoundariesAst } from '../src/core/sanitize-boundary.js';
import { moveSymbolsViaAst } from '../src/core/sanitize-ast-mover.js';
import { checkAstDelta } from '../src/core/sanitize-validators.js';

const CORPUS_DIR = path.join(import.meta.dirname ?? '', 'fixtures', 'sanitize-corpus');

interface CorpusCase {
  name: string;
  shouldSplit: boolean;
  expectedNewFiles?: string[];
  description: string;
}

const CORPUS: CorpusCase[] = [
  {
    name: 'type-heavy.ts',
    shouldSplit: true,
    expectedNewFiles: ['type-heavy-types.ts'],
    description: 'File dominated by interfaces/types/enums + one class — should extract types',
  },
  {
    name: 'mixed-concerns.ts',
    shouldSplit: true,
    expectedNewFiles: ['mixed-concerns-types.ts', 'mixed-concerns-utils.ts'],
    description: 'Types + utility functions + orchestrator — should extract both',
  },
  {
    name: 'decorator-class.ts',
    shouldSplit: false,
    description: 'Class with decorators — Tier 1 refuses; LLM fallback would be required',
  },
];

interface CaseResult {
  name: string;
  pass: boolean;
  reason?: string;
  symbolsBefore: number;
  symbolsAfter: number;
  newFilesProduced: string[];
}

async function runCase(c: CorpusCase): Promise<CaseResult> {
  const filePath = path.join(CORPUS_DIR, c.name);
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    return { name: c.name, pass: false, reason: 'fixture not found', symbolsBefore: 0, symbolsAfter: 0, newFilesProduced: [] };
  }

  // Phase 1: AST boundary plan
  const plan = analyzeBoundariesAst(content, filePath, { minLocPerFile: 5, minSymbolsPerFile: 2 });

  if (!c.shouldSplit) {
    // Expected refusal — either invalid plan OR cleanly refused via ast mover
    if (!plan.valid) {
      return { name: c.name, pass: true, symbolsBefore: 0, symbolsAfter: 0, newFilesProduced: [] };
    }
    // Plan was valid but AST mover should still refuse on decorated class
    const moveResult = moveSymbolsViaAst({
      content,
      filePath,
      symbols: plan.newFiles[0]!.exports,
      newFileName: plan.newFiles[0]!.name,
    });
    return {
      name: c.name,
      pass: !moveResult.success,
      reason: moveResult.success ? 'expected refusal but mover accepted' : undefined,
      symbolsBefore: 0,
      symbolsAfter: 0,
      newFilesProduced: [],
    };
  }

  if (!plan.valid) {
    return { name: c.name, pass: false, reason: `AST plan invalid: ${plan.reason}`, symbolsBefore: 0, symbolsAfter: 0, newFilesProduced: [] };
  }

  // Phase 2+3: execute split + validate AST delta
  let workingContent = content;
  const newFiles = new Map<string, string>();
  for (const file of plan.newFiles) {
    const moveResult = moveSymbolsViaAst({
      content: workingContent,
      filePath,
      symbols: file.exports,
      newFileName: file.name,
    });
    if (!moveResult.success) {
      return { name: c.name, pass: false, reason: `Tier 1 refused: ${moveResult.reason}`, symbolsBefore: 0, symbolsAfter: 0, newFilesProduced: [] };
    }
    newFiles.set(file.name, moveResult.newFileContent!);
    workingContent = moveResult.rewrittenOriginal!;
  }

  // AST-delta check — no symbols lost or invented
  const delta = checkAstDelta({
    originalContent: content,
    originalPath: filePath,
    rewrittenOriginal: workingContent,
    newFiles,
  });

  return {
    name: c.name,
    pass: delta.ok,
    reason: delta.ok ? undefined : delta.reason,
    symbolsBefore: delta.missing.length + delta.invented.length,  // diagnostic only
    symbolsAfter: 0,
    newFilesProduced: Array.from(newFiles.keys()),
  };
}

describe('DanteSanitize benchmark — local corpus', () => {
  it('processes the entire corpus and computes an aggregate score', async () => {
    const results: CaseResult[] = [];
    for (const c of CORPUS) {
      const r = await runCase(c);
      results.push(r);
    }
    const passed = results.filter(r => r.pass).length;
    const total = results.length;
    const passRate = (passed / total) * 100;

    // Print per-case results for visibility
    for (const r of results) {
      const icon = r.pass ? '✓' : '✗';
      const detail = r.reason ? ` — ${r.reason}` : '';
      // eslint-disable-next-line no-console
      console.log(`  ${icon} ${r.name}${detail}`);
    }
    // eslint-disable-next-line no-console
    console.log(`\n  Aggregate: ${passed}/${total} (${passRate.toFixed(1)}%)`);

    // Quality gate: corpus must pass at 100% on the AST tier
    assert.equal(passed, total, `${total - passed} fixture(s) failed`);
  });

  it('type-heavy.ts extracts interfaces into a -types file', async () => {
    const result = await runCase(CORPUS[0]!);
    assert.equal(result.pass, true);
    assert.ok(result.newFilesProduced.some(f => f.endsWith('-types.ts')));
  });

  it('mixed-concerns.ts extracts both types and utils', async () => {
    const result = await runCase(CORPUS[1]!);
    assert.equal(result.pass, true);
    assert.equal(result.newFilesProduced.length, 2);
  });

  it('decorator-class.ts is correctly refused by Tier 1', async () => {
    const result = await runCase(CORPUS[2]!);
    assert.equal(result.pass, true);
  });
});
