// Tests for src/matrix-orchestration/discovery/social-signal.ts
//
// V1 contract: the module is a stub that returns a disabled report by
// default. These tests pin the contract so v1.1's wiring tests stay valid.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { captureSocialSignal } from '../../src/matrix-orchestration/discovery/social-signal.js';
import { loadOrch, readAuditLog } from '../../src/matrix-orchestration/state-io.js';
import type {
  CompetitiveUniverse,
  SocialSignalReport,
} from '../../src/matrix-orchestration/types.js';

const tmpDirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'matrix-orch-test-'));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function makeUniverse(): CompetitiveUniverse {
  return {
    generatedAt: '2026-05-12T00:00:00.000Z',
    projectName: 'AgentDeck',
    entries: [
      { id: 'autogen', name: 'AutoGen', category: 'oss', source: 'github_search', confidence: 0.7, recommendedAction: 'harvest' },
    ],
    approvedByUser: true,
    approvedAt: '2026-05-12T00:00:00.000Z',
  };
}

describe('captureSocialSignal — disabled by default', () => {
  it('returns enabled=false with the documented skipReason and never calls any seam', async () => {
    const cwd = await tmp();
    let hnCalls = 0, redditCalls = 0, xCalls = 0;
    const report = await captureSocialSignal(makeUniverse(), {
      cwd,
      _now: () => '2026-05-12T00:00:00.000Z',
      _hnSearch: async () => { hnCalls++; return []; },
      _redditSearch: async () => { redditCalls++; return []; },
      _xSearch: async () => { xCalls++; return []; },
    });
    assert.equal(report.enabled, false);
    assert.ok(report.skippedReason?.includes('v1'));
    assert.deepEqual(report.mentions, []);
    assert.deepEqual(report.aggregates, []);
    assert.equal(hnCalls, 0);
    assert.equal(redditCalls, 0);
    assert.equal(xCalls, 0);
  });

  it('persists the disabled report and writes an audit event', async () => {
    const cwd = await tmp();
    await captureSocialSignal(makeUniverse(), {
      cwd, _now: () => '2026-05-12T00:00:00.000Z',
    });
    const saved = await loadOrch<SocialSignalReport>(cwd, 'socialSignal');
    assert.ok(saved);
    assert.equal(saved!.enabled, false);
    const audit = await readAuditLog(cwd);
    assert.ok(audit.some(e => e.kind === 'stage_completed'));
  });
});

describe('captureSocialSignal — enabled flag plumbing (v1.1 wired)', () => {
  it('when opted-in, fetches via the injected HN seam and records sourcesRequested (NO live network)', async () => {
    const cwd = await tmp();
    let hnCalls = 0;
    const report = await captureSocialSignal(makeUniverse(), {
      cwd, enabled: true,
      sources: ['hackernews', 'reddit'],
      _now: () => '2026-05-12T00:00:00.000Z',
      // Inject the seam → deterministic, no live HN Algolia call.
      _hnSearch: async () => { hnCalls++; return { hits: [{ title: 'AutoGen is great', url: 'http://example/1' }] }; },
    });
    assert.equal(report.enabled, true);
    assert.equal(hnCalls, 1, 'the HN seam was used (no live fetch)');
    assert.equal(report.mentions.length, 1, 'mentions captured from the seam');
    assert.equal(report.mentions[0]!.competitorName, 'AutoGen');
    const audit = await readAuditLog(cwd);
    const last = audit[audit.length - 1];
    assert.ok(last);
    const payload = last.payload as { sourcesRequested?: string[]; mentionsCollected?: number };
    assert.deepEqual(payload.sourcesRequested, ['hackernews', 'reddit']);
    assert.equal(payload.mentionsCollected, 1);
  });

  it('defaults sources to ["hackernews"] when enabled without explicit sources', async () => {
    const cwd = await tmp();
    await captureSocialSignal(makeUniverse(), {
      cwd, enabled: true, _now: () => '2026-05-12T00:00:00.000Z',
      _hnSearch: async () => ({ hits: [] }), // injected → no live network
    });
    const audit = await readAuditLog(cwd);
    const last = audit[audit.length - 1];
    const payload = last!.payload as { sourcesRequested?: string[] };
    assert.deepEqual(payload.sourcesRequested, ['hackernews']);
  });
});
