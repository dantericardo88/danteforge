import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LocalSource, LocalHarvestReport, LocalHarvesterOptions } from '../src/core/local-harvester.js';

function makeReport(overrides: Partial<LocalHarvestReport> = {}): LocalHarvestReport {
  return {
    sources: [],
    synthesis: 'Synthesized insights',
    topPatterns: [{ category: 'arch', name: 'Pattern A', description: 'Desc', priority: 'P0' }],
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

describe('localHarvest', () => {
  it('prints prompt template without calling harvester', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    let harvesterCalled = false;
    const captured: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk === 'string') captured.push(chunk);
      return originalWrite(chunk, ...(rest as Parameters<typeof originalWrite>).slice(1));
    }) as typeof process.stdout.write;
    try {
      await localHarvest([], {
        prompt: true,
        cwd: tmpDir,
        _harvester: async () => {
          harvesterCalled = true;
          return makeReport();
        },
      });
    } finally {
      process.stdout.write = originalWrite;
    }
    assert.ok(!harvesterCalled);
    assert.ok(captured.join('').includes('Local Harvest Plan'));
  });

  it('forwards path arguments to the harvester', async () => {
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
    assert.ok(capturedSources);
    assert.strictEqual(capturedSources!.length, 2);
    assert.strictEqual(capturedSources![0]!.depth, 'shallow');
  });

  it('loads sources from YAML config', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    const configPath = path.join(tmpDir, 'local-sources.yaml');
    await fs.writeFile(
      configPath,
      'sources:\n  - path: ./project-a\n    label: "Old Auth MVP"\n    depth: shallow\n  - path: ./project-b\n',
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
    assert.ok(capturedSources);
    assert.strictEqual(capturedSources![0]!.label, 'Old Auth MVP');
  });

  it('calls interactive picker when no sources are provided', async () => {
    const { localHarvest } = await import('../src/cli/commands/local-harvest.js');
    let pickerCalled = false;
    let capturedSources: LocalSource[] | undefined;
    await localHarvest([], {
      cwd: tmpDir,
      _pickSourcesInteractive: async () => {
        pickerCalled = true;
        return ['/selected/folder'];
      },
      _harvester: async (sources, _opts) => {
        capturedSources = sources;
        return makeReport();
      },
    });
    assert.ok(pickerCalled);
    assert.strictEqual(capturedSources![0]!.path, '/selected/folder');
  });

  it('forwards depth into harvester options', async () => {
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
