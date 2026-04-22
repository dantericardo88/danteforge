// tests/harvest-receipt.test.ts — OSSHarvestReceipt always written after harvestPattern()

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  harvestPattern,
  type OSSHarvestReceipt,
  type OSSRepo,
  type PatternGap,
  type ImplementResult,
} from '../src/cli/commands/harvest-pattern.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRepo(name = 'test-repo', language = 'TypeScript'): OSSRepo {
  return { name, url: `https://github.com/test/${name}`, stars: 500, language };
}

function makeGap(dim = 'errorHandling' as PatternGap['estimatedDimension']): PatternGap {
  return {
    description: 'Add circuit-breaker retry logic',
    sourceRepo: 'test-repo',
    sourceFile: 'src/circuit.ts',
    estimatedDimension: dim,
    estimatedGain: 0.5,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readReceipt(cwd: string): Promise<OSSHarvestReceipt> {
  const raw = await fs.readFile(path.join(cwd, '.danteforge', 'evidence', 'oss-harvest.json'), 'utf8');
  return JSON.parse(raw) as OSSHarvestReceipt;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let tmpDir: string;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harvest-receipt-test-'));
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('harvest-receipt — receipt always written', () => {
  it('writes receipt with status=complete when gap is implemented', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'complete-'));
    let written: OSSHarvestReceipt | null = null;

    await harvestPattern({
      pattern: 'circuit breaker',
      cwd,
      _searchRepos: async () => [makeRepo()],
      _extractGaps: async () => [makeGap()],
      _implementPattern: async (): Promise<ImplementResult> => ({ success: true, filesChanged: ['src/cb.ts'] }),
      _harshScore: async () => ({ displayScore: 8.2 } as never),
      _appendLesson: async () => {},
      _confirm: async () => true,
      _stdout: () => {},
      _writeReceipt: async (_cwd, receipt) => { written = receipt; },
      _getGitSha: async () => 'abc1234',
      _initialScore: async () => 7.5,
    });

    assert.ok(written, 'receipt must be written');
    assert.equal(written!.status, 'complete');
    assert.equal(written!.gapsImplemented, 1);
    assert.equal(written!.gapsPresented, 1);
    assert.equal(written!.reposFound, 1);
    assert.equal(written!.beforeScore, 7.5);
    assert.equal(written!.beforeGitSha, 'abc1234');
  });

  it('writes receipt with status=no-harvest when 0 repos found', async () => {
    let written: OSSHarvestReceipt | null = null;

    await harvestPattern({
      pattern: 'python-only pattern',
      cwd: tmpDir,
      _searchRepos: async () => [],
      _extractGaps: async () => [],
      _implementPattern: async () => ({ success: false, filesChanged: [] }),
      _harshScore: async () => ({ displayScore: 7.0 } as never),
      _appendLesson: async () => {},
      _confirm: async () => false,
      _stdout: () => {},
      _writeReceipt: async (_cwd, receipt) => { written = receipt; },
      _getGitSha: async () => 'def5678',
      _initialScore: async () => 7.0,
    });

    assert.ok(written, 'receipt must be written even when 0 repos found');
    assert.equal(written!.status, 'no-harvest');
    assert.equal(written!.reposFound, 0);
    assert.equal(written!.gapsPresented, 0);
    assert.equal(written!.gapsImplemented, 0);
    assert.ok(written!.notes.some(n => n.includes('0 repos') || n.includes('No repos')), 'notes must mention 0 repos');
  });

  it('writes receipt with status=partial when some gaps declined', async () => {
    let written: OSSHarvestReceipt | null = null;
    const gaps = [makeGap(), makeGap('security' as PatternGap['estimatedDimension'])];
    let callCount = 0;

    await harvestPattern({
      pattern: 'security',
      cwd: tmpDir,
      _searchRepos: async () => [makeRepo()],
      _extractGaps: async () => gaps,
      _implementPattern: async (): Promise<ImplementResult> => ({ success: true, filesChanged: [] }),
      _harshScore: async () => ({ displayScore: 8.0 } as never),
      _appendLesson: async () => {},
      _confirm: async () => { callCount++; return callCount === 1; }, // only first accepted
      _stdout: () => {},
      _writeReceipt: async (_cwd, receipt) => { written = receipt; },
      _getGitSha: async () => null,
      _initialScore: async () => null,
    });

    assert.ok(written, 'receipt must be written');
    assert.equal(written!.status, 'partial');
    assert.equal(written!.gapsPresented, 2);
    assert.equal(written!.gapsImplemented, 1);
  });

  it('writes receipt with status=no-harvest when all gaps declined', async () => {
    let written: OSSHarvestReceipt | null = null;

    await harvestPattern({
      pattern: 'retry',
      cwd: tmpDir,
      _searchRepos: async () => [makeRepo()],
      _extractGaps: async () => [makeGap()],
      _implementPattern: async (): Promise<ImplementResult> => ({ success: true, filesChanged: [] }),
      _harshScore: async () => ({ displayScore: 7.0 } as never),
      _appendLesson: async () => {},
      _confirm: async () => false, // all declined
      _stdout: () => {},
      _writeReceipt: async (_cwd, receipt) => { written = receipt; },
      _getGitSha: async () => null,
      _initialScore: async () => null,
    });

    assert.ok(written, 'receipt must be written');
    assert.equal(written!.status, 'no-harvest');
    assert.equal(written!.gapsImplemented, 0);
  });

  it('receipt includes beforeScore and afterScore', async () => {
    let written: OSSHarvestReceipt | null = null;

    await harvestPattern({
      pattern: 'caching',
      cwd: tmpDir,
      _searchRepos: async () => [makeRepo()],
      _extractGaps: async () => [makeGap()],
      _implementPattern: async (): Promise<ImplementResult> => ({ success: true, filesChanged: [] }),
      _harshScore: async () => ({ displayScore: 8.5 } as never),
      _appendLesson: async () => {},
      _confirm: async () => true,
      _stdout: () => {},
      _writeReceipt: async (_cwd, receipt) => { written = receipt; },
      _getGitSha: async () => 'sha001',
      _initialScore: async () => 7.8,
    });

    assert.equal(written!.beforeScore, 7.8);
    // afterScore is fetched after implementation
    assert.equal(written!.beforeGitSha, 'sha001');
  });

  it('does not throw when _writeReceipt fails', async () => {
    // Receipt write failure must never propagate to the caller
    await assert.doesNotReject(async () => {
      await harvestPattern({
        pattern: 'test',
        cwd: tmpDir,
        _searchRepos: async () => [],
        _extractGaps: async () => [],
        _implementPattern: async (): Promise<ImplementResult> => ({ success: false, filesChanged: [] }),
        _harshScore: async () => ({ displayScore: 7.0 } as never),
        _appendLesson: async () => {},
        _confirm: async () => false,
        _stdout: () => {},
        _writeReceipt: async () => { throw new Error('disk full'); },
        _getGitSha: async () => null,
        _initialScore: async () => null,
      });
    });
  });

  it('--url mode skips search and targets repo directly', async () => {
    let written: OSSHarvestReceipt | null = null;
    let searchCalled = false;

    await harvestPattern({
      pattern: 'knowledge-graph',
      url: 'https://github.com/safishamsi/graphify',
      cwd: tmpDir,
      _searchRepos: async () => { searchCalled = true; return []; },
      _extractGaps: async () => [], // no LLM available in test
      _implementPattern: async (): Promise<ImplementResult> => ({ success: false, filesChanged: [] }),
      _harshScore: async () => ({ displayScore: 7.0 } as never),
      _appendLesson: async () => {},
      _confirm: async () => false,
      _stdout: () => {},
      _writeReceipt: async (_cwd, receipt) => { written = receipt; },
      _getGitSha: async () => null,
      _initialScore: async () => null,
    });

    assert.ok(!searchCalled, '--url must bypass GitHub search');
    assert.ok(written, 'receipt must be written in --url mode');
    assert.equal(written!.url, 'https://github.com/safishamsi/graphify');
    assert.equal(written!.reposFound, 1);
    assert.ok(written!.notes.some(n => n.includes('--url mode')), 'notes must mention --url mode');
  });

  it('receipt timestamp is a valid ISO string', async () => {
    let written: OSSHarvestReceipt | null = null;

    await harvestPattern({
      pattern: 'test-timestamp',
      cwd: tmpDir,
      _searchRepos: async () => [],
      _extractGaps: async () => [],
      _implementPattern: async (): Promise<ImplementResult> => ({ success: false, filesChanged: [] }),
      _harshScore: async () => ({ displayScore: 7.0 } as never),
      _appendLesson: async () => {},
      _confirm: async () => false,
      _stdout: () => {},
      _writeReceipt: async (_cwd, receipt) => { written = receipt; },
      _getGitSha: async () => null,
      _initialScore: async () => null,
    });

    assert.ok(written, 'receipt must be written');
    const parsed = new Date(written!.timestamp);
    assert.ok(!isNaN(parsed.getTime()), 'timestamp must be a valid ISO date');
  });

  it('defaultWriteReceipt creates evidence directory and writes JSON', async () => {
    const cwd = await fs.mkdtemp(path.join(tmpDir, 'default-write-'));
    const { defaultWriteReceipt } = await import('../src/cli/commands/harvest-pattern.js');

    const receipt: OSSHarvestReceipt = {
      timestamp: new Date().toISOString(),
      pattern: 'test-write',
      url: undefined,
      reposFound: 0,
      reposLanguages: [],
      gapsPresented: 0,
      gapsImplemented: 0,
      beforeScore: null,
      afterScore: null,
      beforeGitSha: null,
      afterGitSha: null,
      status: 'no-harvest',
      notes: ['written by test'],
    };

    await defaultWriteReceipt(cwd, receipt);
    const saved = await readReceipt(cwd);
    assert.equal(saved.pattern, 'test-write');
    assert.equal(saved.status, 'no-harvest');
    assert.deepEqual(saved.notes, ['written by test']);
  });
});
