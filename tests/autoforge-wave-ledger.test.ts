// autoforge-wave-ledger.test.ts — depth_doctrine CH-021 loop #2 proof.
//
// Standalone (not folded into autoforge-loop.test.ts, which is already over the 750-line cap): proves
// a REAL autoforge cycle drives the SHARED wave ledger and emits the canonical, byte-comparable
// receipt schema — the same one harden-crusade and ascend emit. A receipt, not a hypothesis.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runAutoforgeLoop, AutoforgeLoopState } from '../src/core/autoforge-loop.js';
import type { AutoforgeLoopContext, AutoforgeLoopDeps } from '../src/core/autoforge-loop.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';
import type { CompletionTracker } from '../src/core/completion-tracker.js';
import { readWaveLedger, reconcileReceipts } from '../src/core/wave-ledger.js';

const tempDirs: string[] = [];
after(async () => { for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function tracker(overall: number): CompletionTracker {
  return {
    overall,
    phases: {
      planning: { score: 85, complete: true, artifacts: {
        CONSTITUTION: { score: 90, complete: true }, SPEC: { score: 85, complete: true },
        CLARIFY: { score: 85, complete: true }, PLAN: { score: 85, complete: true }, TASKS: { score: 80, complete: true },
      } },
      execution: { score: overall >= 95 ? 100 : 0, complete: overall >= 95, currentPhase: 1, wavesComplete: 0, totalWaves: 3 },
      verification: { score: 0, complete: false, qaScore: 0, testsPassing: false },
      synthesis: { score: 0, complete: false, retroDelta: null },
    },
    lastUpdated: new Date().toISOString(),
    projectedCompletion: 'forge',
  } as unknown as CompletionTracker;
}

function state(): DanteState {
  return { project: 't', workflowStage: 'tasks', currentPhase: 1, tasks: { 1: [{ name: 'task-a' }] }, lastHandoff: 'none', profile: 'balanced', auditLog: [] } as unknown as DanteState;
}

function ctx(cwd: string): AutoforgeLoopContext {
  return {
    goal: 'build', cwd, state: state(), loopState: AutoforgeLoopState.IDLE, cycleCount: 0,
    startedAt: new Date().toISOString(), retryCounters: {}, blockedArtifacts: [], lastGuidance: null,
    isWebProject: false, force: false, maxRetries: 1, recentScores: [],
  };
}

function deps(cycleRef: { n: number }): Partial<AutoforgeLoopDeps> {
  return {
    scoreAllArtifacts: async () => ({} as Record<ScoredArtifact, ScoreResult>),
    persistScoreResult: async () => '/tmp/s.json',
    detectProjectType: async () => 'cli',
    // cycle 1 = forge-ready (executes a command → emits a wave); cycle 2 = complete (loop stops).
    computeCompletionTracker: () => cycleRef.n++ > 0 ? tracker(96) : tracker(30),
    recordMemory: async () => {},
    loadState: async () => state(),
    saveState: async () => {},
    setTimeout: (fn: () => void) => { fn(); return 0 as unknown as ReturnType<typeof globalThis.setTimeout>; },
    _checkProtectedPaths: async () => ({ approved: true, blocked: [] }),
    _executeCommand: async () => ({ success: true }),
    _timeMachineCommit: async () => {},
    _postWaveSanitize: async () => {},
  };
}

describe('runAutoforgeLoop — emits durable wave receipts (depth_doctrine rung-8, CH-021 loop #2)', () => {
  it('a real autoforge cycle appends a COMPLETED autoforge wave with the canonical schema', async () => {
    const cwd = path.join(os.tmpdir(), `autoforge-wave-ledger-${process.pid}-${Date.now()}`);
    await fs.mkdir(cwd, { recursive: true });
    tempDirs.push(cwd);
    await runAutoforgeLoop(ctx(cwd), deps({ n: 0 }));
    const rows = await readWaveLedger(cwd);
    const done = reconcileReceipts(rows).find(r => r.loopName === 'autoforge' && r.status === 'completed');
    assert.ok(done, 'autoforge genuinely drove the SHARED wave ledger — a receipt, not a hypothesis');
    // Byte-comparable to harden-crusade's receipt: the canonical cross-loop key-set is present.
    for (const k of ['waveId', 'runId', 'loopName', 'waveIndex', 'waveType', 'scoreCeiling', 'allowedActions', 'scoreBefore', 'scoreAfter', 'commandsRun', 'status', 'startedAt', 'completedAt']) {
      assert.ok(done && k in done, `autoforge receipt carries the canonical field "${k}"`);
    }
  });
});
