import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pack } from '../src/cli/commands/pack.js';
import type { PackResult } from '../src/core/workspace-packer.js';

function makePackResult(overrides: Partial<PackResult> = {}): PackResult {
  return {
    format: 'markdown',
    fileTree: '├── src/\n└── index.ts',
    files: [{ relativePath: 'index.ts', content: 'export {}', tokens: 5, sizeBytes: 9, language: 'typescript' }],
    totalTokens: 5,
    totalFiles: 1,
    output: '# Workspace Pack\n\n## index.ts\n\n```typescript\nexport {}\n```',
    ignoredFiles: 0,
    ...overrides,
  };
}

describe('pack', () => {
  it('writes output to file when --output specified', async () => {
    let writtenPath = '';
    let writtenContent = '';
    await pack({
      output: '/tmp/test-pack.md',
      _packWorkspace: async () => makePackResult(),
      _writeFile: async (p, c) => { writtenPath = p; writtenContent = c; },
      _stdout: () => {},
    });
    assert.equal(writtenPath, '/tmp/test-pack.md');
    assert.ok(writtenContent.length > 0);
  });

  it('prints output to stdout when no --output', async () => {
    const lines: string[] = [];
    await pack({
      _packWorkspace: async () => makePackResult(),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.length > 0);
    assert.ok(lines.some(l => l.includes('Workspace Pack') || l.includes('index.ts')));
  });

  it('prints token count summary when --tokenCount', async () => {
    const lines: string[] = [];
    await pack({
      tokenCount: true,
      _packWorkspace: async () => makePackResult(),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('Files:') || l.includes('tokens')));
  });

  it('calls _packWorkspace with provided options', async () => {
    let capturedOpts: any = null;
    await pack({
      format: 'xml',
      include: ['src/**'],
      _packWorkspace: async (opts) => { capturedOpts = opts; return makePackResult({ format: 'xml' }); },
      _stdout: () => {},
    });
    assert.equal(capturedOpts?.format, 'xml');
    assert.deepEqual(capturedOpts?.include, ['src/**']);
  });

  it('does not throw for empty pack result', async () => {
    await assert.doesNotReject(() =>
      pack({
        _packWorkspace: async () => makePackResult({ files: [], totalFiles: 0, totalTokens: 0, output: '' }),
        _stdout: () => {},
      })
    );
  });

  it('per-file output included in token count mode', async () => {
    const lines: string[] = [];
    await pack({
      tokenCount: true,
      _packWorkspace: async () => makePackResult(),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('index.ts')));
  });
});
