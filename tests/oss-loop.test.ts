import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ossLoop } from '../src/cli/commands/oss-loop.js';
import { loadRegistry } from '../src/core/oss-registry.js';
import type { CompeteMatrix, MatrixDimension } from '../src/core/compete-matrix.js';

function makeDimension(): MatrixDimension {
  return {
    id: 'maintainability',
    label: 'Maintainability',
    weight: 1,
    category: 'quality',
    frequency: 'high',
    scores: { self: 5, Aider: 8 },
    gap_to_leader: 3,
    leader: 'Aider',
    gap_to_closed_source_leader: 0,
    closed_source_leader: 'none',
    gap_to_oss_leader: 3,
    oss_leader: 'Aider',
    status: 'not-started',
    sprint_history: [],
    next_sprint_target: 7,
    harvest_source: 'Aider',
  };
}

async function writeMatrix(cwd: string): Promise<void> {
  const matrix: CompeteMatrix = {
    project: 'test-project',
    competitors: ['Aider'],
    competitors_closed_source: [],
    competitors_oss: ['Aider'],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 5,
    dimensions: [makeDimension()],
  };
  const dir = path.join(cwd, '.danteforge', 'compete');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'matrix.json'), JSON.stringify(matrix, null, 2), 'utf8');
}

describe('ossLoop host discovery file', () => {
  it('uses host-provided candidates without probing the configured LLM provider', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'df-oss-loop-'));
    const cache = path.join(cwd, 'cache');
    const previousCache = process.env.DANTEFORGE_OSS_CACHE;
    process.env.DANTEFORGE_OSS_CACHE = cache;

    try {
      await writeMatrix(cwd);
      const discoveryDir = path.join(cwd, '.danteforge', 'host-discovery');
      await fs.mkdir(discoveryDir, { recursive: true });
      await fs.writeFile(
        path.join(discoveryDir, 'candidates.json'),
        JSON.stringify({
          repos: [
            {
              name: 'smolagents',
              url: 'https://github.com/huggingface/smolagents',
              reason: 'Lightweight agent framework relevant to orchestration gaps.',
            },
          ],
        }),
        'utf8',
      );

      let cloneCalls = 0;
      const result = await ossLoop({
        cwd,
        discoveryFile: '.danteforge/host-discovery/candidates.json',
        maxPasses: 1,
        maxReposPerPass: 5,
        syncAtEnd: false,
        _clone: async () => {
          cloneCalls++;
          return true;
        },
        _classifyLicense: () => 'MIT',
      });

      const registry = await loadRegistry(cwd);
      assert.equal(result.totalDiscovered, 1);
      assert.equal(cloneCalls, 1);
      assert.equal(registry.repos.length, 1);
      assert.equal(registry.repos[0]?.url, 'https://github.com/huggingface/smolagents');
      assert.equal(registry.repos[0]?.license, 'MIT');
    } finally {
      if (previousCache === undefined) delete process.env.DANTEFORGE_OSS_CACHE;
      else process.env.DANTEFORGE_OSS_CACHE = previousCache;
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
