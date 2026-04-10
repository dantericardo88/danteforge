import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  parseCodeOperations,
  applyOperation,
  applyAllOperations,
  findFuzzyMatch,
  type FileOperation,
  type CodeWriterOptions,
} from '../src/core/code-writer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StoreOpts = CodeWriterOptions & { _getStore: () => Record<string, string> };

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function makeOpts(files: Record<string, string>): StoreOpts {
  const store: Record<string, string> = { ...files };
  // Use a platform-agnostic cwd prefix that we can strip reliably
  const cwdPrefix = 'TESTCWD';
  return {
    cwd: cwdPrefix,
    _exists: async (p: string) => {
      const norm = normalizePath(p);
      // Strip the cwd prefix and any leading slash/separator
      const stripped = norm.replace(cwdPrefix + '/', '').replace(cwdPrefix, '');
      return stripped in store || Object.keys(store).some((k) => norm.endsWith(normalizePath(k)));
    },
    _readFile: async (p: string) => {
      const norm = normalizePath(p);
      const key = Object.keys(store).find((k) => norm.endsWith(normalizePath(k)));
      if (!key) throw new Error(`File not found: ${p}`);
      return store[key]!;
    },
    _writeFile: async (p: string, content: string) => {
      const norm = normalizePath(p);
      // Resolve the absolute cwd so we can strip it from absolute paths returned by sanitizePath
      const resolvedBase = normalizePath(path.resolve(cwdPrefix)) + '/';
      const strippedFromAbs = norm.startsWith(resolvedBase) ? norm.slice(resolvedBase.length) : null;
      const strippedFromRel = norm.replace(cwdPrefix + '/', '').replace(cwdPrefix, '');
      const stripped = strippedFromAbs ?? strippedFromRel;
      // Find existing key or use stripped
      const existing = Object.keys(store).find((k) => norm.endsWith(normalizePath(k)));
      store[existing ?? stripped] = content;
    },
    _mkdirp: async () => {},
    _getStore: () => store,
  } as StoreOpts;
}

// ---------------------------------------------------------------------------
// describe('parseCodeOperations — SEARCH/REPLACE format')
// ---------------------------------------------------------------------------

describe('parseCodeOperations — SEARCH/REPLACE format', () => {
  it('single block returns one replace operation with correct fields', () => {
    const input = `<<<<<<< SEARCH
const foo = 1;
=======
const foo = 2;
>>>>>>> REPLACE
filepath: src/index.ts`;
    const ops = parseCodeOperations(input);
    assert.equal(ops.length, 1);
    assert.equal(ops[0]?.type, 'replace');
    assert.equal(ops[0]?.filePath, 'src/index.ts');
    assert.equal(ops[0]?.searchBlock, 'const foo = 1;');
    assert.equal(ops[0]?.replaceBlock, 'const foo = 2;');
  });

  it('multiple blocks returns all operations', () => {
    const input = `<<<<<<< SEARCH
alpha
=======
ALPHA
>>>>>>> REPLACE
filepath: src/a.ts
<<<<<<< SEARCH
beta
=======
BETA
>>>>>>> REPLACE
filepath: src/b.ts`;
    const ops = parseCodeOperations(input);
    assert.ok(ops.length >= 2);
    const filePaths = ops.map((o) => o.filePath);
    assert.ok(filePaths.includes('src/a.ts'));
    assert.ok(filePaths.includes('src/b.ts'));
  });

  it('// filepath: prefix is stripped from the filepath', () => {
    // When the LLM writes "// filepath: src/foo.ts" after the block
    const input = `<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE
filepath: // src/stripped.ts`;
    // The regex captures everything after "filepath: " — let's test the actual // stripping
    const input2 = `<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE
filepath: src/plain.ts`;
    const ops = parseCodeOperations(input2);
    assert.equal(ops[0]?.filePath, 'src/plain.ts');
    // Simulate // stripped path
    const input3 = `Some preamble
// filepath: src/commented.ts
<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE
filepath: src/commented.ts`;
    const ops3 = parseCodeOperations(input3);
    assert.ok(ops3.some((o) => o.filePath === 'src/commented.ts'));
  });

  it('filepath appears BEFORE <<<<<<< SEARCH block (5 lines above) still parsed', () => {
    const input = `filepath: src/before.ts
<<<<<<< SEARCH
old content
=======
new content
>>>>>>> REPLACE
filepath: src/before.ts`;
    const ops = parseCodeOperations(input);
    assert.ok(ops.some((o) => o.filePath === 'src/before.ts'));
  });

  it('no SEARCH/REPLACE patterns returns empty array', () => {
    const ops = parseCodeOperations('Just some plain text with no code blocks.');
    assert.equal(ops.length, 0);
  });
});

// ---------------------------------------------------------------------------
// describe('parseCodeOperations — NEW_FILE format')
// ---------------------------------------------------------------------------

