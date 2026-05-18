// symbol-chunker.test.ts — Phase L.3b cross-language symbol-aware chunking.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkFile, detectLanguage } from '../src/matrix/search/symbol-chunker.js';

describe('detectLanguage', () => {
  it('recognizes TypeScript variants', () => {
    assert.equal(detectLanguage('foo.ts'), 'typescript');
    assert.equal(detectLanguage('foo.tsx'), 'typescript');
    assert.equal(detectLanguage('foo.mts'), 'typescript');
  });
  it('recognizes Python', () => {
    assert.equal(detectLanguage('foo.py'), 'python');
  });
  it('falls back to "other" for unknown extensions', () => {
    assert.equal(detectLanguage('foo.txt'), 'other');
    assert.equal(detectLanguage('foo'), 'other');
  });
});

describe('chunkFile — TypeScript', () => {
  it('chunks by top-level function/class boundaries', () => {
    const src = `export function alpha(): string {\n  return 'a';\n}\n\nexport function beta(): number {\n  return 42;\n}\n\nexport class Gamma {\n  method(): void {}\n}\n`;
    const chunks = chunkFile('src/foo.ts', src);
    const names = chunks.map(c => c.symbol);
    assert.ok(names.includes('alpha'));
    assert.ok(names.includes('beta'));
    assert.ok(names.includes('Gamma'));
  });

  it('falls back to whole-file when file has no declarations', () => {
    const src = `// just a comment\nconsole.log('hi');\n`;
    const chunks = chunkFile('src/noisy.ts', src);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.kind, 'whole-file');
  });

  it('reports each chunk\'s start/end line + language', () => {
    const src = `export function foo(): void {\n  return;\n}\n`;
    const chunks = chunkFile('src/foo.ts', src);
    const foo = chunks.find(c => c.symbol === 'foo');
    assert.ok(foo);
    assert.equal(foo!.language, 'typescript');
    assert.ok(foo!.startLine >= 1);
    assert.ok(foo!.endLine >= foo!.startLine);
  });
});

describe('chunkFile — Python', () => {
  it('chunks top-level def and class', () => {
    const src = [
      'def alpha():',
      '    return 1',
      '',
      'def beta(x, y):',
      '    return x + y',
      '',
      'class Gamma:',
      '    def method(self):',
      '        pass',
      '',
    ].join('\n');
    const chunks = chunkFile('lib/foo.py', src);
    const names = chunks.map(c => c.symbol);
    assert.ok(names.includes('alpha'));
    assert.ok(names.includes('beta'));
    assert.ok(names.includes('Gamma'));
  });

  it('chunks methods inside a class', () => {
    const src = [
      'class Widget:',
      '    def __init__(self):',
      '        pass',
      '    def render(self):',
      '        return None',
      '',
    ].join('\n');
    const chunks = chunkFile('lib/widget.py', src);
    const methodNames = chunks.filter(c => c.kind === 'method').map(c => c.symbol);
    assert.ok(methodNames.includes('__init__'));
    assert.ok(methodNames.includes('render'));
  });

  it('falls back to whole-file when file has no declarations', () => {
    const src = `# just a comment\nprint('hi')\n`;
    const chunks = chunkFile('lib/noisy.py', src);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.kind, 'whole-file');
  });
});

describe('chunkFile — fallback', () => {
  it('returns a single whole-file chunk for unsupported languages', () => {
    const src = 'fn main() { println!("hi"); }';
    const chunks = chunkFile('src/main.rs', src);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.kind, 'whole-file');
    assert.equal(chunks[0]!.language, 'other');
  });
});
