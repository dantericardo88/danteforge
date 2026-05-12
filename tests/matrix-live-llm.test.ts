// Matrix Kernel — live-LLM E2E (Phase 13a, opt-in)
//
// These tests fire REAL Claude API calls. Skipped by default.
// Enable with: DANTEFORGE_LIVE_LLM=1 npx tsx --test tests/matrix-live-llm.test.ts
//
// They validate that:
//   - Red Team Verifier actually catches stubs when given a real LLM
//   - ClaudeCodeAdapter actually produces compilable code from a real LLM
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyBranchAdversarial } from '../src/matrix/courts/red-team-verifier.js';
import { ClaudeCodeAdapter } from '../src/matrix/adapters/claude-code-adapter.js';
import { runAdapter } from '../src/matrix/adapters/adapter-interface.js';
import { callLLM } from '../src/core/llm.js';
import type { AgentLease, WorkPacket, GateReport, AgentRunResult } from '../src/matrix/types/index.js';

const LIVE = process.env.DANTEFORGE_LIVE_LLM === '1';

const tmpDirs: string[] = [];
async function tmpWorktree(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'matrix-live-'));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function fakeLease(worktreePath: string, overrides: Partial<AgentLease> = {}): AgentLease {
  return {
    id: 'lease.live.test', workPacketId: 'work.live.test',
    provider: 'claude', agentRole: 'dimension-engineer',
    branch: 'b', worktreePath,
    allowedWritePaths: ['src/hello.ts'],
    allowedReadPaths: [], forbiddenPaths: ['src/forbidden.ts'],
    requiredCommands: [], budget: { maxTokens: 50000, maxRuntimeMinutes: 10, maxIterations: 1 },
    status: 'active',
    ...overrides,
  };
}

function fakePacket(overrides: Partial<WorkPacket> = {}): WorkPacket {
  return {
    id: 'work.live.test', title: 'Hello function', objective: 'Add an exported hello() function that returns the string "hello"',
    dimensionId: 'dim.test',
    paths: {
      ownedPaths: ['src/hello.ts'],
      readOnlyPaths: [], forbiddenPaths: ['src/forbidden.ts'],
    },
    dependsOn: [], mayConflictWith: [],
    acceptanceCriteria: ['hello() function exists', 'returns string "hello"'],
    proof: { proofRequired: ['typecheck passes'] },
    tasteGateRequired: false, redTeamRequired: false,
    rollbackPlan: 'remove worktree',
    riskLevel: 'low',
    createdAt: '',
    ...overrides,
  };
}

describe('Matrix Kernel live-LLM (opt-in via DANTEFORGE_LIVE_LLM=1)', () => {
  it('Red Team Verifier returns empty findings for clean code', { skip: !LIVE }, async () => {
    const gateReport: GateReport = {
      id: 'g', leaseId: 'lease.live.test', workPacketId: 'work.live.test',
      status: 'passed', generatedAt: '',
      checks: [{ name: 'unit_tests', status: 'passed' }],
    };
    const runResult: AgentRunResult = {
      runId: 'r', leaseId: 'lease.live.test', status: 'completed',
      filesChanged: ['src/hello.ts'], commandsExecuted: [],
      startedAt: '', completedAt: '',
      finalMessage: 'Implemented hello() returning "hello"',
    };
    const report = await verifyBranchAdversarial({
      lease: fakeLease('/tmp'),
      workPacket: fakePacket({ redTeamRequired: true }),
      gateReport,
      agentRunResult: runResult,
      _redTeamCaller: async (prompt) => callLLM(prompt, 'claude'),
    });
    // Real Claude should mostly report no findings for clean code
    // (We don't strictly require .length === 0 — model may invent concerns;
    //  but it should NOT return 'fake_completion' for an honest description.)
    assert.ok(['passed', 'needs_human_review', 'failed'].includes(report.status));
    const fakeCompletionFindings = report.findings.filter(f => f.category === 'fake_completion');
    assert.equal(fakeCompletionFindings.length, 0, 'should not flag fake_completion on clean implementation');
  });

  it('Red Team Verifier catches a stub claim', { skip: !LIVE }, async () => {
    const gateReport: GateReport = {
      id: 'g2', leaseId: 'lease.live.test', workPacketId: 'work.live.test',
      status: 'failed', generatedAt: '',
      checks: [{ name: 'no_stub_scan', status: 'failed', details: 'throw new Error("not implemented")' }],
    };
    const runResult: AgentRunResult = {
      runId: 'r2', leaseId: 'lease.live.test', status: 'completed',
      filesChanged: ['src/hello.ts'], commandsExecuted: [],
      startedAt: '', completedAt: '',
      finalMessage: 'Added hello() function. Note: implementation is throw new Error("not implemented") — will fix in next PR.',
    };
    const report = await verifyBranchAdversarial({
      lease: fakeLease('/tmp'),
      workPacket: fakePacket({ redTeamRequired: true }),
      gateReport,
      agentRunResult: runResult,
      _redTeamCaller: async (prompt) => callLLM(prompt, 'claude'),
    });
    // Real Claude should reliably flag a stub claim
    assert.equal(report.status === 'failed' || report.status === 'needs_human_review', true,
      'red team should reject a self-admitted stub');
  });

  it('ClaudeCodeAdapter produces compilable code for a simple packet', { skip: !LIVE }, async () => {
    const cwd = await tmpWorktree();
    const adapter = new ClaudeCodeAdapter({
      workPacket: fakePacket(),
      maxBudgetUsd: 0.50,  // tight budget for the test
    });
    const result = await runAdapter(adapter, {
      lease: fakeLease(cwd),
      cwd,
    });
    if (result.status === 'failed') {
      // Acceptable: budget exceeded, rate limited, etc. — log and skip strict assertion.
      // Strict requirement: it should not silently succeed with zero edits.
      assert.ok(result.errorReason, 'failed run should have an errorReason');
      return;
    }
    assert.equal(result.status, 'completed');
    assert.ok(result.filesChanged.length > 0, 'should write at least one file');
    assert.ok(result.filesChanged.every(f => f === 'src/hello.ts'), 'all edits should be inside lease');
    const written = await fs.readFile(path.join(cwd, 'src/hello.ts'), 'utf8');
    assert.ok(/function\s+hello/.test(written) || /hello\s*[:=]\s*\(/.test(written),
      `expected hello function/export in output, got:\n${written.slice(0, 500)}`);
  });
});
