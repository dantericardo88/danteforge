import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wikiExportCommand } from '../src/cli/commands/wiki-export.js';
import type { WikiExportCommandOptions } from '../src/cli/commands/wiki-export.js';

function makeOpts(overrides: Partial<WikiExportCommandOptions> = {}): WikiExportCommandOptions {
  return {
    cwd: '/tmp/test-wiki',
    _readDir: async () => [],
    _readFile: async () => '# Test\nContent here',
    _writeFile: async () => {},
    _mkdir: async () => {},
    _copyFiles: async () => {},
    ...overrides,
  };
}

describe('wikiExportCommand', () => {
  it('completes without throwing in obsidian format with empty wiki', async () => {
    await assert.doesNotReject(() =>
      wikiExportCommand(makeOpts({ format: 'obsidian' }))
    );
  });

  it('completes without throwing in html format with empty wiki', async () => {
    await assert.doesNotReject(() =>
      wikiExportCommand(makeOpts({ format: 'html' }))
    );
  });

  it('calls _readDir to discover wiki files', async () => {
    let readDirCalled = false;
    await wikiExportCommand(makeOpts({
      _readDir: async () => { readDirCalled = true; return []; },
    }));
    assert.ok(readDirCalled);
  });

  it('processes md files found by _readDir (without _copyFiles)', async () => {
    let filesRead: string[] = [];
    await wikiExportCommand({
      cwd: '/tmp/test-wiki',
      format: 'obsidian',
      _readDir: async () => ['/tmp/test-wiki/.danteforge/wiki/entities/forge.md'],
      _readFile: async (p) => { filesRead.push(p); return '# Forge\nContent.'; },
      _writeFile: async () => {},
      _mkdir: async () => {},
      // no _copyFiles — forces individual read/write loop
    });
    assert.ok(filesRead.length > 0);
  });

  it('calls _writeFile when processing files (no _copyFiles)', async () => {
    let filesWritten: string[] = [];
    await wikiExportCommand({
      cwd: '/tmp/test-wiki',
      format: 'obsidian',
      _readDir: async () => ['/tmp/test-wiki/.danteforge/wiki/entities/forge.md'],
      _readFile: async () => '# Forge\nContent.',
      _writeFile: async (p) => { filesWritten.push(p); },
      _mkdir: async () => {},
      // no _copyFiles — triggers individual writeFile calls
    });
    assert.ok(filesWritten.length > 0);
  });

  it('calls _mkdir to create output directory', async () => {
    let mkdirCalled = false;
    await wikiExportCommand(makeOpts({
      _readDir: async () => ['/tmp/test-wiki/.danteforge/wiki/entities/forge.md'],
      _readFile: async () => '# Forge',
      _mkdir: async () => { mkdirCalled = true; },
    }));
    assert.ok(mkdirCalled);
  });

  it('defaults to obsidian format', async () => {
    await assert.doesNotReject(() => wikiExportCommand(makeOpts()));
  });
});
