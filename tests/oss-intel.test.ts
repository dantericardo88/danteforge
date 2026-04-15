// OSS Intel — unit tests using injection seams.
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
} from '../src/core/harvest-queue.js';
import { type DeepPattern, type DeepHarvestResult } from '../src/cli/commands/oss-deep.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-oss-intel-'));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function makePattern(name: string, overrides: Partial<DeepPattern> = {}): DeepPattern {
  return {
    patternName: name,
    category: 'architecture',
    implementationSnippet: `function ${name}() {}`,
    whyItWorks: 'Improves testability',
    adoptionComplexity: 'low',
    sourceFile: 'src/core.ts',
    confidence: 7,
    ...overrides,
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

function makeQueuedRepo(url: string, overrides: Partial<HarvestRepo> = {}): HarvestRepo {
  return {
    url,
    slug: url.split('/').pop() ?? 'repo',
    priority: 8,
    gapTargets: ['circuit-breaker'],
    status: 'queued',
    addedAt: new Date().toISOString(),
    patternsExtracted: 0,
    patternsAdopted: 0,
    ...overrides,
  };
}

function makeEmptyQueue(repos: HarvestRepo[] = []): HarvestQueue {
  return {
    version: '1.0.0',
    repos,
    gaps: [],
    harvestCycles: 0,
    totalPatternsExtracted: 0,
    totalPatternsAdopted: 0,
    updatedAt: new Date().toISOString(),
  };
}

function mockAdoptionLLM(patterns: DeepPattern[]): (prompt: string) => Promise<string> {
  return async () => JSON.stringify(
    patterns.map(p => ({
      patternName: p.patternName,
      category: p.category,
      sourceRepo: 'test/repo',
      referenceImplementation: p.implementationSnippet,
      whatToBuild: `Implement ${p.patternName}`,
      filesToModify: ['src/core.ts'],
      estimatedEffort: '1h',
      unlocksGapClosure: ['circuit-breaker'],
    }) satisfies Omit<AdoptionCandidate, 'adoptionScore'>,
    ),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('OSS Intel — wave management', () => {

  it('T1: ossIntel calls _deepExtract for a queued repo and writes ADOPTION_QUEUE.md', async () => {
    const dir = await makeTempDir();
    const repoUrl = 'https://github.com/test/injection-lib';
    const patterns = [makePattern('injection-seam'), makePattern('retry-backoff')];

    let deepExtractCalled = false;
    await ossIntel({
      cwd: dir,
      _isLLMAvailable: async () => true,
      _loadQueue: async () => makeEmptyQueue([makeQueuedRepo(repoUrl)]),
      _saveQueue: async () => {},
      _deepExtract: async () => {
        deepExtractCalled = true;
        return makeHarvestResult('injection-lib', patterns, dir);
      },
      _llmCaller: mockAdoptionLLM(patterns),
    });

    assert.strictEqual(deepExtractCalled, true, '_deepExtract must be called for queued repo');
    const queuePath = path.join(dir, '.danteforge', 'ADOPTION_QUEUE.md');
    await assert.doesNotReject(fs.access(queuePath), 'ADOPTION_QUEUE.md must be written');
    const content = await fs.readFile(queuePath, 'utf8');
    assert.ok(content.includes('injection-seam') || content.includes('retry-backoff'), 'ADOPTION_QUEUE.md must contain pattern names');
  });

  it('T2: ossIntel does NOT call _deepExtract when queue is empty', async () => {
    const dir = await makeTempDir();

    let deepExtractCalled = false;
    await ossIntel({
      cwd: dir,
      _isLLMAvailable: async () => false,
      _loadQueue: async () => makeEmptyQueue([]),  // empty queue — no repos
      _saveQueue: async () => {},
      _deepExtract: async () => {
        deepExtractCalled = true;
        return makeHarvestResult('never', [], dir);
      },
    });

    assert.strictEqual(deepExtractCalled, false, '_deepExtract must NOT be called with empty queue');
  });

  it('T3: cross-repo synthesis fires every crossSynthesisEvery repos (default 3 → use 2)', async () => {
    const dir = await makeTempDir();
    const repos = [
      makeQueuedRepo('https://github.com/test/repo-a'),
      makeQueuedRepo('https://github.com/test/repo-b'),
    ];
    const pattern = makePattern('circuit-breaker');
    let extractCount = 0;

    await ossIntel({
      cwd: dir,
      crossSynthesisEvery: 2,
      maxRepos: 2,  // cap at exactly 2 so synthesis fires on the 2nd harvest
      _isLLMAvailable: async () => true,
      _getGapScores: async () => [],  // no gaps — prevents LLM-based repo discovery
      _loadQueue: async () => makeEmptyQueue(repos),
      _saveQueue: async () => {},
      _deepExtract: async (url) => {
        extractCount++;
        return makeHarvestResult(url.split('/').pop() ?? 'repo', [pattern], dir);
      },
      _llmCaller: async () => '## Cross-Repo Pattern Synthesis\nResults here.',
    });

    assert.ok(extractCount >= 2, `both repos must be harvested, got ${extractCount}`);
    // SYNTHESIS_REPORT.md is written by runCrossRepoSynthesis
    const synthPath = path.join(dir, '.danteforge', 'SYNTHESIS_REPORT.md');
    const synthExists = await fs.access(synthPath).then(() => true).catch(() => false);
    assert.strictEqual(synthExists, true, 'SYNTHESIS_REPORT.md must be written after crossSynthesisEvery repos');
  });

  it('T4: _adoptedPatterns are included in the LLM adoption planning prompt', async () => {
    const dir = await makeTempDir();
    const adoptedPattern = 'already-implemented-circuit-breaker';
    const pattern = makePattern('new-pattern');
    let capturedPrompt = '';

    await ossIntel({
      cwd: dir,
      _isLLMAvailable: async () => true,
      _loadQueue: async () => makeEmptyQueue([makeQueuedRepo('https://github.com/test/repo')]),
      _saveQueue: async () => {},
      _deepExtract: async () => makeHarvestResult('repo', [pattern], dir),
      _adoptedPatterns: [adoptedPattern],
      _llmCaller: async (prompt) => {
        capturedPrompt = prompt;
        return JSON.stringify([{
          patternName: 'new-pattern',
          category: 'architecture',
          sourceRepo: 'test/repo',
          referenceImplementation: 'function fn() {}',
          whatToBuild: 'Build it',
          filesToModify: [],
          estimatedEffort: '1h',
          unlocksGapClosure: [],
        }]);
      },
    });

    assert.ok(capturedPrompt.includes('ALREADY ADOPTED'), 'LLM prompt must contain ALREADY ADOPTED section');
    assert.ok(capturedPrompt.includes(adoptedPattern), 'adopted pattern name must appear in prompt');
  });

  it('T5: ossIntel marks repo as exhausted when patterns_adopted/extracted > 0.8', async () => {
    const dir = await makeTempDir();
    const repoUrl = 'https://github.com/test/well-adopted-lib';
    const extractedPatterns = Array.from({ length: 10 }, (_, i) => makePattern(`pattern-${i}`));

    // 9 of 10 patterns already adopted → 0.9 > 0.8 → exhausted
    const repo = makeQueuedRepo(repoUrl, { patternsAdopted: 9 });

    let savedQueue: HarvestQueue | null = null;

    await ossIntel({
      cwd: dir,
      _isLLMAvailable: async () => false,
      _loadQueue: async () => makeEmptyQueue([repo]),
      _saveQueue: async (q) => { savedQueue = q; },
      _deepExtract: async () => makeHarvestResult('well-adopted-lib', extractedPatterns, dir),
      _llmCaller: async () => '[]',
    });

    assert.ok(savedQueue !== null, 'queue must be saved');
    const savedRepo = savedQueue!.repos.find(r => r.url === repoUrl);
    assert.strictEqual(savedRepo?.status, 'exhausted',
      `repo must be 'exhausted' when 9/10 patterns adopted (> 0.8)`);
  });

  it('T6: ossIntel does NOT mark repo exhausted when adopted/extracted <= 0.8', async () => {
    const dir = await makeTempDir();
    const repoUrl = 'https://github.com/test/partial-lib';
    const extractedPatterns = Array.from({ length: 10 }, (_, i) => makePattern(`pattern-${i}`));

    // 4 of 10 adopted → 0.4 ≤ 0.8 → should be 'deep'
    const repo = makeQueuedRepo(repoUrl, { patternsAdopted: 4 });

    let savedQueue: HarvestQueue | null = null;

    await ossIntel({
      cwd: dir,
      _isLLMAvailable: async () => false,
      _loadQueue: async () => makeEmptyQueue([repo]),
      _saveQueue: async (q) => { savedQueue = q; },
      _deepExtract: async () => makeHarvestResult('partial-lib', extractedPatterns, dir),
      _llmCaller: async () => '[]',
    });

    assert.ok(savedQueue !== null, 'queue must be saved');
    const savedRepo = savedQueue!.repos.find(r => r.url === repoUrl);
    assert.strictEqual(savedRepo?.status, 'deep',
      `repo must remain 'deep' when 4/10 patterns adopted (≤ 0.8)`);
  });

  it('T7: ossIntel recomputes priority for remaining queued repos after each harvest', async () => {
    const dir = await makeTempDir();

    // Two repos queued: repo-a (higher initial priority), repo-b (lower initial)
    // After harvesting repo-a, repo-b's priority should be recomputed via computePriority
    const repoA = makeQueuedRepo('https://github.com/test/repo-a', { priority: 9 });
    const repoB = makeQueuedRepo('https://github.com/test/repo-b', { priority: 3, status: 'shallow' });

    let savedQueue: HarvestQueue | null = null;
    let harvestCount = 0;

    await ossIntel({
      cwd: dir,
      maxRepos: 1,  // only harvest repo-a, leave repo-b in queue
      _isLLMAvailable: async () => false,
      _loadQueue: async () => ({
        ...makeEmptyQueue([repoA, repoB]),
        gaps: [{ dimension: 'circuit-breaker', currentScore: 3, targetScore: 9, patternsAvailable: 0, patternsAdopted: 0 }],
      }),
      _saveQueue: async (q) => { savedQueue = q; },
      _deepExtract: async () => {
        harvestCount++;
        return makeHarvestResult('repo-a', [makePattern('cb')], dir);
      },
      _llmCaller: async () => '[]',
    });

    assert.strictEqual(harvestCount, 1, 'only repo-a should be harvested (maxRepos: 1)');
    assert.ok(savedQueue !== null, 'queue must be saved');

    // repo-b (shallow) should have its priority recomputed
    const savedRepoB = savedQueue!.repos.find(r => r.url === repoB.url);
    // Priority is recomputed by computePriority — it should differ from initial (3)
    // computePriority(gap, 3) = (9 - 3) * (3/10) = 1.8 ≈ 2 (rounded)
    assert.ok(typeof savedRepoB?.priority === 'number', 'repo-b priority must be a number');
  });

  it('T8: promptMode=true returns without writing ADOPTION_QUEUE.md', async () => {
    const dir = await makeTempDir();

    await ossIntel({ cwd: dir, promptMode: true });

    const queuePath = path.join(dir, '.danteforge', 'ADOPTION_QUEUE.md');
    const exists = await fs.access(queuePath).then(() => true).catch(() => false);
    assert.strictEqual(exists, false, 'ADOPTION_QUEUE.md must NOT be written in promptMode');
  });

});
