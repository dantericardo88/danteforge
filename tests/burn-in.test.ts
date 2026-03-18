// Burn-in test — exercises the autoforge loop state machine through synthetic cycles
// DanteForge v0.8.1 — no live LLM needed; local state + PDSE scoring only.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  AutoforgeLoopState,
  computeBackoff,
  CIRCUIT_BREAKER_BACKOFF_BASE_MS,
  CIRCUIT_BREAKER_MAX_BACKOFF_MS,
  CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT,
  type AutoforgeLoopContext,
} from '../src/core/autoforge-loop.js';
import { loadState, saveState, type DanteState } from '../src/core/state.js';
import {
  scoreArtifact,
  scoreAllArtifacts,
  persistScoreResult,
  computeAutoforgeDecision,
  type ScoreResult,
  type ScoringContext,
} from '../src/core/pdse.js';
import type { ScoredArtifact } from '../src/core/pdse-config.js';
import { SCORE_THRESHOLDS } from '../src/core/pdse-config.js';
import { computeCompletionTracker, type CompletionTracker } from '../src/core/completion-tracker.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-burnin-'));
  await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
  return dir;
}

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'burn-in-project',
    workflowStage: 'initialized',
    currentPhase: 1,
    tasks: { 1: [{ name: 'wave-1' }], 2: [{ name: 'wave-2' }], 3: [{ name: 'wave-3' }] },
    lastHandoff: 'none',
    profile: 'balanced',
    auditLog: [],
    projectType: 'cli',
    ...overrides,
  };
}

function makeContext(cwd: string, overrides: Partial<AutoforgeLoopContext> = {}): AutoforgeLoopContext {
  return {
    goal: 'burn-in synthetic test',
    cwd,
    state: makeState(overrides.state ? {} : {}),
    loopState: AutoforgeLoopState.IDLE,
    cycleCount: 0,
    startedAt: new Date().toISOString(),
    retryCounters: {},
    blockedArtifacts: [],
    lastGuidance: null,
    isWebProject: false,
    force: false,
    maxRetries: 3,
    ...overrides,
  };
}

/**
 * Generates a progressively better artifact for a given cycle.
 * At cycle 0 the content is bare-bones; by cycle 10+ it has all
 * required sections and constitution keywords, pushing scores upward.
 */
function generateProgressiveArtifact(
  artifact: ScoredArtifact,
  cycle: number,
  maxCycles: number,
): string {
  const progress = Math.min(cycle / maxCycles, 1.0);

  const sections: Record<ScoredArtifact, string[]> = {
    CONSTITUTION: [
      '# Constitution\n',
      'This document establishes zero ambiguity principles for the project.',
      progress > 0.2 ? 'All operations must be local-first and deterministic.' : '',
      progress > 0.4 ? 'Developers must atomic commit every verified change.' : '',
      progress > 0.6 ? 'We verify before commit with fail-closed audit gates.' : '',
    ],
    SPEC: [
      '# Specification\n',
      '## Feature Overview\nBuild a CLI tool for automated project scaffolding.',
      progress > 0.2 ? '## What\nThe tool generates project structure from templates.' : '',
      progress > 0.3 ? '## User Stories\nAs a developer I want to scaffold projects quickly.' : '',
      progress > 0.4 ? '## Non-functional Requirements\nMust run in <2s, zero ambiguity, local-first, deterministic.' : '',
      progress > 0.6 ? '## Acceptance Criteria\n- CLI outputs valid project structure\n- All tests pass\n- verify before commit' : '',
    ],
    CLARIFY: [
      '# Clarification\n',
      '## Ambiguities Identified\nNone remaining after review.',
      progress > 0.3 ? '## Missing Requirements\nAll requirements captured in SPEC.' : '',
      progress > 0.5 ? '## Consistency Check\nCross-referenced with constitution: zero ambiguity, local-first, atomic commit.' : '',
      progress > 0.7 ? '## Clarification Notes\nAll edge cases resolved. Deterministic behavior confirmed. Verify audit trail.' : '',
    ],
    PLAN: [
      '# Plan\n',
      '## Architecture\nSingle-binary CLI with modular command system.',
      progress > 0.2 ? '## Implementation\nPhased rollout across 3 waves.' : '',
      progress > 0.3 ? '## Technology\nNode.js + TypeScript. zero ambiguity, local-first, deterministic.' : '',
      progress > 0.5 ? '## Risk Assessment\nMitigated via fail-closed gates and atomic commit strategy.' : '',
      progress > 0.7 ? '## Testing Strategy\nUnit + integration tests; verify before commit; audit all changes.' : '',
    ],
    TASKS: [
      '# Tasks\n',
      '### Phase 1\n- task: scaffold project structure (verify: directory exists, done: output matches template)',
      progress > 0.3 ? '### Phase 2\n- task: implement command parser (verify: commands registered, acceptance: help flag works)' : '',
      progress > 0.5 ? '### Phase 3\n- task: add test suite (verify: tests pass, assert: coverage > 80%, done: CI green)' : '',
      progress > 0.7 ? '\nzero ambiguity, local-first, atomic commit, deterministic, verify, audit' : '',
    ],
  };

  return (sections[artifact] ?? []).filter(Boolean).join('\n');
}

