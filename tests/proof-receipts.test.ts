import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildLiveVerifyReceiptMarkdown,
  buildReleaseProofReceiptMarkdown,
  readLatestLiveVerifyReceipt,
  readLatestReleaseProofReceipt,
  writeLiveVerifyReceipt,
  writeReleaseProofReceipt,
} from '../scripts/proof-receipts.mjs';
import { buildScoreArc } from '../src/cli/commands/proof.js';
import type { ScoreHistoryEntry } from '../src/core/state.js';

function makeLiveReceipt(overrides: Record<string, unknown> = {}) {
  return {
    project: 'danteforge',
    version: '0.9.2',
    gitSha: 'abc123def456',
    timestamp: '2026-03-25T21:00:00.000Z',
    cwd: '/project',
    platform: 'linux',
    nodeVersion: 'v22.14.0',
    providers: ['openai', 'claude'],
    providerResults: [
      { provider: 'openai', status: 'pass', detail: 'DanteForge' },
      { provider: 'claude', status: 'pass', detail: 'DanteForge' },
    ],
    upstreamChecks: [
      { name: 'antigravity-upstream', status: 'pass', detail: 'reachable' },
      { name: 'figma-mcp', status: 'pass', detail: 'reachable' },
    ],
    workflowContext: {
      githubActions: false,
      workflow: null,
      job: null,
      runId: null,
      ref: null,
    },
    status: 'pass',
    ...overrides,
  };
}

function makeReleaseReceipt(overrides: Record<string, unknown> = {}) {
  return {
    project: 'danteforge',
    version: '0.9.2',
    gitSha: 'abc123def456',
    timestamp: '2026-03-25T21:00:00.000Z',
    cwd: '/project',
    platform: 'linux',
    nodeVersion: 'v22.14.0',
    checks: [
      { name: 'release:check', command: 'npm run release:check', status: 'pass' },
      { name: 'npm audit', command: 'npm audit --omit=dev', status: 'pass' },
      { name: 'extension audit', command: 'npm --prefix vscode-extension audit', status: 'pass' },
      { name: 'package:vsix', command: 'npm --prefix vscode-extension run package:vsix', status: 'pass' },
    ],
    workflowContext: {
      githubActions: false,
      workflow: null,
      job: null,
      runId: null,
      ref: null,
    },
    artifactPaths: {
      vsix: 'vscode-extension/.artifacts/danteforge.vsix',
    },
    packagedArtifact: {
      filename: 'danteforge-0.9.2.tgz',
      entryCount: 170,
      packageSize: 299200,
      unpackedSize: 1100000,
    },
    artifactHashes: {
      vsix: {
        path: 'vscode-extension/.artifacts/danteforge.vsix',
        sha256: 'abc123',
      },
      notices: {
        path: 'THIRD_PARTY_NOTICES.md',
        sha256: 'def456',
      },
    },
    provenanceSummary: {
      npmPublishProvenance: true,
      githubOidcPublish: true,
      releaseReceiptPath: '.danteforge/evidence/release/latest.json',
      liveReceiptPath: '.danteforge/evidence/live/latest.json',
    },
    status: 'pass',
    ...overrides,
  };
}

describe('proof receipts', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-proof-receipts-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('builds live receipt markdown with providers and upstream checks', () => {
    const markdown = buildLiveVerifyReceiptMarkdown(makeLiveReceipt());

    assert.match(markdown, /DanteForge Live Verify Receipt/);
    assert.match(markdown, /openai/);
    assert.match(markdown, /claude/);
    assert.match(markdown, /antigravity-upstream/);
    assert.match(markdown, /figma-mcp/);
  });

  it('builds release receipt markdown with checks and artifacts', () => {
    const markdown = buildReleaseProofReceiptMarkdown(makeReleaseReceipt());

    assert.match(markdown, /DanteForge Release Proof Receipt/);
    assert.match(markdown, /release:check/);
    assert.match(markdown, /package:vsix/);
    assert.match(markdown, /danteforge\.vsix/);
    assert.match(markdown, /Packaged npm Artifact/);
    assert.match(markdown, /danteforge-0\.9\.2\.tgz/);
    assert.match(markdown, /Artifact Hashes/);
    assert.match(markdown, /Publish Provenance/);
    assert.match(markdown, /OIDC/);
  });

  it('writes and reads the latest live receipt', async () => {
    const receipt = makeLiveReceipt();

    await writeLiveVerifyReceipt(receipt, tmpDir);
    const loaded = await readLatestLiveVerifyReceipt(tmpDir);

    assert.ok(loaded);
    assert.deepStrictEqual(loaded?.providers, receipt.providers);
    assert.strictEqual(loaded?.status, 'pass');
  });

  it('writes and reads the latest release receipt', async () => {
    const receipt = makeReleaseReceipt();

    await writeReleaseProofReceipt(receipt, tmpDir);
    const loaded = await readLatestReleaseProofReceipt(tmpDir);

    assert.ok(loaded);
    assert.strictEqual(loaded?.checks.length, 4);
    assert.strictEqual(loaded?.artifactPaths.vsix, 'vscode-extension/.artifacts/danteforge.vsix');
  });
});

describe('buildScoreArc', () => {
  function makeEntry(dateStr: string, score: number): ScoreHistoryEntry {
    return { timestamp: `${dateStr}T12:00:00.000Z`, displayScore: score };
  }

  it('returns correct before/after from history slice', () => {
    const history: ScoreHistoryEntry[] = [
      makeEntry('2026-04-13', 8.5),
      makeEntry('2026-04-12', 8.0),
      makeEntry('2026-04-11', 7.5),
      makeEntry('2026-04-10', 7.0),
    ];
    const arc = buildScoreArc('2026-04-12', history, 8.5);
    assert.strictEqual(arc.after, 8.5);
    // before = last entry in the window (2026-04-12)
    assert.ok(arc.before >= 7.5 && arc.before <= 8.5, `before should be in window: ${arc.before}`);
    assert.ok(arc.entries.length > 0, 'entries should be non-empty');
  });

  it('handles empty history gracefully — before equals currentScore', () => {
    const arc = buildScoreArc('2026-04-01', [], 7.2);
    assert.strictEqual(arc.before, 7.2);
    assert.strictEqual(arc.after, 7.2);
    assert.strictEqual(arc.gain, 0);
    assert.strictEqual(arc.entries.length, 0);
  });

  it('generated HTML contains Before and After strings', () => {
    const history: ScoreHistoryEntry[] = [makeEntry('2026-04-12', 7.0)];
    const arc = buildScoreArc('2026-04-12', history, 8.0);
    assert.ok(arc.html.includes('Before'), 'HTML should contain Before');
    assert.ok(arc.html.includes('After'), 'HTML should contain After');
  });

  it('markdown contains Score Arc header and gain indicator', () => {
    const history: ScoreHistoryEntry[] = [makeEntry('2026-04-10', 6.0)];
    const arc = buildScoreArc('2026-04-10', history, 8.0);
    assert.ok(arc.markdown.includes('Score Arc'), 'markdown should contain Score Arc header');
    assert.ok(arc.gain > 0, 'gain should be positive');
  });
});
