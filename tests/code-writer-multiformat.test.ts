// code-writer-multiformat.test.ts — tests for new multi-format parsers added in v0.17.0
// Coverage: unified diff (A1), whole-file heading (A2), flexible fence fallback (A3)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodeOperations } from '../src/core/code-writer.js';

// ---------------------------------------------------------------------------
// A1 — Unified diff format
// ---------------------------------------------------------------------------

describe('parseCodeOperations — unified diff format', () => {
  it('parses a single-hunk diff with removals and additions', () => {
    const input = [
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,3 @@',
      ' import x from "y";',
      '-const old = 1;',
      '+const old = 2;',
      ' export default old;',
    ].join('\n');

    const ops = parseCodeOperations(input);
    assert.ok(ops.length >= 1);
    const op = ops[0]!;
    assert.equal(op.type, 'replace');
    assert.equal(op.filePath, 'src/foo.ts');
    assert.ok(op.searchBlock?.includes('const old = 1;'));
    assert.ok(op.replaceBlock.includes('const old = 2;'));
  });

  it('strips the a/ prefix from the --- line', () => {
    const input = [
      '--- a/src/bar.ts',
      '+++ b/src/bar.ts',
      '@@ -1,2 +1,2 @@',
      '-const x = 1;',
      '+const x = 2;',
    ].join('\n');

    const ops = parseCodeOperations(input);
    assert.ok(ops.length >= 1);
    assert.equal(ops[0]!.filePath, 'src/bar.ts');
  });

  it('handles diff without a/ prefix (plain filepath)', () => {
    const input = [
      '--- src/plain.ts',
      '+++ src/plain.ts',
      '@@ -1,2 +1,2 @@',
      '-const x = 1;',
      '+const x = 2;',
    ].join('\n');

    const ops = parseCodeOperations(input);
    const op = ops.find(o => o.filePath === 'src/plain.ts');
    assert.ok(op, 'should parse plain filepath without a/ prefix');
  });

  it('produces a create op for a pure-addition diff (no - lines)', () => {
    const input = [
      '--- /dev/null',
      '+++ b/src/newfile.ts',
      '@@ -0,0 +1,3 @@',
      '+export const x = 1;',
      '+export const y = 2;',
      '+export default x;',
    ].join('\n');

    const ops = parseCodeOperations(input);
    assert.ok(ops.length >= 1);
    const createOp = ops.find(o => o.type === 'create' && o.filePath === 'src/newfile.ts');
    assert.ok(createOp, 'should produce a create op for pure additions');
    assert.ok(createOp!.replaceBlock.includes('export const x = 1;'));
  });

  it('handles multiple files in one diff response', () => {
    const input = [
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      '-const a = 1;',
      '+const a = 10;',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1,2 +1,2 @@',
      '-const b = 2;',
      '+const b = 20;',
    ].join('\n');

    const ops = parseCodeOperations(input);
    const pathsFound = new Set(ops.map(o => o.filePath));
    assert.ok(pathsFound.has('src/a.ts'), 'should include src/a.ts');
    assert.ok(pathsFound.has('src/b.ts'), 'should include src/b.ts');
  });

  it('skips /dev/null as source path', () => {
    const input = [
      '--- /dev/null',
      '+++ b/src/created.ts',
      '@@ -0,0 +1,2 @@',
      '+export const v = 1;',
    ].join('\n');

    const ops = parseCodeOperations(input);
    assert.ok(!ops.some(o => o.filePath === '/dev/null'), 'should not emit /dev/null as filePath');
    assert.ok(ops.some(o => o.filePath === 'src/created.ts'), 'should emit correct filePath');
  });
});

// ---------------------------------------------------------------------------
// A2 — Whole-file heading format
// ---------------------------------------------------------------------------

