// tests/strict-score.test.ts — danteforge score --strict tamper-resistant scoring

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { computeStrictDimensions } from '../src/core/harsh-scorer.js';
import { score } from '../src/cli/commands/score.js';
import type { HarshScoreResult, ScoringDimension } from '../src/core/harsh-scorer.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeHarshResult(overrides: Partial<{
  displayScore: number;
  autonomy: number;
  selfImprovement: number;
  tokenEconomy: number;
}>): HarshScoreResult {
  const dims: Record<ScoringDimension, number> = {
    functionality: 9, testing: 8, errorHandling: 9, security: 9,
    uxPolish: 10, documentation: 10, performance: 7, maintainability: 9,
    developerExperience: 10, autonomy: overrides.autonomy ?? 10,
    planningQuality: 10, selfImprovement: overrides.selfImprovement ?? 10,
    specDrivenPipeline: 10, convergenceSelfHealing: 10,
    tokenEconomy: overrides.tokenEconomy ?? 9, ecosystemMcp: 10,
    enterpriseReadiness: 5, communityAdoption: 2,
  };
  return {
    displayScore: overrides.displayScore ?? 9.1,
    displayDimensions: { ...dims },
    verdict: 'excellent',
    rawScore: 88,
    harshScore: 91,
    dimensions: {} as never,
    penalties: [],
    stubsDetected: [],
    fakeCompletionRisk: 'low',
    maturityAssessment: { maturityLevel: 4 } as never,
    timestamp: new Date().toISOString(),
    unwiredModules: [],
    wiringResult: undefined,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let tmpDir: string;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'strict-score-test-'));
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── computeStrictDimensions tests ─────────────────────────────────────────────

describe('computeStrictDimensions — base scores without evidence', () => {
  it('returns base scores when no git history and no evidence files', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'base-'));

    const result = await computeStrictDimensions(
      cwd,
      async () => '', // empty git log
      async () => false, // no files exist
      async () => [],  // empty dirs
    );

    // Base scores (no signals): autonomy=20, selfImprovement=20, tokenEconomy=20
    assert.equal(result.autonomy, 20);
    assert.equal(result.selfImprovement, 20);
    assert.equal(result.tokenEconomy, 20);
  });

  it('autonomy increases with 30+ commits', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'commits-'));
    const thirtyCommits = Array.from({ length: 32 }, (_, i) => `abc${i} feat: something`).join('\n');

    const result = await computeStrictDimensions(
      cwd,
      async () => thirtyCommits,
      async () => false,
      async () => [],
    );

    assert.ok(result.autonomy > 20, 'autonomy must increase with commits');
    assert.ok(result.autonomy >= 40, 'autonomy must get +20 for 30+ commits');
  });

  it('autonomy gets bonus from verify evidence files', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'verify-'));
    const fiveFiles = ['a.json', 'b.json', 'c.json', 'd.json', 'e.json'];

    const result = await computeStrictDimensions(
      cwd,
      async () => '',
      async () => false,
      async (p) => {
        // Normalize separators for cross-platform check
        const normalized = p.replace(/\\/g, '/');
        if (normalized.includes('evidence/verify')) return fiveFiles;
        return [];
      },
    );

    assert.ok(result.autonomy > 20, 'autonomy must increase with verify evidence');
    assert.ok(result.autonomy >= 45, 'autonomy must get +25 for 5+ verify files');
  });

  it('selfImprovement increases with retro commits in git log', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'retro-'));
    const retroCommits = Array.from({ length: 4 }, (_, i) => `sha${i} retro: improved score`).join('\n');

    const result = await computeStrictDimensions(
      cwd,
      async (args) => {
        if (args.includes('--grep=retro')) return retroCommits;
        return '';
      },
      async () => false,
      async () => [],
    );

    assert.ok(result.selfImprovement > 20, 'selfImprovement must increase with retro commits');
    assert.ok(result.selfImprovement >= 35, 'selfImprovement must get +15 for 3+ retro commits');
  });

  it('selfImprovement gets bonus from lessons.md file', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'lessons-'));

    const result = await computeStrictDimensions(
      cwd,
      async () => '',
      async (p) => p.includes('lessons.md'), // only lessons.md exists
      async () => [],
    );

    assert.ok(result.selfImprovement >= 35, 'selfImprovement must get +15 for lessons.md');
  });

  it('tokenEconomy increases with 50+ LLM cache files', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'cache-'));
    const fiftyFiles = Array.from({ length: 55 }, (_, i) => `cache-${i}.json`);

    const result = await computeStrictDimensions(
      cwd,
      async () => '',
      async () => false,
      async (p) => {
        // Normalize separators for cross-platform check
        const normalized = p.replace(/\\/g, '/');
        if (normalized.includes('.danteforge/cache')) return fiftyFiles;
        return [];
      },
    );

    assert.ok(result.tokenEconomy >= 50, 'tokenEconomy must get +30 for 50+ cache files');
  });

  it('all three dims are clamped to [0, 100]', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'clamp-'));
    const manyCommits = Array.from({ length: 200 }, (_, i) => `sha${i} fix: x`).join('\n');

    const result = await computeStrictDimensions(
      cwd,
      async () => manyCommits,
      async () => true, // all files exist
      async () => Array.from({ length: 60 }, (_, i) => `f${i}.json`),
    );

    assert.ok(result.autonomy <= 100);
    assert.ok(result.selfImprovement <= 100);
    assert.ok(result.tokenEconomy <= 100);
    assert.ok(result.autonomy >= 0);
    assert.ok(result.selfImprovement >= 0);
    assert.ok(result.tokenEconomy >= 0);
  });
});

