import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LocalSource, LocalHarvestReport, LocalHarvesterOptions } from '../src/core/local-harvester.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<LocalHarvestReport> = {}): LocalHarvestReport {
  return {
    sources: [],
    synthesis: 'Synthesized insights',
    topPatterns: [
      { category: 'arch', name: 'Pattern A', description: 'Desc', priority: 'P0' },
    ],
    recommendedOssQueries: ['typescript event sourcing'],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

let tmpDir: string;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-local-harvest-cmd-'));
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Prompt mode ───────────────────────────────────────────────────────────────

describe('localHarvest — prompt mode', () => {
  it('prints harvest plan template and returns without calling harvester', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    let harvesterCalled = false;
    const captured: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // Capture stdout output
    const mockWrite = (chunk: unknown, ...rest: unknown[]): boolean => {
      if (typeof chunk === 'string') captured.push(chunk);
      return origWrite(chunk, ...(rest as Parameters<typeof origWrite>).slice(1));
    };
    process.stdout.write = mockWrite as typeof process.stdout.write;
    try {
      await localHarvest([], {
        prompt: true,
        cwd: tmpDir,
        _harvester: async () => { harvesterCalled = true; return makeReport(); },
      });
    } finally {
      process.stdout.write = origWrite;
    }
    assert.ok(!harvesterCalled, 'harvester should NOT be called in prompt mode');
    const output = captured.join('');
    assert.ok(output.includes('Local Harvest Plan'), 'should print plan template');
  });
});

// ── Dry-run mode ──────────────────────────────────────────────────────────────

describe('localHarvest — dry-run mode', () => {
  it('lists detected sources without calling harvester', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    let harvesterCalled = false;
    await localHarvest(['/path/to/proj1', '/path/to/proj2'], {
      dryRun: true,
      cwd: tmpDir,
      _harvester: async () => { harvesterCalled = true; return makeReport(); },
    });
    assert.ok(!harvesterCalled, 'harvester should NOT be called in dry-run mode');
  });

  it('respects max-sources limit in dry-run mode', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    let harvesterCalled = false;
    // Provide 3 sources but limit to 2
    await localHarvest(['/proj/a', '/proj/b', '/proj/c'], {
      dryRun: true,
      maxSources: 2,
      cwd: tmpDir,
      _harvester: async () => { harvesterCalled = true; return makeReport(); },
    });
    assert.ok(!harvesterCalled, 'harvester should NOT be called in dry-run mode');
  });
});

// ── Path arguments ────────────────────────────────────────────────────────────

describe('localHarvest — path arguments', () => {
  it('passes path arguments to harvester as LocalSource array', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    let capturedSources: LocalSource[] | undefined;
    await localHarvest(['/proj/one', '/proj/two'], {
      depth: 'shallow',
      cwd: tmpDir,
      _harvester: async (sources, _opts) => {
        capturedSources = sources;
        return makeReport();
      },
    });
    assert.ok(capturedSources, 'harvester should be called');
    assert.strictEqual(capturedSources!.length, 2);
    assert.strictEqual(capturedSources![0]!.path, '/proj/one');
    assert.strictEqual(capturedSources![1]!.path, '/proj/two');
  });

  it('forwards depth option to each source', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    let capturedSources: LocalSource[] | undefined;
    await localHarvest(['/proj/one'], {
      depth: 'full',
      cwd: tmpDir,
      _harvester: async (sources, _opts) => {
        capturedSources = sources;
        return makeReport();
      },
    });
    assert.strictEqual(capturedSources![0]!.depth, 'full');
  });

  it('applies max-sources limit when too many paths provided', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    let capturedSources: LocalSource[] | undefined;
    await localHarvest(['/p1', '/p2', '/p3', '/p4', '/p5', '/p6'], {
      maxSources: 3,
      cwd: tmpDir,
      _harvester: async (sources, _opts) => {
        capturedSources = sources;
        return makeReport();
      },
    });
    assert.strictEqual(capturedSources!.length, 3);
  });
});

// ── Config YAML loading ───────────────────────────────────────────────────────

describe('localHarvest — config file loading', () => {
  it('loads sources from YAML config file', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    const configPath = path.join(tmpDir, 'local-sources.yaml');
    await fs.writeFile(
      configPath,
      `sources:\n  - path: ./project-a\n    label: "Old Auth MVP"\n    depth: shallow\n  - path: ./project-b\n`,
    );
    let capturedSources: LocalSource[] | undefined;
    await localHarvest([], {
      config: configPath,
      cwd: tmpDir,
      _harvester: async (sources, _opts) => {
        capturedSources = sources;
        return makeReport();
      },
    });
    assert.ok(capturedSources, 'harvester should be called');
    assert.strictEqual(capturedSources!.length, 2);
    assert.strictEqual(capturedSources![0]!.path, './project-a');
    assert.strictEqual(capturedSources![0]!.label, 'Old Auth MVP');
    assert.strictEqual(capturedSources![0]!.depth, 'shallow');
  });

  it('sets exitCode=1 and returns when config file does not exist', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    const prevExitCode = process.exitCode;
    let harvesterCalled = false;
    await localHarvest([], {
      config: '/nonexistent/path/local-sources.yaml',
      cwd: tmpDir,
      _harvester: async () => { harvesterCalled = true; return makeReport(); },
    });
    assert.strictEqual(process.exitCode, 1, 'should set exitCode=1 on config read error');
    assert.ok(!harvesterCalled, 'harvester should NOT be called when config fails');
    process.exitCode = prevExitCode;
  });
});

// ── Interactive picker fallback ───────────────────────────────────────────────

describe('localHarvest — interactive picker fallback', () => {
  it('calls interactive picker when no paths and no config provided', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    let pickerCalled = false;
    let capturedSources: LocalSource[] | undefined;
    await localHarvest([], {
      cwd: tmpDir,
      _pickSourcesInteractive: async (_cwd: string) => {
        pickerCalled = true;
        return ['/selected/folder'];
      },
      _harvester: async (sources, _opts) => {
        capturedSources = sources;
        return makeReport();
      },
    });
    assert.ok(pickerCalled, 'interactive picker should be called when no sources given');
    assert.strictEqual(capturedSources![0]!.path, '/selected/folder');
  });

  it('does not call harvester when interactive picker returns empty array', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    let harvesterCalled = false;
    await localHarvest([], {
      cwd: tmpDir,
      _pickSourcesInteractive: async (_cwd: string) => [],
      _harvester: async () => { harvesterCalled = true; return makeReport(); },
    });
    assert.ok(!harvesterCalled, 'harvester should NOT be called when picker returns empty');
  });
});

// ── Depth forwarding ──────────────────────────────────────────────────────────

describe('localHarvest — depth option forwarding', () => {
  it('forwards depth to harvester options', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    let capturedOpts: LocalHarvesterOptions | undefined;
    await localHarvest(['/my/proj'], {
      depth: 'full',
      cwd: tmpDir,
      _harvester: async (_sources, opts) => {
        capturedOpts = opts;
        return makeReport();
      },
    });
    assert.strictEqual(capturedOpts!.depth, 'full');
  });
});
