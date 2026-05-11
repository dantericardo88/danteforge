// Tests for DanteSanitize validators (Sprint 5)
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkAstDelta, findAffectedTests, validatePostSplit } from '../src/core/sanitize-validators.js';

const tmpDirs: string[] = [];
async function makeTmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'dante-validators-'));
  tmpDirs.push(d);
  return d;
}
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

// ── checkAstDelta ────────────────────────────────────────────────────────────

describe('checkAstDelta', () => {
  it('returns ok:true when symbols are preserved across split', () => {
    const original = `
export interface Foo { x: number; }
export interface Bar { y: number; }
export function main() { return 1; }
`.trimStart();
    const rewritten = `
import { Foo, Bar } from './foo-types.js';
export function main() { return 1; }
`.trimStart();
    const newFiles = new Map([['foo-types.ts', 'export interface Foo { x: number; }\nexport interface Bar { y: number; }']]);
    const result = checkAstDelta({
      originalContent: original,
      originalPath: 'src/foo.ts',
      rewrittenOriginal: rewritten,
      newFiles,
    });
    assert.equal(result.ok, true);
    assert.equal(result.missing.length, 0);
    assert.equal(result.invented.length, 0);
  });

  it('detects a dropped symbol', () => {
    const original = `
export interface Foo { x: number; }
export interface Bar { y: number; }
export function main() {}
`.trimStart();
    // Rewritten "forgets" Bar
    const rewritten = `
import { Foo } from './foo-types.js';
export function main() {}
`.trimStart();
    const newFiles = new Map([['foo-types.ts', 'export interface Foo { x: number; }']]);
    const result = checkAstDelta({
      originalContent: original,
      originalPath: 'src/foo.ts',
      rewrittenOriginal: rewritten,
      newFiles,
    });
    assert.equal(result.ok, false);
    assert.ok(result.missing.includes('Bar'));
    assert.ok(result.reason?.includes('Bar'));
  });

  it('detects an invented symbol', () => {
    const original = `export interface Foo {}\nexport function main() {}`;
    const rewritten = `
import { Foo } from './foo-types.js';
export function main() {}
`.trimStart();
    const newFiles = new Map([['foo-types.ts', 'export interface Foo {}\nexport interface Hallucinated {}']]);
    const result = checkAstDelta({
      originalContent: original,
      originalPath: 'src/foo.ts',
      rewrittenOriginal: rewritten,
      newFiles,
    });
    assert.equal(result.ok, false);
    assert.ok(result.invented.includes('Hallucinated'));
  });

  it('detects a kind-changed symbol', () => {
    const original = `export interface Foo {}\nexport function main() {}`;
    const rewritten = `
import { Foo } from './foo-types.js';
export function main() {}
`.trimStart();
    // 'Foo' is now a type alias instead of an interface
    const newFiles = new Map([['foo-types.ts', 'export type Foo = { x: number };']]);
    const result = checkAstDelta({
      originalContent: original,
      originalPath: 'src/foo.ts',
      rewrittenOriginal: rewritten,
      newFiles,
    });
    assert.equal(result.ok, false);
    assert.ok(result.renamed.some(r => r.startsWith('Foo')));
  });
});

// ── findAffectedTests ────────────────────────────────────────────────────────

describe('findAffectedTests', () => {
  it('returns empty array when no tests directory exists', async () => {
    const cwd = await makeTmp();
    const affected = await findAffectedTests({ cwd, filePath: 'src/foo.ts' });
    assert.deepEqual(affected, []);
  });

  it('finds test files that import the target stem', async () => {
    const cwd = await makeTmp();
    await fs.mkdir(path.join(cwd, 'tests'), { recursive: true });
    await fs.writeFile(
      path.join(cwd, 'tests', 'foo.test.ts'),
      `import { thing } from '../src/core/foo.js';\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(cwd, 'tests', 'bar.test.ts'),
      `import { other } from '../src/bar.js';\n`,
      'utf8',
    );
    const affected = await findAffectedTests({ cwd, filePath: 'src/core/foo.ts' });
    assert.equal(affected.length, 1);
    assert.ok(affected[0]!.endsWith('foo.test.ts'));
  });

  it('does not match partial stem names', async () => {
    const cwd = await makeTmp();
    await fs.mkdir(path.join(cwd, 'tests'), { recursive: true });
    await fs.writeFile(
      path.join(cwd, 'tests', 'foobar.test.ts'),
      `import { thing } from '../src/foobar.js';\n`,
      'utf8',
    );
    const affected = await findAffectedTests({ cwd, filePath: 'src/foo.ts' });
    assert.equal(affected.length, 0, 'should not match foobar when looking for foo');
  });
});

// ── validatePostSplit ────────────────────────────────────────────────────────

describe('validatePostSplit', () => {
  it('returns ok:true when AST-delta passes and tests not run', async () => {
    const cwd = await makeTmp();
    const result = await validatePostSplit({
      cwd,
      originalContent: 'export interface A {}\nexport function main() {}',
      originalPath: 'src/foo.ts',
      rewrittenOriginal: `import { A } from './foo-types.js';\nexport function main() {}`,
      newFiles: new Map([['foo-types.ts', 'export interface A {}']]),
    });
    assert.equal(result.ok, true);
    assert.equal(result.astDelta.ok, true);
    assert.equal(result.affectedTests, undefined);
  });

  it('returns ok:false when AST-delta fails (no test run attempted)', async () => {
    const cwd = await makeTmp();
    const result = await validatePostSplit({
      cwd,
      originalContent: 'export interface A {}\nexport interface B {}\nexport function main() {}',
      originalPath: 'src/foo.ts',
      rewrittenOriginal: `import { A } from './foo-types.js';\nexport function main() {}`,
      newFiles: new Map([['foo-types.ts', 'export interface A {}']]),  // dropped B
      runAffectedTests: true,
    });
    assert.equal(result.ok, false);
    assert.ok(result.astDelta.missing.includes('B'));
    assert.equal(result.testResult, undefined, 'should not run tests when AST-delta fails');
  });

  it('passes affected-tests when injected runner succeeds', async () => {
    const cwd = await makeTmp();
    await fs.mkdir(path.join(cwd, 'tests'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'tests', 'foo.test.ts'), `import { } from '../src/foo.js';`);

    const result = await validatePostSplit({
      cwd,
      originalContent: 'export interface A {}\nexport function main() {}',
      originalPath: 'src/foo.ts',
      rewrittenOriginal: `import { A } from './foo-types.js';\nexport function main() {}`,
      newFiles: new Map([['foo-types.ts', 'export interface A {}']]),
      runAffectedTests: true,
      _runTests: async () => ({ success: true, output: 'pass 10' }),
    });
    assert.equal(result.ok, true);
    assert.ok(result.affectedTests!.length > 0);
    assert.equal(result.testResult!.success, true);
  });

  it('fails when affected tests fail', async () => {
    const cwd = await makeTmp();
    await fs.mkdir(path.join(cwd, 'tests'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'tests', 'foo.test.ts'), `import { } from '../src/foo.js';`);

    const result = await validatePostSplit({
      cwd,
      originalContent: 'export interface A {}\nexport function main() {}',
      originalPath: 'src/foo.ts',
      rewrittenOriginal: `import { A } from './foo-types.js';\nexport function main() {}`,
      newFiles: new Map([['foo-types.ts', 'export interface A {}']]),
      runAffectedTests: true,
      _runTests: async () => ({ success: false, output: 'TypeError' }),
    });
    assert.equal(result.ok, false);
    assert.ok(result.reason?.includes('failed'));
  });
});