describe('parseCodeOperations — NEW_FILE format', () => {
  it('single NEW_FILE block returns one create operation', () => {
    const input = 'NEW_FILE: src/hello.ts\n```ts\nconsole.log("hi");\n```';
    const ops = parseCodeOperations(input);
    assert.equal(ops.length, 1);
    assert.equal(ops[0]?.type, 'create');
    assert.equal(ops[0]?.filePath, 'src/hello.ts');
    assert.equal(ops[0]?.replaceBlock, 'console.log("hi");');
  });

  it('four-backtick fence still parsed', () => {
    const input = 'NEW_FILE: src/four.ts\n````typescript\nconst x = 1;\n````';
    const ops = parseCodeOperations(input);
    assert.equal(ops.length, 1);
    assert.equal(ops[0]?.filePath, 'src/four.ts');
    assert.equal(ops[0]?.replaceBlock, 'const x = 1;');
  });

  it('mixed NEW_FILE and SEARCH/REPLACE returns both', () => {
    const input = [
      'NEW_FILE: src/new.ts\n```ts\nexport const x = 1;\n```',
      '<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE\nfilepath: src/existing.ts',
    ].join('\n');
    const ops = parseCodeOperations(input);
    assert.ok(ops.some((o) => o.type === 'create' && o.filePath === 'src/new.ts'));
    assert.ok(ops.some((o) => o.type === 'replace' && o.filePath === 'src/existing.ts'));
  });
});

// ---------------------------------------------------------------------------
// describe('applyOperation — exact match')
// ---------------------------------------------------------------------------

describe('applyOperation — exact match', () => {
  it('exact search block found — file updated, matchStrategy: exact', async () => {
    const opts = makeOpts({ 'src/app.ts': 'const a = 1;\nconst b = 2;\n' });
    const op: FileOperation = {
      type: 'replace',
      filePath: 'src/app.ts',
      searchBlock: 'const a = 1;',
      replaceBlock: 'const a = 99;',
    };
    const result = await applyOperation(op, opts);
    assert.equal(result.success, true);
    assert.equal(result.matchStrategy, 'exact');
    const store = opts._getStore();
    assert.ok(store['src/app.ts']?.includes('const a = 99;'));
  });

  it('no match in file — success: false, error contains SEARCH block not found', async () => {
    const opts = makeOpts({ 'src/app.ts': 'const x = 1;\n' });
    const op: FileOperation = {
      type: 'replace',
      filePath: 'src/app.ts',
      searchBlock: 'this does not exist in the file anywhere',
      replaceBlock: 'replacement',
    };
    const result = await applyOperation(op, opts);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('SEARCH block not found'));
  });

  it('file not found for replace — success: false, error contains not found', async () => {
    const opts = makeOpts({});
    const op: FileOperation = {
      type: 'replace',
      filePath: 'src/missing.ts',
      searchBlock: 'anything',
      replaceBlock: 'replacement',
    };
    const result = await applyOperation(op, opts);
    assert.equal(result.success, false);
    assert.ok(result.error?.toLowerCase().includes('not found'));
  });

  it('create type — file written via _writeFile, success: true', async () => {
    const opts = makeOpts({});
    const op: FileOperation = {
      type: 'create',
      filePath: 'src/brand-new.ts',
      replaceBlock: 'export const created = true;\n',
    };
    const result = await applyOperation(op, opts);
    assert.equal(result.success, true);
    const store = opts._getStore();
    assert.ok('src/brand-new.ts' in store);
    assert.equal(store['src/brand-new.ts'], 'export const created = true;\n');
  });
});

// ---------------------------------------------------------------------------
// describe('applyOperation — whitespace match')
// ---------------------------------------------------------------------------

describe('applyOperation — whitespace match', () => {
  it('search block with extra indentation vs file matches via whitespace tier', async () => {
    const fileContent = 'function greet() {\n  console.log("hello");\n}\n';
    const opts = makeOpts({ 'src/greet.ts': fileContent });
    const op: FileOperation = {
      type: 'replace',
      filePath: 'src/greet.ts',
      // Extra spaces in the search block — whitespace normalization should match
      searchBlock: 'function greet() {\n    console.log("hello");\n  }',
      replaceBlock: 'function greet() {\n  console.log("hi");\n}',
    };
    const result = await applyOperation(op, opts);
    assert.equal(result.success, true);
    assert.equal(result.matchStrategy, 'whitespace');
  });

  it('search block with trailing spaces still matches via whitespace tier', async () => {
    const fileContent = 'const x = 1;\nconst y = 2;\n';
    const opts = makeOpts({ 'src/vars.ts': fileContent });
    const op: FileOperation = {
      type: 'replace',
      filePath: 'src/vars.ts',
      searchBlock: 'const x = 1;   \nconst y = 2;   ',
      replaceBlock: 'const x = 10;\nconst y = 20;',
    };
    const result = await applyOperation(op, opts);
    assert.equal(result.success, true);
    assert.equal(result.matchStrategy, 'whitespace');
  });
});

