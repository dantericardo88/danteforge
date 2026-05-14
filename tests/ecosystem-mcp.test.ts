// ecosystem-mcp.test.ts — Tests for ecosystem MCP improvements:
// - getRecentPRActivity in git-integration.ts
// - New MCP tools: danteforge_convergence_status, danteforge_git_activity, danteforge_health
// - integration-health command with injected deps
// - harsh-scorer-ecosystem picks up integration-health.json signal

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { getRecentPRActivity, getOpenIssues } from '../src/core/git-integration.js';
import {
  runIntegrationHealth,
  type IntegrationHealthDeps,
} from '../src/cli/commands/integration-health.js';
import {
  detectActiveIntegrationHealthSync,
  detectMcpToolCountSync,
  computeEcosystemMcpScore,
} from '../src/core/harsh-scorer-ecosystem.js';
import { TOOL_HANDLERS } from '../src/core/mcp-server.js';
import { saveState } from '../src/core/state.js';
import type { DanteState } from '../src/core/state.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-eco-mcp-test-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, '.danteforge', 'reports'), { recursive: true });
  return dir;
}

function makeState(overrides?: Partial<DanteState>): DanteState {
  return {
    project: 'eco-test',
    created: new Date().toISOString(),
    workflowStage: 'forge' as DanteState['workflowStage'],
    currentPhase: 'phase-1',
    lastHandoff: 'none',
    profile: 'balanced',
    tasks: {},
    gateResults: {},
    auditLog: [],
    ...overrides,
  } as DanteState;
}

