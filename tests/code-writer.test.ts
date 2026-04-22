import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCodeOperations,
  findFuzzyMatch,
  applyOperation,
  applyAllOperations,
} from '../src/core/code-writer.js';

describe('parseCodeOperations: SEARCH/REPLACE format', () => {
  it('parses a basic SEARCH/REPLACE block', () => {
    const input = [
      '<<<<<<< SEARCH',
      'const x = 1;',
      '=======',
      'const x = 2;',
      '>>>>>>> REPLACE',
      'filepath: src/foo.ts',
    ].join('\n');
    const ops = parseCodeOperations(input);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].type, 'replace');
    assert.equal(ops[0].filePath, 'src/foo.ts');
    assert.ok(ops[0].searchBlock!.includes('const x = 1'));
    assert.ok(ops[0].replaceBlock.includes('const x = 2'));
  });

  it('returns empty array when no operations found', () => {
    const ops = parseCodeOperations('just some random text with no blocks');
    assert.deepEqual(ops, []);
  });

  it('parses multiple SEARCH/REPLACE blocks', () => {
    const block = (search: string, replace: string, fp: string) =>
      `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\nfilepath: ${fp}`;
    const input = block('a=1', 'a=2', 'a.ts') + '\n' + block('b=1', 'b=2', 'b.ts');
    const ops = parseCodeOperations(input);
    assert.ok(ops.length >= 2);
    assert.equal(ops[0].filePath, 'a.ts');
    assert.equal(ops[1].filePath, 'b.ts');
  });
});

describe('parseCodeOperations: NEW_FILE format', () => {
  it('parses a NEW_FILE block', () => {
    const input = 'NEW_FILE: src/new.ts\n```ts\nexport const x = 1;\n```';
    const ops = parseCodeOperations(input);
    assert.ok(ops.some(o => o.type === 'create' && o.filePath === 'src/new.ts'));
  });
});

describe('findFuzzyMatch', () => {
  it('finds exact match at correct position', () => {
    const content = 'line1\nline2\nline3\n';
    const result = findFuzzyMatch(content, 'line2');
    assert.ok(result !== null);
    assert.ok(result!.score >= 0.9);
  });

  it('returns null when no close match found', () => {
    const content = 'completely different content here';
    const result = findFuzzyMatch(content, 'totally unrelated target string xyz');
    assert.equal(result, null);
  });
});

describe('applyOperation: create', () => {
  it('creates a new file', async () => {
    let written = '';
    const opts = {
      cwd: '/tmp/test',
      _exists: async () => false,
      _readFile: async () => { throw new Error('not found'); },
      _writeFile: async (_p: string, c: string) => { written = c; },
      _mkdirp: async () => {},
    };
    const result = await applyOperation({ type: 'create', filePath: 'src/new.ts', replaceBlock: 'export {}' }, opts);
    assert.equal(result.success, true);
    assert.ok(written.includes('export {}'));
  });
});

describe('applyOperation: replace', () => {
  it('replaces content with exact match', async () => {
    let written = '';
    const opts = {
      cwd: '/tmp/test',
      _exists: async () => true,
      _readFile: async () => 'const x = 1;\nconst y = 2;\n',
      _writeFile: async (_p: string, c: string) => { written = c; },
      _mkdirp: async () => {},
    };
    const result = await applyOperation(
      { type: 'replace', filePath: 'src/foo.ts', searchBlock: 'const x = 1;', replaceBlock: 'const x = 99;' },
      opts,
    );
    assert.equal(result.success, true);
    assert.ok(written.includes('const x = 99;'));
  });

  it('returns failure when search block not found', async () => {
    const opts = {
      cwd: '/tmp/test',
      _exists: async () => true,
      _readFile: async () => 'const x = 1;',
      _writeFile: async () => {},
      _mkdirp: async () => {},
    };
    const result = await applyOperation(
      { type: 'replace', filePath: 'src/foo.ts', searchBlock: 'nonexistent code', replaceBlock: 'replacement' },
      opts,
    );
    assert.equal(result.success, false);
  });
});

describe('applyAllOperations', () => {
  it('returns overall success=true when all ops succeed', async () => {
    let written = '';
    const opts = {
      cwd: '/tmp/test',
      _exists: async () => false,
      _readFile: async () => '',
      _writeFile: async (_p: string, c: string) => { written = c; },
      _mkdirp: async () => {},
    };
    const result = await applyAllOperations(
      [{ type: 'create', filePath: 'new.ts', replaceBlock: 'export {}' }],
      opts,
    );
    assert.equal(result.success, true);
    assert.equal(result.filesWritten.length, 1);
  });

  it('returns empty results for empty operations list', async () => {
    const result = await applyAllOperations([], {});
    assert.equal(result.success, true);
    assert.deepEqual(result.filesWritten, []);
    assert.deepEqual(result.filesFailedToApply, []);
  });
});
