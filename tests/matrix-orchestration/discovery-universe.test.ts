// Tests for src/matrix-orchestration/discovery/universe.ts
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { discoverUniverse, _internal } from '../../src/matrix-orchestration/discovery/universe.js';
import { loadOrch, readAuditLog } from '../../src/matrix-orchestration/state-io.js';
import type {
  ProjectIntent,
  CompetitiveUniverse,
} from '../../src/matrix-orchestration/types.js';

const tmpDirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'matrix-orch-test-'));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function makeIntent(overrides: Partial<ProjectIntent> = {}): ProjectIntent {
  return {
    sourcePath: '/virtual/prd.md',
    projectName: 'AgentDeck',
    goal: 'Compose multi-agent pipelines from yaml.',
    projectType: 'cli_tool',
    targetUser: 'developer',
    keyFeatures: ['yaml pipelines', 'replay', 'budget caps'],
    constraintEmphasis: ['cost_critical'],
    nonGoals: ['GUI editor'],
    competitiveCategoryBoundary: {
      direct: ['AutoGen', 'CrewAI'],
      adjacent: ['LangChain'],
      research: ['MetaGPT'],
    },
    frontierFraming: {
      target: 'oss_frontier',
      matchLeaderOn: [], exceedLeaderOn: ['replay'], defineNewCategoryOn: [],
    },
    confidence: 0.85,
    extractedAt: '2026-05-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('heuristicQueries', () => {
  it('builds queries from direct categories and key features', () => {
    const q = _internal.heuristicQueries(makeIntent(), 8);
    assert.ok(q.length > 0);
    assert.ok(q.some(s => s.includes('autogen')));
    assert.ok(q.some(s => s.includes('yaml pipelines')));
  });
});

describe('toEntry + classification', () => {
  it('classifies allowed and blocked licenses correctly', () => {
    const allowed = _internal.toEntry({
      name: 'foo', repoUrl: 'https://github.com/x/foo', licenseHint: 'MIT',
      source: 'github_search', confidence: 0.7,
    });
    assert.equal(allowed.licenseStatus, 'allowed');
    assert.equal(allowed.recommendedAction, 'harvest');

    const blocked = _internal.toEntry({
      name: 'bar', repoUrl: 'https://github.com/x/bar', licenseHint: 'GPL-3.0',
      source: 'github_search', confidence: 0.7,
    });
    assert.equal(blocked.licenseStatus, 'blocked');
    assert.equal(blocked.recommendedAction, 'skip');
  });

  it('routes closed_source → profile, research → observe', () => {
    assert.equal(_internal.computeRecommendedAction('closed_source', undefined), 'profile');
    assert.equal(_internal.computeRecommendedAction('research', undefined), 'observe');
    assert.equal(_internal.computeRecommendedAction('oss', undefined), 'profile'); // license unknown
  });
});

describe('dedupeEntries', () => {
  it('merges duplicates by name + repoUrl, prefers the higher-confidence entry', () => {
    const a = _internal.toEntry({ name: 'Foo', repoUrl: 'https://x', source: 'github_search', confidence: 0.5 });
    const b = _internal.toEntry({ name: 'Foo', repoUrl: 'https://x', source: 'awesome_list', confidence: 0.9 });
    const out = _internal.dedupeEntries([a, b]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.confidence, 0.9);
  });
});

describe('discoverUniverse — full flow with injection', () => {
  it('merges github + awesome + manual seeds, dedupes, classifies licenses, persists, audits', async () => {
    const cwd = await tmp();
    let ghCalls = 0;
    let awesomeCalls = 0;
    const universe = await discoverUniverse(makeIntent(), {
      cwd,
      mode: 'local',
      skipApproval: true,
      _now: () => '2026-05-12T00:00:00.000Z',
      _githubSearch: async (q) => {
        ghCalls++;
        return q.includes('autogen')
          ? [{ name: 'AutoGen', url: 'https://github.com/microsoft/autogen', license: 'MIT' }]
          : [];
      },
      _awesomeScan: async () => {
        awesomeCalls++;
        return [{ name: 'CrewAI', url: 'https://github.com/joaomdmoura/crewai', license: 'MIT' }];
      },
    });

    assert.ok(ghCalls > 0);
    assert.equal(awesomeCalls, 1);
    assert.equal(universe.approvedByUser, true);
    assert.equal(universe.approvedAt, '2026-05-12T00:00:00.000Z');
    assert.ok(universe.entries.some(e => e.name === 'AutoGen' && e.licenseStatus === 'allowed'));
    assert.ok(universe.entries.some(e => e.name === 'CrewAI'));
    assert.ok(universe.entries.some(e => e.name === 'LangChain' && e.category === 'hybrid'));
    assert.ok(universe.entries.some(e => e.name === 'MetaGPT' && e.category === 'research'));

    const saved = await loadOrch<CompetitiveUniverse>(cwd, 'competitiveUniverse');
    assert.deepEqual(saved, universe);
    const audit = await readAuditLog(cwd);
    assert.ok(audit.some(e => e.kind === 'user_approval'));
    assert.ok(audit.some(e => e.kind === 'stage_completed'));
  });

  it('honors _confirm when skipApproval is false', async () => {
    const cwd = await tmp();
    let prompted = false;
    const universe = await discoverUniverse(makeIntent(), {
      cwd,
      mode: 'local',
      skipApproval: false,
      _now: () => '2026-05-12T00:00:00.000Z',
      _githubSearch: async () => [],
      _awesomeScan: async () => [],
      _confirm: async (msg) => { prompted = true; assert.ok(msg.includes('AgentDeck')); return true; },
    });
    assert.equal(prompted, true);
    assert.equal(universe.approvedByUser, true);
  });

  it('does NOT approve when _confirm returns false', async () => {
    const cwd = await tmp();
    const universe = await discoverUniverse(makeIntent(), {
      cwd, mode: 'local', skipApproval: false,
      _now: () => '2026-05-12T00:00:00.000Z',
      _githubSearch: async () => [],
      _awesomeScan: async () => [],
      _confirm: async () => false,
    });
    assert.equal(universe.approvedByUser, false);
    const audit = await readAuditLog(cwd);
    assert.ok(audit.some(e => e.kind === 'user_rejection'));
  });

  it('falls back gracefully when awesome-scan throws', async () => {
    const cwd = await tmp();
    const universe = await discoverUniverse(makeIntent(), {
      cwd, mode: 'local', skipApproval: true,
      _now: () => '2026-05-12T00:00:00.000Z',
      _githubSearch: async () => [],
      _awesomeScan: async () => { throw new Error('awesome blew up'); },
    });
    // manual seeds still come through
    assert.ok(universe.entries.length > 0);
    assert.ok(universe.entries.some(e => e.name === 'AutoGen'));
  });

  it('uses the LLM caller to expand queries when mode === "llm"', async () => {
    const cwd = await tmp();
    let llmCalls = 0;
    let captured: string[] = [];
    await discoverUniverse(makeIntent(), {
      cwd, mode: 'llm', skipApproval: true,
      _now: () => '2026-05-12T00:00:00.000Z',
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { llmCalls++; return JSON.stringify(['autogen alternative', 'agent pipeline yaml']); },
      _githubSearch: async (q) => { captured.push(q); return []; },
      _awesomeScan: async () => [],
    });
    assert.equal(llmCalls, 1);
    assert.ok(captured.includes('autogen alternative'));
  });
});
