// maturity-engine — Security + Performance scorer regression tests
// Verifies: false positive prevention, bonus signals, test-file exclusions

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import {
  scoreMaturityDimensions,
  stripStringLiterals,
  type MaturityContext,
} from '../src/core/maturity-engine.js';
import type { DanteState } from '../src/core/state.js';

function makeCtx(cwd: string): MaturityContext {
  return {
    cwd,
    state: { projectType: 'cli' } as DanteState,
    pdseScores: {},
    targetLevel: 4,
  };
}

describe('stripStringLiterals', () => {
  it('strips single-quoted string content', () => {
    const src = `const msg = 'eval() usage detected';`;
    const result = stripStringLiterals(src);
    assert.ok(!result.includes('eval()'), 'eval() inside single-quoted string should be stripped');
    assert.ok(result.includes('const msg ='), 'surrounding code should be preserved');
  });

  it('strips double-quoted string content', () => {
    const src = `const pattern = "innerHTML = value";`;
    const result = stripStringLiterals(src);
    assert.ok(!result.includes('innerHTML'), 'innerHTML inside double-quoted string should be stripped');
  });

  it('strips template literal content', () => {
    const src = 'const desc = `eval( is dangerous`;';
    const result = stripStringLiterals(src);
    assert.ok(!result.includes('eval('), 'eval( inside template literal should be stripped');
  });

  it('preserves live code outside strings', () => {
    const src = `const x = eval(code);`;
    const result = stripStringLiterals(src);
    assert.ok(result.includes('eval('), 'eval( in live code should NOT be stripped');
  });

  it('preserves line structure (no newline removal)', () => {
    const src = `const a = 'one';\nconst b = 'two';`;
    const result = stripStringLiterals(src);
    assert.ok(result.includes('\n'), 'newlines should be preserved');
  });
});

describe('scoreSecurity — false positive prevention', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(await fs.realpath(process.cwd()), '.tmp-sec-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('does NOT flag eval() inside string literals', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    // Simulate paranoid-review.ts pattern: describes what it scans for in a string
    await fs.writeFile(
      path.join(srcDir, 'paranoid-review.ts'),
      `const PATTERNS = ['eval() usage detected — potential code injection risk'];
export function checkPatterns(code: string) { return PATTERNS.some(p => code.includes(p)); }`,
    );

    const dimensions = await scoreMaturityDimensions(makeCtx(tmpDir));
    // 70 base, no penalties (eval( is in a string literal, not live code)
    assert.ok(dimensions.security >= 70, `security should be ≥70, got ${dimensions.security}`);
  });

  it('does NOT flag innerHTML= inside string pattern definitions', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    // Simulate pattern-security-scanner.ts: uses the string to describe what to find
    await fs.writeFile(
      path.join(srcDir, 'pattern-scanner.ts'),
      `const DANGEROUS = ["innerHTML = user_input", "document.write("];
export function scan(code: string) { return DANGEROUS.some(p => code.includes(p)); }`,
    );

    const dimensions = await scoreMaturityDimensions(makeCtx(tmpDir));
    assert.ok(dimensions.security >= 70, `security should be ≥70, got ${dimensions.security}`);
  });

  it('DOES flag actual eval() in live code (not a string)', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, 'bad.ts'),
      `export function runCode(input: string) { return eval(input); }`,
    );

    const dimensions = await scoreMaturityDimensions(makeCtx(tmpDir));
    // Should get penalized: 70 - 10 = 60
    assert.ok(dimensions.security < 70, `security should be <70 for actual eval(), got ${dimensions.security}`);
  });

  it('awards +10 when .env file exists in project root', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'clean.ts'), `export const x = 1;`);
    await fs.writeFile(path.join(tmpDir, '.env'), 'OLLAMA_HOST=http://localhost:11434\n');

    const dimensions = await scoreMaturityDimensions(makeCtx(tmpDir));
    // 70 base + 10 .env = 80
    assert.ok(dimensions.security >= 80, `security should be ≥80 with .env, got ${dimensions.security}`);
  });
});

describe('scorePerformance — test file exclusion + bonus', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(await fs.realpath(process.cwd()), '.tmp-perf-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('does not penalize test files for sequential await patterns', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    // A clean source file with no issues
    await fs.writeFile(path.join(srcDir, 'app.ts'), `export const app = 'clean';`);
    // A "test file" inside src that would normally trigger N+1 detection
    const testsDir = path.join(tmpDir, 'tests');
    await fs.mkdir(testsDir, { recursive: true });
    await fs.writeFile(
      path.join(testsDir, 'integration.test.ts'),
      `for (const item of items) { await readFile(item); }`,
    );

    const dimensions = await scoreMaturityDimensions(makeCtx(tmpDir));
    // tests/ dir is excluded — only src/app.ts is scanned, which is clean
    assert.ok(dimensions.performance >= 70, `performance should be ≥70 when test files excluded, got ${dimensions.performance}`);
  });

  it('awards +10 when .danteforge/performance-baseline.json exists', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'app.ts'), `export const app = 'clean';`);
    const dfDir = path.join(tmpDir, '.danteforge');
    await fs.mkdir(dfDir, { recursive: true });
    await fs.writeFile(
      path.join(dfDir, 'performance-baseline.json'),
      JSON.stringify({ capturedAt: '2026-04-13T00:00:00.000Z', buildMs: 2000 }),
    );

    const dimensions = await scoreMaturityDimensions(makeCtx(tmpDir));
    // 70 base + 10 baseline = 80 minimum
    assert.ok(dimensions.performance >= 80, `performance should be ≥80 with baseline, got ${dimensions.performance}`);
  });
});