// ── score --strict integration tests ─────────────────────────────────────────

describe('score --strict — overrides inflated STATE.yaml dimensions', () => {
  it('strict mode produces lower score when STATE.yaml dims were inflated', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'lower-'));
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.danteforge', 'STATE.yaml'),
      'project: test\nlastVerifyStatus: pass\nautoforgeEnabled: true\nretroD elta: 0.5\n', 'utf8');

    // Inflated harsh score: autonomy=10, selfImprovement=10, tokenEconomy=9
    const inflatedResult = makeHarshResult({ displayScore: 9.1, autonomy: 10, selfImprovement: 10, tokenEconomy: 9 });

    const result = await score({
      cwd,
      strict: true,
      _harshScore: async () => inflatedResult,
      _loadState: async () => ({ project: 'test' } as never),
      _saveState: async () => {},
      _runPrime: async () => {},
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
      _gitLog: async () => '',         // empty git log → low autonomy
      _listDir: async () => [],        // no evidence dirs
      _fileExistsStrict: async () => false, // no infrastructure files
    });

    // Strict dims: autonomy=2(20/10), selfImprovement=2(20/10), tokenEconomy=2(20/10)
    // These are all 2/10 vs the inflated 10/10 and 9/10
    assert.ok(result.displayScore < 9.1, 'strict score must be lower than inflated score');
    assert.ok(result.displayDimensions!.autonomy < 10, 'autonomy must be reduced in strict mode');
    assert.ok(result.displayDimensions!.selfImprovement < 10, 'selfImprovement must be reduced in strict mode');
  });

  it('strict mode emits a [strict mode] label', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'label-'));
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.danteforge', 'STATE.yaml'), 'project: test\n', 'utf8');

    const lines: string[] = [];
    await score({
      cwd,
      strict: true,
      _harshScore: async () => makeHarshResult({}),
      _loadState: async () => ({ project: 'test' } as never),
      _saveState: async () => {},
      _getGitSha: async () => undefined,
      _stdout: (line) => lines.push(line),
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
      _gitLog: async () => '',
      _listDir: async () => [],
      _fileExistsStrict: async () => false,
    });

    assert.ok(
      lines.some(l => l.includes('[strict mode')),
      `Expected [strict mode] label in output. Got:\n${lines.join('\n')}`,
    );
  });

  it('normal mode (no --strict) is unaffected', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'normal-'));
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.danteforge', 'STATE.yaml'), 'project: test\n', 'utf8');

    const lines: string[] = [];
    const result = await score({
      cwd,
      strict: false,
      _harshScore: async () => makeHarshResult({ displayScore: 9.1 }),
      _loadState: async () => ({ project: 'test' } as never),
      _saveState: async () => {},
      _getGitSha: async () => undefined,
      _stdout: (line) => lines.push(line),
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
    });

    assert.equal(result.displayScore, 9.1, 'non-strict score must not be modified');
    assert.ok(!lines.some(l => l.includes('[strict mode')), 'strict label must not appear in normal mode');
  });

  it('strict mode overrides all three gamed dimensions', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'three-dims-'));
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.danteforge', 'STATE.yaml'), 'project: test\n', 'utf8');

    const result = await score({
      cwd,
      strict: true,
      _harshScore: async () => makeHarshResult({ autonomy: 10, selfImprovement: 10, tokenEconomy: 9 }),
      _loadState: async () => ({ project: 'test' } as never),
      _saveState: async () => {},
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
      _gitLog: async () => '',
      _listDir: async () => [],
      _fileExistsStrict: async () => false,
    });

    // All three should be 2 (20 raw / 10 = 2)
    assert.equal(result.displayDimensions!.autonomy, 2);
    assert.equal(result.displayDimensions!.selfImprovement, 2);
    assert.equal(result.displayDimensions!.tokenEconomy, 2);
  });

  it('strict displayScore is recomputed from patched weighted sum', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'recompute-'));
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.danteforge', 'STATE.yaml'), 'project: test\n', 'utf8');

    const result = await score({
      cwd,
      strict: true,
      _harshScore: async () => makeHarshResult({ displayScore: 9.1, autonomy: 10, selfImprovement: 10, tokenEconomy: 9 }),
      _loadState: async () => ({ project: 'test' } as never),
      _saveState: async () => {},
      _getGitSha: async () => undefined,
      _stdout: () => {},
      _listSkillDirs: async () => [],
      _fileExists: async () => false,
      _gitLog: async () => '',
      _listDir: async () => [],
      _fileExistsStrict: async () => false,
    });

    // displayScore must have been recomputed — should differ from the inflated 9.1
    assert.ok(result.displayScore < 9.1, 'displayScore must be recomputed after patching');
    assert.ok(result.displayScore > 0, 'displayScore must remain positive');
  });
});