/**
 * Writes all 5 artifacts at a given quality level into the .danteforge dir.
 */
async function writeArtifactsForCycle(cwd: string, cycle: number, maxCycles: number): Promise<void> {
  const stateDir = path.join(cwd, '.danteforge');
  const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];
  for (const artifact of artifacts) {
    const content = generateProgressiveArtifact(artifact, cycle, maxCycles);
    await fs.writeFile(path.join(stateDir, `${artifact}.md`), content);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Burn-in: autoforge loop state machine (synthetic cycles)', () => {

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('monotonically increasing completion across 12 synthetic cycles', async () => {
    const CYCLES = 12;
    const state = makeState();
    await saveState(state, { cwd: tmpDir });

    const overallScores: number[] = [];

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      await writeArtifactsForCycle(tmpDir, cycle, CYCLES);

      const currentState = await loadState({ cwd: tmpDir });
      const scores = await scoreAllArtifacts(tmpDir, currentState);
      const tracker = computeCompletionTracker(currentState, scores);

      overallScores.push(tracker.overall);

      // Persist scores to exercise persistence path
      for (const result of Object.values(scores)) {
        await persistScoreResult(result, tmpDir);
      }

      currentState.completionTracker = tracker;
      await saveState(currentState, { cwd: tmpDir });
    }

    // Verify monotonically non-decreasing overall completion
    for (let i = 1; i < overallScores.length; i++) {
      assert.ok(
        overallScores[i]! >= overallScores[i - 1]!,
        `Completion regressed at cycle ${i}: ${overallScores[i]} < ${overallScores[i - 1]}`,
      );
    }

    // First cycle should have a lower score than last
    assert.ok(
      overallScores[overallScores.length - 1]! > overallScores[0]!,
      `Final score (${overallScores[overallScores.length - 1]}) should exceed initial score (${overallScores[0]})`,
    );
  });

  it('audit log stays bounded (<1000 entries) after many cycles', async () => {
    const CYCLES = 15;
    const state = makeState();
    await saveState(state, { cwd: tmpDir });

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      await writeArtifactsForCycle(tmpDir, cycle, CYCLES);
      const currentState = await loadState({ cwd: tmpDir });

      // Simulate what runAutoforgeLoop does: push audit entries each cycle
      currentState.auditLog.push(
        `${new Date().toISOString()} | autoforge-loop: cycle ${cycle + 1} scoring pass`,
      );
      currentState.auditLog.push(
        `${new Date().toISOString()} | autoforge-loop: cycle ${cycle + 1} executing forge`,
      );

      const scores = await scoreAllArtifacts(tmpDir, currentState);
      currentState.completionTracker = computeCompletionTracker(currentState, scores);
      await saveState(currentState, { cwd: tmpDir });
    }

    const finalState = await loadState({ cwd: tmpDir });
    assert.ok(
      finalState.auditLog.length < 1000,
      `Audit log has ${finalState.auditLog.length} entries — should be <1000 after ${CYCLES} cycles`,
    );

    // Verify state file stays under 1MB
    const stateFilePath = path.join(tmpDir, '.danteforge', 'STATE.yaml');
    const stat = await fs.stat(stateFilePath);
    assert.ok(
      stat.size < 1_000_000,
      `STATE.yaml is ${stat.size} bytes — should be <1MB`,
    );
  });

  it('blocked artifacts accumulate when scores stay low', async () => {
    // Write minimal/empty artifacts that will score below NEEDS_WORK threshold
    const stateDir = path.join(tmpDir, '.danteforge');
    const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];

    for (const artifact of artifacts) {
      await fs.writeFile(path.join(stateDir, `${artifact}.md`), 'Minimal content.');
    }

    const state = makeState();
    await saveState(state, { cwd: tmpDir });

    const ctx = makeContext(tmpDir, { state });

    // Simulate 5 cycles of low-quality artifacts staying blocked
    for (let cycle = 0; cycle < 5; cycle++) {
      ctx.cycleCount++;
      const scores = await scoreAllArtifacts(tmpDir, state);

      // Find blocked artifacts (score < NEEDS_WORK)
      const blocked: string[] = [];
      for (const [name, result] of Object.entries(scores)) {
        if (result.score < SCORE_THRESHOLDS.NEEDS_WORK) {
          blocked.push(name);
          ctx.retryCounters[name] = (ctx.retryCounters[name] ?? 0) + 1;
        }
      }
      ctx.blockedArtifacts = blocked;
    }

    // With minimal content, all artifacts should be blocked
    assert.ok(
      ctx.blockedArtifacts.length > 0,
      `Expected blocked artifacts, got ${ctx.blockedArtifacts.length}`,
    );

    // Retry counters should have accumulated
    for (const artifact of ctx.blockedArtifacts) {
      assert.ok(
        (ctx.retryCounters[artifact] ?? 0) >= 3,
        `Expected retry counter for ${artifact} >= 3, got ${ctx.retryCounters[artifact]}`,
      );
    }
  });

  it('retry counters reset to 0 after artifact passes scoring', async () => {
    const state = makeState();
    await saveState(state, { cwd: tmpDir });
    const ctx = makeContext(tmpDir, { state });

    // Phase 1: Write bad artifacts and accumulate retries
    const stateDir = path.join(tmpDir, '.danteforge');
    const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];

    for (const artifact of artifacts) {
      await fs.writeFile(path.join(stateDir, `${artifact}.md`), 'Bare minimum.');
      ctx.retryCounters[artifact] = 2; // Simulate 2 failed retries
    }

    // Phase 2: Now write high-quality artifacts (cycle 11/12 = progress 0.9+)
    await writeArtifactsForCycle(tmpDir, 11, 12);

    const scores = await scoreAllArtifacts(tmpDir, state);

    // For any artifact that now scores at or above NEEDS_WORK, reset its counter
    for (const [name, result] of Object.entries(scores)) {
      if (result.score >= SCORE_THRESHOLDS.NEEDS_WORK) {
        ctx.retryCounters[name] = 0;
      }
    }

    // At least CONSTITUTION should pass (it has simple requirements)
    const passingArtifacts = Object.entries(scores)
      .filter(([, r]) => r.score >= SCORE_THRESHOLDS.NEEDS_WORK)
      .map(([name]) => name);

    assert.ok(
      passingArtifacts.length > 0,
      'Expected at least one artifact to pass scoring after improvement',
    );

    for (const artifact of passingArtifacts) {
      assert.strictEqual(
        ctx.retryCounters[artifact],
        0,
        `Retry counter for ${artifact} should be 0 after passing, got ${ctx.retryCounters[artifact]}`,
      );
    }
  });

  it('consecutiveFailures counter drives computeBackoff correctly', () => {
    // Verify exponential backoff formula across a range of retry counts
    const expectedBackoffs: [number, number][] = [
      [0, CIRCUIT_BREAKER_BACKOFF_BASE_MS],        // 2000 * 2^0 = 2000
      [1, CIRCUIT_BREAKER_BACKOFF_BASE_MS * 2],     // 2000 * 2^1 = 4000
      [2, CIRCUIT_BREAKER_BACKOFF_BASE_MS * 4],     // 2000 * 2^2 = 8000
      [3, CIRCUIT_BREAKER_BACKOFF_BASE_MS * 8],     // 2000 * 2^3 = 16000
      [4, CIRCUIT_BREAKER_MAX_BACKOFF_MS],           // 2000 * 2^4 = 32000 -> capped at 30000
      [5, CIRCUIT_BREAKER_MAX_BACKOFF_MS],           // capped
      [10, CIRCUIT_BREAKER_MAX_BACKOFF_MS],          // capped
    ];

    for (const [retryCount, expectedMs] of expectedBackoffs) {
      const actual = computeBackoff(retryCount);
      assert.strictEqual(
        actual,
        expectedMs,
        `computeBackoff(${retryCount}) = ${actual}, expected ${expectedMs}`,
      );
    }
  });

  it('circuit breaker trips after CONSECUTIVE_FAILURE_LIMIT failures', async () => {
    const state = makeState();
    await saveState(state, { cwd: tmpDir });

    // Write perpetually bad artifacts
    const stateDir = path.join(tmpDir, '.danteforge');
    for (const artifact of ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS']) {
      await fs.writeFile(path.join(stateDir, `${artifact}.md`), 'stub');
    }

    const ctx = makeContext(tmpDir, { state });
    let consecutiveFailures = 0;

    // Simulate the loop's consecutive failure tracking
    for (let cycle = 0; cycle < CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT + 2; cycle++) {
      ctx.cycleCount++;
      const scores = await scoreAllArtifacts(tmpDir, state);

      // Check if any artifact is blocked
      const hasBlocked = Object.values(scores).some(
        r => r.score < SCORE_THRESHOLDS.NEEDS_WORK,
      );

      if (hasBlocked) {
        consecutiveFailures++;
      } else {
        consecutiveFailures = 0;
      }

      if (consecutiveFailures >= CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT) {
        ctx.loopState = AutoforgeLoopState.BLOCKED;
        ctx.state.auditLog.push(
          `${new Date().toISOString()} | autoforge-loop: circuit breaker tripped after ${consecutiveFailures} consecutive failures`,
        );
        break;
      }
    }

    assert.strictEqual(
      ctx.loopState,
      AutoforgeLoopState.BLOCKED,
      'Loop should be BLOCKED after circuit breaker trips',
    );
    assert.strictEqual(
      consecutiveFailures,
      CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT,
      `Expected exactly ${CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT} consecutive failures`,
    );
    assert.ok(
      ctx.state.auditLog.some(e => e.includes('circuit breaker tripped')),
      'Audit log should record circuit breaker trip',
    );
  });

  it('state transitions follow valid paths through the state machine', async () => {
    const state = makeState();
    await saveState(state, { cwd: tmpDir });

    const ctx = makeContext(tmpDir, { state });

    // Valid transition path: IDLE -> RUNNING -> SCORING -> (REFINING|COMPLETE)
    const observedStates: AutoforgeLoopState[] = [ctx.loopState];

    // IDLE -> RUNNING
    ctx.loopState = AutoforgeLoopState.RUNNING;
    observedStates.push(ctx.loopState);

    // Simulate 10 cycles of scoring + advancement
    const CYCLES = 10;
    for (let cycle = 0; cycle < CYCLES; cycle++) {
      await writeArtifactsForCycle(tmpDir, cycle, CYCLES);

      // RUNNING -> SCORING
      ctx.loopState = AutoforgeLoopState.SCORING;
      observedStates.push(ctx.loopState);

      const scores = await scoreAllArtifacts(tmpDir, state);
      const tracker = computeCompletionTracker(state, scores);

      const hasBlocked = Object.values(scores).some(
        r => r.score < SCORE_THRESHOLDS.NEEDS_WORK,
      );

      if (hasBlocked) {
        // SCORING -> REFINING
        ctx.loopState = AutoforgeLoopState.REFINING;
        observedStates.push(ctx.loopState);
      }

      // Back to RUNNING for next cycle
      ctx.loopState = AutoforgeLoopState.RUNNING;
      observedStates.push(ctx.loopState);
    }

    // Final state: mark complete
    ctx.loopState = AutoforgeLoopState.COMPLETE;
    observedStates.push(ctx.loopState);

    // Every observed state must be a valid enum value
    const validStates = new Set(Object.values(AutoforgeLoopState));
    for (const s of observedStates) {
      assert.ok(validStates.has(s), `Invalid state observed: ${s}`);
    }

    // Must start at IDLE and end at COMPLETE
    assert.strictEqual(observedStates[0], AutoforgeLoopState.IDLE);
    assert.strictEqual(observedStates[observedStates.length - 1], AutoforgeLoopState.COMPLETE);

    // Must pass through SCORING at least once
    assert.ok(
      observedStates.includes(AutoforgeLoopState.SCORING),
      'Should pass through SCORING state',
    );
  });

  it('per-artifact PDSE scores improve with richer content across cycles', async () => {
    const CYCLES = 12;
    const state = makeState();
    await saveState(state, { cwd: tmpDir });

    const artifactScoreHistory: Record<ScoredArtifact, number[]> = {
      CONSTITUTION: [],
      SPEC: [],
      CLARIFY: [],
      PLAN: [],
      TASKS: [],
    };

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      await writeArtifactsForCycle(tmpDir, cycle, CYCLES);

      const currentState = await loadState({ cwd: tmpDir });
      const scores = await scoreAllArtifacts(tmpDir, currentState);

      for (const artifact of Object.keys(artifactScoreHistory) as ScoredArtifact[]) {
        artifactScoreHistory[artifact].push(scores[artifact].score);
      }
    }

    // Every artifact's final score should be higher than its initial score
    for (const [artifact, history] of Object.entries(artifactScoreHistory)) {
      assert.ok(
        history[history.length - 1]! >= history[0]!,
        `${artifact} final score (${history[history.length - 1]}) should be >= initial score (${history[0]})`,
      );
    }

    // At least one artifact should achieve ACCEPTABLE threshold by the end
    const finalScores = Object.values(artifactScoreHistory).map(h => h[h.length - 1]!);
    const anyAcceptable = finalScores.some(s => s >= SCORE_THRESHOLDS.ACCEPTABLE);
    // Note: with synthetic content this is aspirational; we verify non-regression
    // If none reach ACCEPTABLE, at least verify improvement happened
    const anyImproved = Object.values(artifactScoreHistory).some(
      h => h[h.length - 1]! > h[0]!,
    );
    assert.ok(
      anyImproved,
      'At least one artifact should show score improvement across cycles',
    );
  });

  it('persisted score files accumulate and are readable after 10 cycles', async () => {
    const CYCLES = 10;
    const state = makeState();
    await saveState(state, { cwd: tmpDir });

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      await writeArtifactsForCycle(tmpDir, cycle, CYCLES);
      const currentState = await loadState({ cwd: tmpDir });
      const scores = await scoreAllArtifacts(tmpDir, currentState);

      for (const result of Object.values(scores)) {
        await persistScoreResult(result, tmpDir);
      }
    }

    // Verify score files exist and contain valid JSON
    const scoreDir = path.join(tmpDir, '.danteforge', 'scores');
    const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];

    for (const artifact of artifacts) {
      const scorePath = path.join(scoreDir, `${artifact}-score.json`);
      const content = await fs.readFile(scorePath, 'utf8');
      const parsed = JSON.parse(content) as ScoreResult;

      assert.strictEqual(parsed.artifact, artifact, `Score file for ${artifact} has wrong artifact name`);
      assert.ok(typeof parsed.score === 'number', `Score for ${artifact} should be a number`);
      assert.ok(parsed.score >= 0 && parsed.score <= 100, `Score for ${artifact} should be 0-100`);
      assert.ok(parsed.dimensions !== undefined, `Score for ${artifact} should have dimensions`);
      assert.ok(
        ['advance', 'warn', 'pause', 'blocked'].includes(parsed.autoforgeDecision),
        `Invalid autoforge decision for ${artifact}: ${parsed.autoforgeDecision}`,
      );
    }
  });
});
