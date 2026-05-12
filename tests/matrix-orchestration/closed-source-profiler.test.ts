// Tests for src/matrix-orchestration/analysis/closed-source-profiler.ts
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { profileClosedSource } from '../../src/matrix-orchestration/analysis/closed-source-profiler.js';
import type {
  CompetitiveUniverse,
  ClosedSourceProfileReport,
} from '../../src/matrix-orchestration/types.js';

const tmpDirs: string[] = [];
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

async function makeCwd(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'csp-'));
  tmpDirs.push(d);
  return d;
}

function makeUniverse(entries: CompetitiveUniverse['entries']): CompetitiveUniverse {
  return {
    generatedAt: '2026-05-12T00:00:00.000Z',
    projectName: 'fixture',
    entries,
    approvedByUser: true,
  };
}

describe('profileClosedSource', () => {
  it('returns an empty report when universe has no closed-source entries', async () => {
    const cwd = await makeCwd();
    const report = await profileClosedSource(
      makeUniverse([
        {
          id: 'oss.aider',
          name: 'Aider',
          category: 'oss',
          source: 'manual',
          confidence: 1,
          recommendedAction: 'harvest',
        },
      ]),
      { cwd, _now: () => '2026-05-12T00:00:00.000Z' },
    );
    assert.deepEqual(report.profiles, []);

    // Verify persistence
    const raw = await fs.readFile(
      path.join(cwd, '.danteforge/matrix-orchestration/closed-source-profiles.json'),
      'utf8',
    );
    const persisted = JSON.parse(raw) as ClosedSourceProfileReport;
    assert.equal(persisted.profiles.length, 0);
  });

  it('marks every claim as inferred when no docs are fetched', async () => {
    const cwd = await makeCwd();
    const report = await profileClosedSource(
      makeUniverse([
        {
          id: 'cs.cursor',
          name: 'Cursor',
          category: 'closed_source',
          homeUrl: 'https://cursor.sh',
          source: 'manual',
          confidence: 1,
          recommendedAction: 'profile',
        },
      ]),
      {
        cwd,
        _isLLMAvailable: async () => false,
        _now: () => '2026-05-12T00:00:00.000Z',
      },
    );
    assert.equal(report.profiles.length, 1);
    const profile = report.profiles[0]!;
    assert.equal(profile.competitorName, 'Cursor');
    const allClaims = [
      ...profile.featureInventory,
      ...profile.architecturalInferences,
      ...profile.reportedStrengths,
      ...profile.reportedWeaknesses,
    ];
    for (const c of allClaims) {
      assert.equal(c.claimType, 'inferred', `every claim must be inferred; got ${c.claimType}`);
    }
  });

  it('parses LLM JSON output and only marks "documented" when docs were actually fetched from homeUrl', async () => {
    const cwd = await makeCwd();
    const llmCaller = async (_p: string) =>
      JSON.stringify({
        featureInventory: ['multi-file context', 'agent mode'],
        architecturalInferences: ['embedding-based retrieval'],
        reportedStrengths: ['fast for small edits'],
        reportedWeaknesses: ['token limits in agent mode'],
      });
    const fetchDocs = async (url: string) =>
      url === 'https://cursor.sh' ? 'Cursor: multi-file context, agent mode...' : null;

    const report = await profileClosedSource(
      makeUniverse([
        {
          id: 'cs.cursor',
          name: 'Cursor',
          category: 'closed_source',
          homeUrl: 'https://cursor.sh',
          source: 'manual',
          confidence: 1,
          recommendedAction: 'profile',
        },
      ]),
      {
        cwd,
        mode: 'llm',
        _isLLMAvailable: async () => true,
        _llmCaller: llmCaller,
        _fetchDocs: fetchDocs,
        _now: () => '2026-05-12T00:00:00.000Z',
      },
    );
    const profile = report.profiles[0]!;
    assert.equal(profile.featureInventory.length, 2);
    for (const c of profile.featureInventory) {
      assert.equal(c.claimType, 'documented');
      assert.equal(c.evidenceUrl, 'https://cursor.sh');
    }
  });

  it('treats every claim as inferred when docs URL fetch returns null', async () => {
    const cwd = await makeCwd();
    const llmCaller = async () =>
      JSON.stringify({ featureInventory: ['feature x'] });
    const fetchDocs = async () => null;
    const report = await profileClosedSource(
      makeUniverse([
        {
          id: 'cs.x',
          name: 'X',
          category: 'closed_source',
          homeUrl: 'https://x.example',
          source: 'manual',
          confidence: 1,
          recommendedAction: 'profile',
        },
      ]),
      {
        cwd,
        _isLLMAvailable: async () => true,
        _llmCaller: llmCaller,
        _fetchDocs: fetchDocs,
        _now: () => '2026-05-12T00:00:00.000Z',
      },
    );
    const claims = report.profiles[0]!.architecturalInferences;
    assert.ok(claims.length > 0);
    // No docs were fetched — even a synthetic note must remain inferred.
    for (const c of claims) assert.equal(c.claimType, 'inferred');
  });

  it('survives malformed LLM output and falls back to a synthetic inferred note', async () => {
    const cwd = await makeCwd();
    const report = await profileClosedSource(
      makeUniverse([
        {
          id: 'cs.y',
          name: 'Y',
          category: 'closed_source',
          homeUrl: 'https://y.example',
          source: 'manual',
          confidence: 1,
          recommendedAction: 'profile',
        },
      ]),
      {
        cwd,
        mode: 'llm',
        _isLLMAvailable: async () => true,
        _llmCaller: async () => 'this is not JSON',
        _fetchDocs: async () => 'some docs body',
        _now: () => '2026-05-12T00:00:00.000Z',
      },
    );
    const profile = report.profiles[0]!;
    // The synthetic placeholder lives in architecturalInferences.
    assert.ok(profile.architecturalInferences.length >= 1);
    assert.equal(profile.architecturalInferences[0]!.claimType, 'inferred');
  });

  it('persists the report at the canonical orchestration path', async () => {
    const cwd = await makeCwd();
    await profileClosedSource(
      makeUniverse([
        {
          id: 'cs.z',
          name: 'Z',
          category: 'closed_source',
          source: 'manual',
          confidence: 1,
          recommendedAction: 'profile',
        },
      ]),
      {
        cwd,
        _isLLMAvailable: async () => false,
        _now: () => '2026-05-12T00:00:00.000Z',
      },
    );
    const raw = await fs.readFile(
      path.join(cwd, '.danteforge/matrix-orchestration/closed-source-profiles.json'),
      'utf8',
    );
    const persisted = JSON.parse(raw) as ClosedSourceProfileReport;
    assert.equal(persisted.profiles.length, 1);
    assert.equal(persisted.profiles[0]!.competitorName, 'Z');
  });
});
