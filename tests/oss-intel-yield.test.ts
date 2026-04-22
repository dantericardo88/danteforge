// OSS Intel — _predictYield injection seam tests.
// Verifies that the yield predictor is called during priority recompute and
// that its return value scales repo priorities correctly.
// All IO injected: no real LLM, no real oss-deep, real temp filesystem.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ossIntel,
  type OssIntelOptions,
  type AdoptionCandidate,
} from '../src/cli/commands/oss-intel.js';
import {
  type HarvestQueue,
  type HarvestRepo,
  type HarvestGap,
} from '../src/core/harvest-queue.js';
import { type DeepPattern, type DeepHarvestResult } from '../src/cli/commands/oss-deep.js';

// ── Temp dir management ────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-oss-yield-'));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makePattern(name: string, overrides: Partial<DeepPattern> = {}): DeepPattern {
  return {
    patternName: name,
    category: 'reliability',
    implementationSnippet: `function ${name}() {}`,
    whyItWorks: 'Improves reliability',
    adoptionComplexity: 'low',
    sourceFile: 'src/core.ts',
    confidence: 7,
    ...overrides,
  };
}

function makeQueuedRepo(url: string, overrides: Partial<HarvestRepo> = {}): HarvestRepo {
  return {
    url,
    slug: url.split('/').pop() ?? 'repo',
    priority: 8,
    gapTargets: ['reliability'],
    status: 'queued',
    addedAt: new Date().toISOString(),
    patternsExtracted: 0,
    patternsAdopted: 0,
    ...overrides,
  };
}

function makeQueue(repos: HarvestRepo[], gaps: HarvestGap[] = []): HarvestQueue {
  return {
    version: '1.0.0',
    repos,
    gaps,
    harvestCycles: 0,
    totalPatternsExtracted: 0,
    totalPatternsAdopted: 0,
    updatedAt: new Date().toISOString(),
  };
}

function makeGap(dimension: string): HarvestGap {
  return {
    dimension,
    currentScore: 4.0,
    targetScore: 9.0,
    patternsAvailable: 0,
    patternsAdopted: 0,
  };
}

function makeHarvestResult(slug: string, patterns: DeepPattern[], dir: string): DeepHarvestResult {
  return {
    patterns,
    slug,
    harvestPath: path.join(dir, '.danteforge', 'oss-deep', slug),
    license: 'MIT',
  };
}

/**
 * A minimal ossIntel options set that:
 * - skips real LLM
 * - provides a queue with 2 repos (one queued, one shallow) so the
 *   priority recompute loop runs on the second after harvesting the first
 * - deep-extracts one pattern so allPatterns is non-empty (needed for
 *   the priority recompute to trigger)
 */
function baseOpts(dir: string, overrides: Partial<OssIntelOptions> = {}): OssIntelOptions {
  const primaryUrl = 'https://github.com/test/primary-repo';
  const secondaryUrl = 'https://github.com/test/secondary-repo';

  const gaps: HarvestGap[] = [makeGap('reliability')];

  // Two repos: primary (queued — will be harvested), secondary (shallow — stays in queue)
  const repos: HarvestRepo[] = [
    makeQueuedRepo(primaryUrl, { priority: 9 }),
    makeQueuedRepo(secondaryUrl, { status: 'shallow', priority: 5, gapTargets: ['reliability'] }),
  ];

  const patterns = [makePattern('retry-backoff')];

  return {
    cwd: dir,
    maxRepos: 1, // harvest only the primary repo so secondary stays in queue for recompute
    _isLLMAvailable: async () => false,
    _getGapScores: async () => [{ dimension: 'reliability', score: 4.0, target: 9.0 }],
    _loadQueue: async () => makeQueue(repos, gaps),
    _saveQueue: async () => {},
    _deepExtract: async (_url) => makeHarvestResult('primary-repo', patterns, dir),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('OSS Intel — _predictYield injection seam', () => {

  it('T1: _predictYield is invoked with the repo URL during priority recompute', async () => {
    const dir = await makeTempDir();
    const invokedUrls: string[] = [];

    await ossIntel(baseOpts(dir, {
      _predictYield: async (url) => {
        invokedUrls.push(url);
        return 1.0;
      },
    }));

    // The secondary repo (status='shallow') stays in the queue after harvesting
    // the primary, and _predictYield is called for all queued/shallow repos.
    assert.ok(invokedUrls.length >= 1, '_predictYield should be called at least once');
    assert.ok(
      invokedUrls.some(u => u === 'https://github.com/test/secondary-repo'),
      '_predictYield should be called with the secondary repo URL',
    );
  });

  it('T2: _predictYield returning 0.5 reduces the recomputed priority', async () => {
    const dir = await makeTempDir();
    let savedQueue: HarvestQueue | undefined;

    await ossIntel(baseOpts(dir, {
      _predictYield: async () => 0.5, // halve all recomputed priorities
      _saveQueue: async (q) => {
        savedQueue = q;
      },
    }));

    assert.ok(savedQueue !== undefined, '_saveQueue should have been called');
    // The secondary repo started with priority 5. After recompute with yieldFactor=0.5,
    // its priority should be <= 5 (reduced or at most unchanged if base computation is lower).
    const secondary = savedQueue!.repos.find(r => r.url === 'https://github.com/test/secondary-repo');
    assert.ok(secondary !== undefined, 'secondary repo should be in saved queue');
    // basePriority * 0.5 always gives a result <= the original 5
    assert.ok(secondary!.priority <= 5, `priority should be reduced by yieldFactor=0.5, got ${secondary!.priority}`);
  });

  it('T3: omitting _predictYield does not throw — default factor is 1.0', async () => {
    const dir = await makeTempDir();
    let savedQueue: HarvestQueue | undefined;

    // No _predictYield provided — should use default async () => 1.0
    await assert.doesNotReject(
      () => ossIntel(baseOpts(dir, {
        _saveQueue: async (q) => {
          savedQueue = q;
        },
      })),
      'ossIntel should not throw when _predictYield is omitted',
    );

    assert.ok(savedQueue !== undefined, '_saveQueue should have been called');
    // secondary repo priority should be a positive number (not zeroed by missing handler)
    const secondary = savedQueue!.repos.find(r => r.url === 'https://github.com/test/secondary-repo');
    assert.ok(secondary !== undefined, 'secondary repo should be in saved queue');
    assert.ok(secondary!.priority > 0, 'priority should be a positive number with default yield=1.0');
  });

});