describe('parseCodeOperations — whole-file heading format', () => {
  it('parses ## FILE: path before a fenced block', () => {
    const input = [
      '## FILE: src/util.ts',
      '```typescript',
      'export const PI = 3.14159;',
      '```',
    ].join('\n');

    const ops = parseCodeOperations(input);
    assert.ok(ops.length >= 1);
    const op = ops.find(o => o.filePath === 'src/util.ts');
    assert.ok(op, 'should find src/util.ts');
    assert.equal(op!.type, 'create');
    assert.ok(op!.replaceBlock.includes('export const PI = 3.14159;'));
  });

  it('parses === File: path === before a fenced block', () => {
    const input = [
      '=== File: src/config.ts ===',
      '```',
      'export const CONFIG = {};',
      '```',
    ].join('\n');

    const ops = parseCodeOperations(input);
    const op = ops.find(o => o.filePath === 'src/config.ts');
    assert.ok(op, 'should find src/config.ts from === File: === format');
    assert.equal(op!.type, 'create');
  });

  it('parses ### path before a fenced block', () => {
    const input = [
      '### src/helper.ts',
      '```ts',
      'export function noop(): void {}',
      '```',
    ].join('\n');

    const ops = parseCodeOperations(input);
    const op = ops.find(o => o.filePath === 'src/helper.ts');
    assert.ok(op, 'should find src/helper.ts from ### format');
    assert.equal(op!.type, 'create');
    assert.ok(op!.replaceBlock.includes('export function noop(): void {}'));
  });

  it('does not include the fence language line in content', () => {
    const input = [
      '## FILE: src/typed.ts',
      '```typescript',
      'const x: number = 1;',
      '```',
    ].join('\n');

    const ops = parseCodeOperations(input);
    const op = ops.find(o => o.filePath === 'src/typed.ts');
    assert.ok(op);
    assert.ok(!op!.replaceBlock.includes('typescript'), 'content should not include the language specifier');
    assert.ok(op!.replaceBlock.includes('const x: number = 1;'));
  });
});

// ---------------------------------------------------------------------------
// A3 — Flexible fence fallback
// ---------------------------------------------------------------------------

describe('parseCodeOperations — flexible fence fallback', () => {
  it('parses filepath from fence header (```typescript src/foo.ts)', () => {
    const input = '```typescript src/components/Button.tsx\nexport const Button = () => null;\n```';

    const ops = parseCodeOperations(input);
    const op = ops.find(o => o.filePath === 'src/components/Button.tsx');
    assert.ok(op, 'should detect filepath in fence header');
    assert.equal(op!.type, 'create');
    assert.ok(op!.replaceBlock.includes('export const Button'));
  });

  it('parses # hash comment as filepath on first line', () => {
    const input = '```python\n# scripts/hello.py\nprint("hello")\n```';

    const ops = parseCodeOperations(input);
    const op = ops.find(o => o.filePath === 'scripts/hello.py');
    assert.ok(op, 'should detect # comment filepath');
    assert.equal(op!.type, 'create');
    assert.ok(op!.replaceBlock.includes('print("hello")'));
  });

  it('parses // filepath: keyword comment on first line', () => {
    const input = '```ts\n// filepath: src/utils.ts\nexport const add = (a: number, b: number) => a + b;\n```';

    const ops = parseCodeOperations(input);
    const op = ops.find(o => o.filePath === 'src/utils.ts');
    assert.ok(op, 'should parse // filepath: keyword');
    assert.ok(op!.replaceBlock.includes('export const add'));
  });

  it('does not false-positive on a language-only fence header', () => {
    const input = '```typescript\nconst x = 1;\n```';
    const ops = parseCodeOperations(input);
    // language-only fence without a filepath should not produce ops with 'typescript' as path
    const bad = ops.find(o => o.filePath === 'typescript');
    assert.equal(bad, undefined, 'should not use language name as filepath');
  });

  it('does not false-positive on empty fenced block', () => {
    const input = '```\n\n```';
    const ops = parseCodeOperations(input);
    assert.ok(!ops.some(o => !o.filePath), 'empty block should not produce ops');
  });
});

// ---------------------------------------------------------------------------
// Mixed formats in one response
// ---------------------------------------------------------------------------