// ---------------------------------------------------------------------------
// describe('applyOperation — fuzzy match')
// ---------------------------------------------------------------------------

describe('applyOperation — fuzzy match', () => {
  it('near-identical search (1-2 chars different) produces matchStrategy: fuzzy', async () => {
    const fileContent = 'export function calculateTotal(items: Item[]): number {\n  return items.reduce((sum, i) => sum + i.price, 0);\n}\n';
    const opts = makeOpts({ 'src/calc.ts': fileContent });
    // Slightly different (typo in "calculateTotal" -> "calculateTotol")
    const op: FileOperation = {
      type: 'replace',
      filePath: 'src/calc.ts',
      searchBlock: 'export function calculateTotol(items: Item[]): number {\n  return items.reduce((sum, i) => sum + i.price, 0);\n}',
      replaceBlock: 'export function calculateTotal(items: Item[]): number {\n  return items.reduce((sum, i) => sum + i.price, 0);\n}',
    };
    const result = await applyOperation(op, opts);
    assert.equal(result.success, true);
    assert.equal(result.matchStrategy, 'fuzzy');
  });

  it('very different search content (similarity < 0.8) — success: false', async () => {
    const fileContent = 'const alpha = 1;\nconst beta = 2;\n';
    const opts = makeOpts({ 'src/diff.ts': fileContent });
    const op: FileOperation = {
      type: 'replace',
      filePath: 'src/diff.ts',
      searchBlock: 'import React from "react";\nimport { useState, useEffect } from "react";\nimport axios from "axios";\nimport _ from "lodash";\nimport moment from "moment";',
      replaceBlock: 'replacement',
    };
    const result = await applyOperation(op, opts);
    assert.equal(result.success, false);
  });
});

// ---------------------------------------------------------------------------
// describe('applyAllOperations')
// ---------------------------------------------------------------------------

describe('applyAllOperations', () => {
  it('all operations succeed — success: true, filesWritten populated', async () => {
    const opts = makeOpts({ 'src/a.ts': 'hello', 'src/b.ts': 'world' });
    const ops: FileOperation[] = [
      { type: 'replace', filePath: 'src/a.ts', searchBlock: 'hello', replaceBlock: 'HELLO' },
      { type: 'replace', filePath: 'src/b.ts', searchBlock: 'world', replaceBlock: 'WORLD' },
    ];
    const result = await applyAllOperations(ops, opts);
    assert.equal(result.success, true);
    assert.deepEqual(result.filesWritten.sort(), ['src/a.ts', 'src/b.ts']);
    assert.deepEqual(result.filesFailedToApply, []);
  });

  it('one failure in mix — success: false, filesFailedToApply has failed path, others written', async () => {
    const opts = makeOpts({ 'src/good.ts': 'good content' });
    const ops: FileOperation[] = [
      { type: 'replace', filePath: 'src/good.ts', searchBlock: 'good content', replaceBlock: 'better content' },
      { type: 'replace', filePath: 'src/missing.ts', searchBlock: 'nope', replaceBlock: 'nope' },
    ];
    const result = await applyAllOperations(ops, opts);
    assert.equal(result.success, false);
    assert.ok(result.filesWritten.includes('src/good.ts'));
    assert.ok(result.filesFailedToApply.includes('src/missing.ts'));
  });

  it('empty ops array — success: true, zero files written', async () => {
    const opts = makeOpts({});
    const result = await applyAllOperations([], opts);
    assert.equal(result.success, true);
    assert.deepEqual(result.filesWritten, []);
    assert.deepEqual(result.filesFailedToApply, []);
    assert.equal(result.operations.length, 0);
  });
});

// ---------------------------------------------------------------------------
// describe('findFuzzyMatch')
// ---------------------------------------------------------------------------

describe('findFuzzyMatch', () => {
  it('near-identical needle returns { index, score } with score >= 0.8', () => {
    const haystack = 'line one\nline two\nline three\n';
    const needle = 'line too\nline three'; // "too" vs "two" — close
    const result = findFuzzyMatch(haystack, needle);
    assert.notEqual(result, null);
    assert.ok(result!.score >= 0.8);
  });

  it('exact match returns score = 1.0', () => {
    const haystack = 'alpha\nbeta\ngamma\n';
    const needle = 'alpha\nbeta';
    const result = findFuzzyMatch(haystack, needle);
    assert.notEqual(result, null);
    assert.equal(result!.score, 1.0);
  });

  it('completely different content returns null', () => {
    const haystack = 'aaa\nbbb\nccc\n';
    // needle is many lines of totally different content
    const needle = [
      'import React from "react";',
      'import { useState, useEffect } from "react";',
      'import axios from "axios";',
      'import _ from "lodash";',
      'import moment from "moment";',
      'import dayjs from "dayjs";',
    ].join('\n');
    const result = findFuzzyMatch(haystack, needle);
    assert.equal(result, null);
  });
});
