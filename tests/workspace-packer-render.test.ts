import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderPackMarkdown,
  renderPackXml,
  renderPackPlain,
  buildProjectIndex,
} from '../src/core/workspace-packer.js';
import type { PackFileEntry } from '../src/core/workspace-packer.js';

function makeEntry(overrides = {}): PackFileEntry {
  return {
    relativePath: 'src/index.ts',
    content: 'export const x = 1;',
    tokens: 10,
    sizeBytes: 20,
    language: 'typescript',
    ...overrides,
  };
}

function makeResult(overrides = {}) {
  return {
    format: 'markdown' as const,
    fileTree: 'src/\n  index.ts',
    files: [makeEntry()],
    totalTokens: 10,
    totalFiles: 1,
    ignoredFiles: 0,
    ...overrides,
  };
}

describe('renderPackMarkdown', () => {
  it('includes workspace pack header', () => {
    const output = renderPackMarkdown(makeResult());
    assert.ok(output.includes('# Workspace Pack'));
  });

  it('includes file tree section', () => {
    const output = renderPackMarkdown(makeResult());
    assert.ok(output.includes('## File Tree'));
    assert.ok(output.includes('src/'));
  });

  it('includes files section with relative path', () => {
    const output = renderPackMarkdown(makeResult());
    assert.ok(output.includes('src/index.ts'));
  });

  it('includes file content', () => {
    const output = renderPackMarkdown(makeResult());
    assert.ok(output.includes('export const x = 1;'));
  });

  it('includes total token count', () => {
    const output = renderPackMarkdown(makeResult({ totalTokens: 42 }));
    assert.ok(output.includes('42'));
  });

  it('handles multiple files', () => {
    const result = makeResult({
      files: [makeEntry(), makeEntry({ relativePath: 'src/utils.ts', content: 'export function y() {}' })],
      totalFiles: 2,
    });
    const output = renderPackMarkdown(result);
    assert.ok(output.includes('src/utils.ts'));
  });
});

describe('renderPackXml', () => {
  it('produces valid xml-like structure', () => {
    const output = renderPackXml(makeResult());
    assert.ok(output.includes('<workspace>'));
    assert.ok(output.includes('</workspace>'));
  });

  it('includes summary element', () => {
    const output = renderPackXml(makeResult());
    assert.ok(output.includes('<summary'));
    assert.ok(output.includes('totalTokens'));
  });

  it('includes file elements', () => {
    const output = renderPackXml(makeResult());
    assert.ok(output.includes('<file'));
    assert.ok(output.includes('src/index.ts'));
  });

  it('includes CDATA sections for content', () => {
    const output = renderPackXml(makeResult());
    assert.ok(output.includes('<![CDATA['));
  });

  it('escapes special chars in file paths', () => {
    const entry = makeEntry({ relativePath: 'src/foo&bar.ts' });
    const output = renderPackXml(makeResult({ files: [entry] }));
    assert.ok(output.includes('&amp;'));
    assert.ok(!output.includes('src/foo&bar.ts'));
  });
});

describe('renderPackPlain', () => {
  it('includes workspace pack header', () => {
    const output = renderPackPlain(makeResult());
    assert.ok(output.includes('=== WORKSPACE PACK ==='));
  });

  it('includes file tree', () => {
    const output = renderPackPlain(makeResult());
    assert.ok(output.includes('FILE TREE:'));
    assert.ok(output.includes('src/'));
  });

  it('includes file separator', () => {
    const output = renderPackPlain(makeResult());
    assert.ok(output.includes('================'));
  });

  it('includes file path in output', () => {
    const output = renderPackPlain(makeResult());
    assert.ok(output.includes('src/index.ts'));
  });

  it('includes file content', () => {
    const output = renderPackPlain(makeResult());
    assert.ok(output.includes('export const x = 1;'));
  });
});

describe('buildProjectIndex', () => {
  it('includes project index header', () => {
    const output = buildProjectIndex(makeResult());
    assert.ok(output.includes('=== PROJECT INDEX ==='));
  });

  it('includes total files count', () => {
    const output = buildProjectIndex(makeResult({ totalFiles: 5 }));
    assert.ok(output.includes('5'));
  });

  it('includes key file paths', () => {
    const output = buildProjectIndex(makeResult());
    assert.ok(output.includes('src/index.ts'));
  });

  it('handles empty files array', () => {
    const output = buildProjectIndex(makeResult({ files: [], totalFiles: 0 }));
    assert.ok(output.includes('=== PROJECT INDEX ==='));
  });

  it('limits to top 10 files', () => {
    const files = Array.from({ length: 15 }, (_, i) =>
      makeEntry({ relativePath: `src/file${i}.ts`, content: `export const x${i} = ${i};`, tokens: 10 - i })
    );
    const output = buildProjectIndex(makeResult({ files, totalFiles: 15 }));
    const lines = output.split('\n').filter(l => l.trim().startsWith('src/file'));
    assert.ok(lines.length <= 10);
  });
});