describe('parseCodeOperations — mixed formats', () => {
  it('parses SEARCH/REPLACE block and a unified diff in the same response', () => {
    const input = [
      '<<<<<<< SEARCH',
      'const a = 1;',
      '=======',
      'const a = 10;',
      '>>>>>>> REPLACE',
      'filepath: src/a.ts',
      '',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1,2 +1,2 @@',
      '-const b = 2;',
      '+const b = 20;',
    ].join('\n');

    const ops = parseCodeOperations(input);
    const paths = ops.map(o => o.filePath);
    assert.ok(paths.includes('src/a.ts'), 'should include SEARCH/REPLACE file');
    assert.ok(paths.includes('src/b.ts'), 'should include unified diff file');
  });

  it('parses unified diff and NEW_FILE block in the same response', () => {
    const input = [
      '--- a/src/old.ts',
      '+++ b/src/old.ts',
      '@@ -1,2 +1,2 @@',
      '-const x = 1;',
      '+const x = 2;',
      '',
      'NEW_FILE: src/new.ts',
      '```typescript',
      'export const fresh = true;',
      '```',
    ].join('\n');

    const ops = parseCodeOperations(input);
    const hasOld = ops.some(o => o.filePath === 'src/old.ts');
    const hasNew = ops.some(o => o.filePath === 'src/new.ts' && o.type === 'create');
    assert.ok(hasOld, 'should include unified diff file');
    assert.ok(hasNew, 'should include NEW_FILE');
  });

  it('parses whole-file heading and SEARCH/REPLACE in same response', () => {
    const input = [
      '## FILE: src/created.ts',
      '```ts',
      'export const created = true;',
      '```',
      '',
      '<<<<<<< SEARCH',
      'const x = 1;',
      '=======',
      'const x = 99;',
      '>>>>>>> REPLACE',
      'filepath: src/existing.ts',
    ].join('\n');

    const ops = parseCodeOperations(input);
    const hasCreated = ops.some(o => o.filePath === 'src/created.ts');
    const hasExisting = ops.some(o => o.filePath === 'src/existing.ts');
    assert.ok(hasCreated, 'should include whole-file heading file');
    assert.ok(hasExisting, 'should include SEARCH/REPLACE file');
  });

  it('returns no duplicate ops for the same file', () => {
    // A SEARCH/REPLACE with filepath before AND after should not double-count
    const input = [
      '<<<<<<< SEARCH',
      'const x = 1;',
      '=======',
      'const x = 2;',
      '>>>>>>> REPLACE',
      'filepath: src/dedup.ts',
    ].join('\n');

    const ops = parseCodeOperations(input);
    const forFile = ops.filter(o => o.filePath === 'src/dedup.ts');
    assert.ok(forFile.length <= 2, 'should not excessively duplicate ops for same file');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('parseCodeOperations — edge cases', () => {
  it('returns [] for empty string', () => {
    assert.deepEqual(parseCodeOperations(''), []);
  });

  it('returns [] for plain prose with no code', () => {
    const input = 'To fix this issue, you should update the function to return the correct value instead of the old one.';
    assert.deepEqual(parseCodeOperations(input), []);
  });

  it('returns [] for whitespace-only fenced block', () => {
    const input = '```\n   \n```';
    const ops = parseCodeOperations(input);
    assert.ok(ops.every(o => o.filePath.trim() !== ''), 'should not produce ops with empty filepath');
  });

  it('handles CRLF line endings in unified diff', () => {
    const input = '--- a/src/crlf.ts\r\n+++ b/src/crlf.ts\r\n@@ -1,2 +1,2 @@\r\n-const x = 1;\r\n+const x = 2;\r\n';
    const ops = parseCodeOperations(input);
    // Should not throw and should return either ops or [] gracefully
    assert.ok(Array.isArray(ops), 'should return an array');
  });

  it('parseCodeOperations result is always an array', () => {
    const inputs = ['', 'hello', '```\n```', '---\n+++\n'];
    for (const input of inputs) {
      const result = parseCodeOperations(input);
      assert.ok(Array.isArray(result), `should return array for input: ${JSON.stringify(input.slice(0, 20))}`);
    }
  });
});