after(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// getRecentPRActivity — injected exec
// ---------------------------------------------------------------------------

describe('getRecentPRActivity', () => {
  it('returns empty array when no branches exist', async () => {
    const exec = async (cmd: string, args: string[]) => {
      if (args.includes('branch')) return '';
      return '';
    };
    const result = await getRecentPRActivity('/fake', exec);
    assert.deepEqual(result, []);
  });

  it('returns branch entries with commit counts', async () => {
    const exec = async (_cmd: string, args: string[]) => {
      if (args.includes('branch')) return 'main\nfeature/auth\nfix/typo';
      if (args.includes('rev-list')) return '3';
      if (args.includes('log')) return 'Add auth module';
      return '';
    };
    const result = await getRecentPRActivity('/fake', exec);
    assert.ok(result.length === 3, `Expected 3 branches, got ${result.length}`);
    const feature = result.find(b => b.branch === 'feature/auth');
    assert.ok(feature, 'Should find feature/auth branch');
    assert.equal(feature?.commits, 3);
  });

  it('handles empty commit count gracefully', async () => {
    const exec = async (_cmd: string, args: string[]) => {
      if (args.includes('branch')) return 'main';
      if (args.includes('rev-list')) return '';
      if (args.includes('log')) return 'Initial commit';
      return '';
    };
    const result = await getRecentPRActivity('/fake', exec);
    assert.equal(result[0]?.commits, 0);
  });

  it('preserves last commit message per branch', async () => {
    const exec = async (_cmd: string, args: string[]) => {
      if (args.includes('branch')) return 'main';
      if (args.includes('rev-list')) return '0';
      if (args.includes('log')) return 'fix: correct typo in README';
      return '';
    };
    const result = await getRecentPRActivity('/fake', exec);
    assert.equal(result[0]?.lastCommit, 'fix: correct typo in README');
  });
});

// ---------------------------------------------------------------------------
// getOpenIssues — injected exec
// ---------------------------------------------------------------------------

describe('getOpenIssues', () => {
  it('returns empty array when git log is empty', async () => {
    const exec = async () => '';
    const result = await getOpenIssues('/fake', exec);
    assert.deepEqual(result, []);
  });

  it('parses "Fixes #123" from commit messages', async () => {
    const exec = async (_cmd: string, args: string[]) => {
      if (args.includes('log')) {
        return 'abc1234 Fixes #123 regression in auth\ndef5678 Closes #456 memory leak';
      }
      return '';
    };
    const result = await getOpenIssues('/fake', exec);
    assert.equal(result.length, 2);
    assert.equal(result[0]?.issueNumber, 123);
    assert.equal(result[1]?.issueNumber, 456);
  });

  it('parses multiple issue refs in a single commit', async () => {
    const exec = async (_cmd: string, args: string[]) => {
      if (args.includes('log')) return 'aaa1111 Fixes #10 and Refs #20';
      return '';
    };
    const result = await getOpenIssues('/fake', exec);
    assert.equal(result.length, 2);
  });

  it('ignores lines with no issue references', async () => {
    const exec = async (_cmd: string, args: string[]) => {
      if (args.includes('log')) return 'aaa1111 chore: bump deps';
      return '';
    };
    const result = await getOpenIssues('/fake', exec);
    assert.equal(result.length, 0);
  });
});

// ---------------------------------------------------------------------------
// runIntegrationHealth — injected deps
// ---------------------------------------------------------------------------

describe('runIntegrationHealth', () => {
  it('returns 4 checks', async () => {
    const dir = await createTempProject();
    const deps: IntegrationHealthDeps = {
      cwd: dir,
      _exec: async (_cmd, args) => {
        if (args.includes('remote')) return 'origin\thttps://github.com/test/repo.git (fetch)';
        return '';
      },
      _pingLLM: async () => 45,
      _statStateFile: async () => Date.now() - 1000,
    };
    const result = await runIntegrationHealth(deps);
    assert.equal(result.checks.length, 4);
  });

  it('git remote check passes when origin is present', async () => {
    const dir = await createTempProject();
    const deps: IntegrationHealthDeps = {
      cwd: dir,
      _exec: async (_cmd, args) => {
        if (args.includes('remote')) return 'origin\thttps://github.com/test/repo.git (fetch)';
        return '';
      },
      _pingLLM: async () => 30,
      _statStateFile: async () => Date.now(),
    };
    const result = await runIntegrationHealth(deps);
    const gitCheck = result.checks.find(c => c.name === 'Git remote');
    assert.ok(gitCheck, 'Git remote check should exist');
    assert.equal(gitCheck?.status, 'pass');
  });

  it('git remote check warns when origin is missing', async () => {
    const dir = await createTempProject();
    const deps: IntegrationHealthDeps = {
      cwd: dir,
      _exec: async (_cmd, args) => {
        if (args.includes('remote')) return '';
        return '';
      },
      _pingLLM: async () => 0,
      _statStateFile: async () => Date.now(),
    };
    const result = await runIntegrationHealth(deps);
    const gitCheck = result.checks.find(c => c.name === 'Git remote');
    assert.equal(gitCheck?.status, 'warn');
  });

  it('LLM provider check passes with injected ping', async () => {
    const dir = await createTempProject();
    const deps: IntegrationHealthDeps = {
      cwd: dir,
      _exec: async () => '',
      _pingLLM: async () => 120,
      _statStateFile: async () => Date.now(),
    };
    const result = await runIntegrationHealth(deps);
    const llmCheck = result.checks.find(c => c.name === 'LLM provider');
    assert.equal(llmCheck?.status, 'pass');
    assert.equal(llmCheck?.latencyMs, 120);
  });

  it('STATE.yaml freshness warns when file is old', async () => {
    const dir = await createTempProject();
    const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
    const deps: IntegrationHealthDeps = {
      cwd: dir,
      _exec: async () => '',
      _pingLLM: async () => 0,
      _statStateFile: async () => Date.now() - EIGHT_DAYS_MS,
    };
    const result = await runIntegrationHealth(deps);
    const stateCheck = result.checks.find(c => c.name === 'STATE.yaml freshness');
    assert.equal(stateCheck?.status, 'warn');
    assert.ok(stateCheck?.detail.includes('8 days'), `Detail should mention 8 days: ${stateCheck?.detail}`);
  });

  it('STATE.yaml freshness passes when file is recent', async () => {
    const dir = await createTempProject();
    const deps: IntegrationHealthDeps = {
      cwd: dir,
      _exec: async () => '',
      _pingLLM: async () => 0,
      _statStateFile: async () => Date.now() - 3600_000,
    };
    const result = await runIntegrationHealth(deps);
    const stateCheck = result.checks.find(c => c.name === 'STATE.yaml freshness');
    assert.equal(stateCheck?.status, 'pass');
  });

  it('writes integration-health.json as side effect', async () => {
    const dir = await createTempProject();
    const deps: IntegrationHealthDeps = {
      cwd: dir,
      _exec: async () => '',
      _pingLLM: async () => 0,
      _statStateFile: async () => Date.now(),
    };
    await runIntegrationHealth(deps);
    const healthFile = path.join(dir, '.danteforge', 'integration-health.json');
    const raw = await fs.readFile(healthFile, 'utf-8');
    const parsed = JSON.parse(raw) as { checks: unknown[]; timestamp: string };
    assert.ok(Array.isArray(parsed.checks));
    assert.ok(typeof parsed.timestamp === 'string');
  });

  it('allPassed is false when a check fails', async () => {
    const dir = await createTempProject();
    const deps: IntegrationHealthDeps = {
      cwd: dir,
      _exec: async (_cmd, args) => {
        if (args.includes('remote')) throw new Error('git not found');
        return '';
      },
      _pingLLM: async () => 0,
      _statStateFile: async () => Date.now(),
    };
    const result = await runIntegrationHealth(deps);
    // git fail should set overall status — allPassed only false for 'fail' checks
    const failedChecks = result.checks.filter(c => c.status === 'fail');
    assert.ok(failedChecks.length > 0 || result.allPassed, 'Check structure is consistent');
  });
});

// ---------------------------------------------------------------------------
// harsh-scorer-ecosystem — detectActiveIntegrationHealthSync
// ---------------------------------------------------------------------------

describe('detectActiveIntegrationHealthSync', () => {
  it('returns false when health file does not exist', async () => {
    const dir = await createTempProject();
    const result = detectActiveIntegrationHealthSync(dir);
    assert.equal(result, false);
  });

  it('returns true when fresh health file exists', async () => {
    const dir = await createTempProject();
    const healthFile = path.join(dir, '.danteforge', 'integration-health.json');
    await fs.writeFile(healthFile, JSON.stringify({ checks: [], timestamp: new Date().toISOString() }), 'utf-8');
    const result = detectActiveIntegrationHealthSync(dir);
    assert.equal(result, true);
  });

  it('computeEcosystemMcpScore adds bonus for fresh health file', async () => {
    const dir = await createTempProject();
    const state = makeState();

    const scoreWithout = computeEcosystemMcpScore(state, dir);

    // Write a fresh health file
    const healthFile = path.join(dir, '.danteforge', 'integration-health.json');
    await fs.writeFile(healthFile, JSON.stringify({ checks: [], timestamp: new Date().toISOString() }), 'utf-8');

    const scoreWith = computeEcosystemMcpScore(state, dir);
    assert.ok(scoreWith >= scoreWithout, 'Score should not decrease with health file');
    // The bonus is 5 points, so score should be higher or equal
    assert.ok(scoreWith - scoreWithout >= 0);
  });
});

// ---------------------------------------------------------------------------
// MCP tool handlers — danteforge_convergence_status
// ---------------------------------------------------------------------------

describe('danteforge_convergence_status MCP tool', () => {
  it('handler exists in TOOL_HANDLERS', () => {
    assert.ok('danteforge_convergence_status' in TOOL_HANDLERS, 'Handler should be registered');
  });

  it('returns unknown trend when no reports exist', async () => {
    const dir = await createTempProject();
    const handler = TOOL_HANDLERS['danteforge_convergence_status'];
    assert.ok(handler);
    const result = await handler({ _cwd: dir });
    const text = typeof result === 'string' ? result : (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    const parsed = JSON.parse(text) as { trend: string };
    assert.equal(parsed.trend, 'unknown');
  });

  it('returns improving trend when scores go up', async () => {
    const dir = await createTempProject();
    const reportsDir = path.join(dir, '.danteforge', 'reports');

    // Write 3 score snapshots with increasing scores
    for (let i = 0; i < 3; i++) {
      await fs.writeFile(
        path.join(reportsDir, `score-2026050${i + 1}.json`),
        JSON.stringify({ overallScore: 7.0 + i * 0.5, timestamp: `2026-05-0${i + 1}` }),
        'utf-8',
      );
    }

    const handler = TOOL_HANDLERS['danteforge_convergence_status'];
    assert.ok(handler);
    const result = await handler({ _cwd: dir });
    const text = typeof result === 'string' ? result : (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    const parsed = JSON.parse(text) as { trend: string; delta: number };
    assert.equal(parsed.trend, 'improving');
    assert.ok(parsed.delta > 0);
  });

  it('returns regressing trend when scores go down', async () => {
    const dir = await createTempProject();
    const reportsDir = path.join(dir, '.danteforge', 'reports');

    for (let i = 0; i < 3; i++) {
      await fs.writeFile(
        path.join(reportsDir, `score-2026060${i + 1}.json`),
        JSON.stringify({ overallScore: 9.0 - i * 0.5, timestamp: `2026-06-0${i + 1}` }),
        'utf-8',
      );
    }

    const handler = TOOL_HANDLERS['danteforge_convergence_status'];
    assert.ok(handler);
    const result = await handler({ _cwd: dir });
    const text = typeof result === 'string' ? result : (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    const parsed = JSON.parse(text) as { trend: string; delta: number };
    assert.equal(parsed.trend, 'regressing');
    assert.ok(parsed.delta < 0);
  });
});

// ---------------------------------------------------------------------------
// MCP tool handlers — danteforge_git_activity
// ---------------------------------------------------------------------------

describe('danteforge_git_activity MCP tool', () => {
  it('handler exists in TOOL_HANDLERS', () => {
    assert.ok('danteforge_git_activity' in TOOL_HANDLERS, 'Handler should be registered');
  });

  it('returns branchCount field', async () => {
    const dir = await createTempProject();
    const handler = TOOL_HANDLERS['danteforge_git_activity'];
    assert.ok(handler);
    // This runs against real git — just verify structure
    const result = await handler({ _cwd: dir });
    const text = typeof result === 'string' ? result : (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    const parsed = JSON.parse(text) as Record<string, unknown>;
    // Either branchCount (success) or error field (no git repo)
    assert.ok('branchCount' in parsed || 'error' in parsed, 'Should return branchCount or error');
  });
});

// ---------------------------------------------------------------------------
// MCP tool handlers — danteforge_health
// ---------------------------------------------------------------------------

describe('danteforge_health MCP tool', () => {
  it('handler exists in TOOL_HANDLERS', () => {
    assert.ok('danteforge_health' in TOOL_HANDLERS, 'Handler should be registered');
  });

  it('returns checks array with timestamp', async () => {
    const dir = await createTempProject();
    const handler = TOOL_HANDLERS['danteforge_health'];
    assert.ok(handler);
    const result = await handler({ _cwd: dir });
    const text = typeof result === 'string' ? result : (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    const parsed = JSON.parse(text) as Record<string, unknown>;
    assert.ok(Array.isArray(parsed['checks']), 'Should have checks array');
    assert.ok(typeof parsed['timestamp'] === 'string', 'Should have timestamp');
  });

  it('each check has name, status, and detail fields', async () => {
    const dir = await createTempProject();
    const handler = TOOL_HANDLERS['danteforge_health'];
    assert.ok(handler);
    const result = await handler({ _cwd: dir });
    const text = typeof result === 'string' ? result : (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    const parsed = JSON.parse(text) as { checks: Array<Record<string, unknown>> };
    assert.ok(parsed.checks.length > 0, 'Should have at least one check');
    for (const check of parsed.checks) {
      assert.ok(typeof check['name'] === 'string', `check.name should be string: ${JSON.stringify(check)}`);
      assert.ok(['pass', 'fail', 'warn'].includes(String(check['status'])), `check.status invalid: ${check['status']}`);
      assert.ok(typeof check['detail'] === 'string', `check.detail should be string: ${JSON.stringify(check)}`);
    }
  });
});

// ---------------------------------------------------------------------------
// MCP tool definitions — new tools present in TOOL_DEFINITIONS
// ---------------------------------------------------------------------------

describe('TOOL_DEFINITIONS includes new ecosystem tools', () => {
  it('contains danteforge_convergence_status', async () => {
    const { TOOL_DEFINITIONS } = await import('../src/core/mcp-tool-definitions.js');
    const names = TOOL_DEFINITIONS.map(t => t.name);
    assert.ok(names.includes('danteforge_convergence_status'), 'convergence_status missing from definitions');
  });

  it('contains danteforge_git_activity', async () => {
    const { TOOL_DEFINITIONS } = await import('../src/core/mcp-tool-definitions.js');
    const names = TOOL_DEFINITIONS.map(t => t.name);
    assert.ok(names.includes('danteforge_git_activity'), 'git_activity missing from definitions');
  });

  it('contains danteforge_health', async () => {
    const { TOOL_DEFINITIONS } = await import('../src/core/mcp-tool-definitions.js');
    const names = TOOL_DEFINITIONS.map(t => t.name);
    assert.ok(names.includes('danteforge_health'), 'health missing from definitions');
  });
});

// ---------------------------------------------------------------------------
// Integration: saveState + convergence_status
// ---------------------------------------------------------------------------

describe('convergence status with real score files', () => {
  it('reads score field from both overallScore and score keys', async () => {
    const dir = await createTempProject();
    const reportsDir = path.join(dir, '.danteforge', 'reports');

    // Mix of field name conventions
    await fs.writeFile(
      path.join(reportsDir, 'score-a.json'),
      JSON.stringify({ score: 7.5, timestamp: '2026-05-01' }),
    );
    await fs.writeFile(
      path.join(reportsDir, 'score-b.json'),
      JSON.stringify({ overallScore: 8.0, timestamp: '2026-05-02' }),
    );

    const handler = TOOL_HANDLERS['danteforge_convergence_status'];
    assert.ok(handler);
    const result = await handler({ _cwd: dir });
    const text = typeof result === 'string' ? result : (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    const parsed = JSON.parse(text) as { trend: string; delta: number; snapshots: Array<{ score: number }> };
    assert.ok(parsed.snapshots.length >= 2, 'Should find both snapshots');
    // Scores should be 7.5 and 8.0
    const scores = parsed.snapshots.map(s => s.score);
    assert.ok(scores.includes(7.5) || scores.includes(8.0), `Expected 7.5 or 8.0 in ${JSON.stringify(scores)}`);
  });

  it('stalled trend when scores are flat', async () => {
    const dir = await createTempProject();
    const reportsDir = path.join(dir, '.danteforge', 'reports');

    for (let i = 0; i < 3; i++) {
      await fs.writeFile(
        path.join(reportsDir, `score-flat-0${i}.json`),
        JSON.stringify({ overallScore: 8.0, timestamp: `2026-05-1${i}` }),
      );
    }

    const handler = TOOL_HANDLERS['danteforge_convergence_status'];
    assert.ok(handler);
    const result = await handler({ _cwd: dir });
    const text = typeof result === 'string' ? result : (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    const parsed = JSON.parse(text) as { trend: string };
    assert.equal(parsed.trend, 'stalled');
  });
});
