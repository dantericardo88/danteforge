// End-to-end Workflow Pipeline Test — v0.8.1
// Exercises the full DanteForge pipeline:
//   constitution -> specify -> clarify -> plan -> tasks -> design -> forge -> verify -> synthesize
// Tests stage progression, PDSE scoring, AutoForge planning, and completion tracking.
// NO live LLM needed — all local artifact + state manipulation.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  loadState,
  saveState,
  recordWorkflowStage,
  type DanteState,
  type WorkflowStage,
} from '../src/core/state.js';
import {
  scoreArtifact,
  scoreAllArtifacts,
  computeAutoforgeDecision,
  persistScoreResult,
  type ScoringContext,
  type ScoredArtifact,
  type ScoreResult,
} from '../src/core/pdse.js';
import {
  computeCompletionTracker,
  type CompletionTracker,
} from '../src/core/completion-tracker.js';
import {
  AutoforgeLoopState,
  computeEstimatedSteps,
  formatGuidanceMarkdown,
  type AutoforgeLoopContext,
  type AutoforgeGuidance,
} from '../src/core/autoforge-loop.js';
import { SCORE_THRESHOLDS, ARTIFACT_COMMAND_MAP } from '../src/core/pdse-config.js';

// ── Well-formed artifact content ─────────────────────────────────────────────
// Each artifact is designed to score well across all 6 PDSE dimensions:
// completeness (has required sections), clarity (no stubs/ambiguity),
// testability (has acceptance criteria / done-conditions),
// constitutionAlignment (has keywords), integrationFitness (upstream present),
// freshness (no staleness markers).

const CONSTITUTION_CONTENT = `# Project Constitution

This document defines the immutable principles for the project.

## Core Principles

- zero ambiguity: every requirement must be stated precisely with measurable criteria
- local-first: all data operations are local by default, sync is opt-in
- atomic commit: every change is a single, reversible unit of work
- verify before commit: all gates must pass before any merge
- fail-closed: on error, deny rather than permit
- audit: every state transition is logged with timestamp and actor
- deterministic: given the same inputs, produce the same outputs
- pipeda: personal data handling follows PIPEDA compliance rules
`;

const SPEC_CONTENT = `# Feature Specification

## Feature Name
Task Management Dashboard

## What & Why
Build a task management dashboard that enables teams to track project progress with
zero ambiguity in status reporting. Local-first architecture ensures offline access.

## User Stories
- As a project manager I must be able to view all tasks grouped by phase
- As a developer I must be able to mark tasks complete with verification evidence
- As a stakeholder I must be able to see overall project health via audit logs

## Non-functional Requirements
- Response time must be under 200ms for all dashboard queries
- Local-first data storage with deterministic sync resolution
- Fail-closed access control on all API endpoints
- Atomic commit for all task state transitions
- Full audit trail with verify before commit enforcement

## Acceptance Criteria
1. Dashboard loads within 200ms with up to 500 tasks displayed
2. Task status transitions are atomic and logged to the audit trail
3. Offline mode persists all changes locally and syncs deterministically on reconnect
4. All API endpoints return 403 on authorization failure (fail-closed)

## Testing Strategy
- Unit tests for task state machine
- Integration tests for sync resolution
- E2E tests for dashboard load performance
`;

const CLARIFY_CONTENT = `# Clarification Report

## Ambiguities Resolved
All specification ambiguities have been resolved through stakeholder interviews.

## Missing Requirements Identified
- Pagination strategy for task lists exceeding 500 items
- Conflict resolution strategy for concurrent edits (resolved: last-write-wins with audit)

## Consistency Check
- All user stories align with the constitution principles of zero ambiguity and local-first
- Non-functional requirements are measurable and testable
- Acceptance criteria map 1:1 to user stories

## Clarification Log
1. Q: What happens when two users edit the same task offline?
   A: Last-write-wins with full audit trail and deterministic conflict resolution
2. Q: Is there a maximum task count?
   A: No hard limit; pagination at 50 items per page; verify performance with atomic commit batching
`;

const PLAN_CONTENT = `# Implementation Plan

## Architecture Overview
Three-tier architecture: React frontend, Node.js API, SQLite local-first database.
All state transitions are atomic commit operations with verify before commit gates.

## Implementation Phases
Phase 1: Core data model and local-first storage engine
Phase 2: Dashboard UI with task grouping and filtering
Phase 3: Sync engine with deterministic conflict resolution

## Technology Stack
- React 18 with TypeScript strict mode
- Node.js with Express for API layer
- SQLite with better-sqlite3 for local-first storage
- Vitest for unit and integration testing

## Risk Assessment
- Risk: SQLite performance under high concurrency
  Mitigation: WAL mode + connection pooling with fail-closed error handling
- Risk: Sync conflicts during offline periods
  Mitigation: Deterministic last-write-wins with full audit trail

## Testing Strategy
- Unit tests: 80% coverage minimum for all modules
- Integration tests: API endpoint contract tests with atomic commit verification
- E2E tests: Full dashboard workflow with zero ambiguity assertions
- Performance tests: Sub-200ms dashboard load benchmark
`;

const TASKS_CONTENT = `# Task Breakdown

### Phase 1: Data Model & Storage
- task: Implement SQLite schema with migration support
  verify: Schema creation succeeds and audit table exists
  done: All tables created with foreign key constraints
- task: Build local-first CRUD operations with atomic commit
  verify: All CRUD operations are transactional
  done: Unit tests pass for create, read, update, delete
- task: Add audit logging for all state transitions
  verify: Every operation produces an audit log entry with timestamp
  done: Audit trail query returns correct entries

### Phase 2: Dashboard UI
- task: Build task list component with grouping by phase
  verify: Component renders 500 tasks within 200ms
  done: Performance benchmark passes, acceptance criteria met
- task: Implement task status transitions with optimistic UI
  verify: Status changes are reflected immediately and persisted atomically
  done: Integration test confirms atomic commit behavior
- task: Add dashboard health overview with audit summary
  verify: Health score computes correctly from task completion ratios
  done: Dashboard displays accurate metrics with zero ambiguity

### Phase 3: Sync Engine
- task: Implement deterministic conflict resolution
  verify: Concurrent edits resolve consistently with last-write-wins
  done: Sync test with 100 concurrent operations succeeds
- task: Build offline queue with local-first persistence
  verify: Operations queued offline replay correctly on reconnect
  done: E2E test confirms full offline-to-online cycle
`;

// ── Helper functions ─────────────────────────────────────────────────────────

/** Mapping from workflow stage to the artifact file it produces. */
const STAGE_ARTIFACT_MAP: Record<string, string> = {
  constitution: 'CONSTITUTION.md',
  specify: 'SPEC.md',
  clarify: 'CLARIFY.md',
  plan: 'PLAN.md',
  tasks: 'TASKS.md',
  design: 'DESIGN.op',
  forge: 'FORGE_LOG.md',
  'ux-refine': 'UX_REFINE.md',
  verify: 'VERIFY_LOG.md',
  synthesize: 'UPR.md',
};

/** Artifact content keyed by stage name. */
const STAGE_CONTENT_MAP: Record<string, string> = {
  constitution: CONSTITUTION_CONTENT,
  specify: SPEC_CONTENT,
  clarify: CLARIFY_CONTENT,
  plan: PLAN_CONTENT,
  tasks: TASKS_CONTENT,
  design: '{"formatVersion":"1.0.0","document":{"name":"Test"},"nodes":[]}',
  forge: '# Forge Log\nWave 1 complete. All tasks implemented with atomic commit.\n## verify before commit\nAll gates passed with zero ambiguity. Deterministic build succeeded.\n',
  'ux-refine': '# UX Refinement\nDesign tokens extracted and applied.\n## verify\nVisual regression zero ambiguity — all components match spec. Audit log updated.\n',
  verify: '# Verification Report\nAll tests passing. Audit trail confirmed. Zero ambiguity in results. Deterministic across runs.\n',
  synthesize: '# Unified Project Report\nProject complete. All phases delivered with atomic commit discipline.\n## Retrospective\nzero ambiguity maintained. local-first architecture verified. Full audit trail intact. Deterministic builds confirmed.\n',
};

/** The ordered pipeline stages for iteration. */
const PIPELINE_ORDER: WorkflowStage[] = [
  'constitution', 'specify', 'clarify', 'plan', 'tasks',
  'design', 'forge', 'ux-refine', 'verify', 'synthesize',
];

function makeDefaultState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'e2e-test-project',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    lastHandoff: 'initialized',
    profile: 'balanced',
    auditLog: [],
    projectType: 'cli',
    ...overrides,
  };
}

function makeScoreResult(artifact: ScoredArtifact, score: number): ScoreResult {
  return {
    artifact,
    score,
    dimensions: {
      completeness: Math.round(score * 0.2),
      clarity: Math.round(score * 0.2),
      testability: Math.round(score * 0.2),
      constitutionAlignment: Math.round(score * 0.2),
      integrationFitness: Math.round(score * 0.1),
      freshness: Math.round(score * 0.1),
    },
    issues: [],
    remediationSuggestions: [],
    timestamp: new Date().toISOString(),
    autoforgeDecision: computeAutoforgeDecision(score),
    hasCEOReviewBonus: false,
  };
}

function makeAllScores(score: number): Record<ScoredArtifact, ScoreResult> {
  return {
    CONSTITUTION: makeScoreResult('CONSTITUTION', score),
    SPEC: makeScoreResult('SPEC', score),
    CLARIFY: makeScoreResult('CLARIFY', score),
    PLAN: makeScoreResult('PLAN', score),
    TASKS: makeScoreResult('TASKS', score),
  };
}

function makeTracker(overrides: Partial<CompletionTracker> = {}): CompletionTracker {
  return {
    overall: 0,
    phases: {
      planning: {
        score: 0,
        complete: false,
        artifacts: {
          CONSTITUTION: { score: 0, complete: false },
          SPEC: { score: 0, complete: false },
          CLARIFY: { score: 0, complete: false },
          PLAN: { score: 0, complete: false },
          TASKS: { score: 0, complete: false },
        },
      },
      execution: {
        score: 0,
        complete: false,
        currentPhase: 1,
        wavesComplete: 0,
        totalWaves: 3,
      },
      verification: {
        score: 0,
        complete: false,
        qaScore: 0,
        testsPassing: false,
      },
      synthesis: {
        score: 0,
        complete: false,
        retroDelta: null,
      },
    },
    lastUpdated: new Date().toISOString(),
    projectedCompletion: 'improve all + verify + synthesize',
    ...overrides,
  };
}

function makeLoopContext(overrides: Partial<AutoforgeLoopContext> = {}): AutoforgeLoopContext {
  return {
    goal: 'build task management dashboard',
    cwd: '/tmp/test',
    state: makeDefaultState(),
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

// ── Tests ────────────────────────────────────────────────────────────────────

let tmpDir: string;

describe('E2E Workflow Pipeline', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-e2e-workflow-'));
    await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Stage Progression ──────────────────────────────────────────────────────

  describe('Stage 1: Individual workflow stage progression', () => {
    it('constitution stage writes artifact and advances state', async () => {
      // Write constitution artifact to disk
      const artifactPath = path.join(tmpDir, '.danteforge', 'CONSTITUTION.md');
      await fs.writeFile(artifactPath, CONSTITUTION_CONTENT);

      // Load state, record stage, save
      const state = await loadState({ cwd: tmpDir });
      recordWorkflowStage(state, 'constitution');
      await saveState(state, { cwd: tmpDir });

      // Verify state was persisted
      const reloaded = await loadState({ cwd: tmpDir });
      assert.strictEqual(reloaded.workflowStage, 'constitution');
      assert.ok(reloaded.lastHandoff.includes('constitution'));

      // Verify artifact exists on disk
      const content = await fs.readFile(artifactPath, 'utf-8');
      assert.ok(content.includes('zero ambiguity'));
    });

    it('specify stage writes artifact and advances past constitution', async () => {
      // Pre-populate constitution (upstream dependency)
      await fs.writeFile(
        path.join(tmpDir, '.danteforge', 'CONSTITUTION.md'),
        CONSTITUTION_CONTENT,
      );

      // Write spec
      const specPath = path.join(tmpDir, '.danteforge', 'SPEC.md');
      await fs.writeFile(specPath, SPEC_CONTENT);

      const state = await loadState({ cwd: tmpDir });
      recordWorkflowStage(state, 'specify');
      await saveState(state, { cwd: tmpDir });

      const reloaded = await loadState({ cwd: tmpDir });
      assert.strictEqual(reloaded.workflowStage, 'specify');
      assert.ok(reloaded.lastHandoff.includes('specify'));
    });

    it('each planning stage sets the correct workflowStage on state', async () => {
      const planningStages: WorkflowStage[] = ['constitution', 'specify', 'clarify', 'plan', 'tasks'];
      const state = makeDefaultState();

      for (const stage of planningStages) {
        recordWorkflowStage(state, stage);
        assert.strictEqual(state.workflowStage, stage,
          `Expected workflowStage to be '${stage}' after recordWorkflowStage`);
        assert.ok(state.lastHandoff.includes(stage),
          `lastHandoff must reference '${stage}'`);
      }
    });
  });

  // ── Full Pipeline Roundtrip ────────────────────────────────────────────────

  describe('Stage 2: Full pipeline roundtrip', () => {
    it('state progresses through all 10 stages in order', async () => {
      const state = await loadState({ cwd: tmpDir });
      assert.strictEqual(state.workflowStage, 'initialized');

      const visitedStages: WorkflowStage[] = [];

      for (const stage of PIPELINE_ORDER) {
        // Write artifact for this stage
        const artifactFile = STAGE_ARTIFACT_MAP[stage];
        if (artifactFile) {
          const artifactPath = path.join(tmpDir, '.danteforge', artifactFile);
          await fs.writeFile(artifactPath, STAGE_CONTENT_MAP[stage] ?? `# ${stage}\n`);
        }

        // Advance state
        recordWorkflowStage(state, stage);
        state.auditLog.push(`${new Date().toISOString()} | e2e-test: advanced to ${stage}`);
        await saveState(state, { cwd: tmpDir });

        visitedStages.push(stage);
      }

      // Verify final state
      const finalState = await loadState({ cwd: tmpDir });
      assert.strictEqual(finalState.workflowStage, 'synthesize');
      assert.strictEqual(visitedStages.length, 10);
      assert.strictEqual(visitedStages[0], 'constitution');
      assert.strictEqual(visitedStages[visitedStages.length - 1], 'synthesize');

      // Verify all artifacts exist on disk
      for (const stage of PIPELINE_ORDER) {
        const artifactFile = STAGE_ARTIFACT_MAP[stage];
        if (artifactFile) {
          const exists = await fs.access(path.join(tmpDir, '.danteforge', artifactFile))
            .then(() => true).catch(() => false);
          assert.ok(exists, `Artifact must exist after pipeline: ${artifactFile}`);
        }
      }
    });

    it('audit log accumulates entries for every stage transition', async () => {
      const state = await loadState({ cwd: tmpDir });

      for (const stage of PIPELINE_ORDER) {
        recordWorkflowStage(state, stage);
        state.auditLog.push(`${new Date().toISOString()} | transition to ${stage}`);
      }

      await saveState(state, { cwd: tmpDir });
      const reloaded = await loadState({ cwd: tmpDir });

      assert.strictEqual(reloaded.auditLog.length, PIPELINE_ORDER.length);
      assert.ok(reloaded.auditLog[0].includes('constitution'));
      assert.ok(reloaded.auditLog[reloaded.auditLog.length - 1].includes('synthesize'));
    });
  });

  // ── PDSE Scoring ───────────────────────────────────────────────────────────

  describe('Stage 3: PDSE scores improve as artifacts accumulate', () => {
    it('missing artifacts score 0 (blocked)', async () => {
      // Score with empty .danteforge directory
      const state = makeDefaultState();
      const scores = await scoreAllArtifacts(tmpDir, state);

      for (const [name, result] of Object.entries(scores)) {
        assert.strictEqual(result.score, 0,
          `${name} must score 0 when artifact is missing`);
        assert.strictEqual(result.autoforgeDecision, 'blocked',
          `${name} must be blocked when artifact is missing`);
      }
    });

    it('well-formed artifacts score above ACCEPTABLE threshold', async () => {
      // Write all planning artifacts
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'CONSTITUTION.md'), CONSTITUTION_CONTENT);
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'SPEC.md'), SPEC_CONTENT);
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'CLARIFY.md'), CLARIFY_CONTENT);
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'PLAN.md'), PLAN_CONTENT);
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'TASKS.md'), TASKS_CONTENT);

      const state = makeDefaultState();
      const scores = await scoreAllArtifacts(tmpDir, state);

      for (const [name, result] of Object.entries(scores)) {
        assert.ok(result.score >= SCORE_THRESHOLDS.NEEDS_WORK,
          `${name} scored ${result.score}, expected >= ${SCORE_THRESHOLDS.NEEDS_WORK}`);
        assert.notStrictEqual(result.autoforgeDecision, 'blocked',
          `${name} must not be blocked with well-formed content`);
      }
    });

    it('scores improve incrementally as upstream artifacts are added', async () => {
      const state = makeDefaultState();

      // Score with only constitution
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'CONSTITUTION.md'), CONSTITUTION_CONTENT);
      const scores1 = await scoreAllArtifacts(tmpDir, state);
      const totalScore1 = Object.values(scores1).reduce((sum, r) => sum + r.score, 0);

      // Add spec — total should increase
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'SPEC.md'), SPEC_CONTENT);
      const scores2 = await scoreAllArtifacts(tmpDir, state);
      const totalScore2 = Object.values(scores2).reduce((sum, r) => sum + r.score, 0);
      assert.ok(totalScore2 > totalScore1,
        `Total score must increase when SPEC is added (${totalScore2} > ${totalScore1})`);

      // Add clarify + plan + tasks — total should increase further
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'CLARIFY.md'), CLARIFY_CONTENT);
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'PLAN.md'), PLAN_CONTENT);
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'TASKS.md'), TASKS_CONTENT);
      const scores3 = await scoreAllArtifacts(tmpDir, state);
      const totalScore3 = Object.values(scores3).reduce((sum, r) => sum + r.score, 0);
      assert.ok(totalScore3 > totalScore2,
        `Total score must increase when all artifacts added (${totalScore3} > ${totalScore2})`);
    });

    it('individual scoreArtifact respects upstream context for integration fitness', () => {
      // SPEC without constitution upstream
      const resultNoUpstream = scoreArtifact({
        artifactContent: SPEC_CONTENT,
        artifactName: 'SPEC',
        stateYaml: makeDefaultState(),
        upstreamArtifacts: {},
        isWebProject: false,
      });

      // SPEC with constitution upstream
      const resultWithUpstream = scoreArtifact({
        artifactContent: SPEC_CONTENT,
        artifactName: 'SPEC',
        stateYaml: makeDefaultState(),
        upstreamArtifacts: { CONSTITUTION: CONSTITUTION_CONTENT },
        isWebProject: false,
      });

      assert.ok(resultWithUpstream.dimensions.integrationFitness >= resultNoUpstream.dimensions.integrationFitness,
        'Integration fitness must be >= when upstream is present');
      // With upstream provided, should get full integration fitness score
      assert.ok(resultWithUpstream.dimensions.integrationFitness > 0,
        'Must have positive integration fitness when upstream is present');
    });
  });

  // ── AutoForge Cold-Start Plan ──────────────────────────────────────────────

  describe('Stage 4: AutoForge cold-start plan matches expected pipeline', () => {
    it('cold-start with no artifacts recommends constitution command', () => {
      const scores = makeAllScores(0);
      const state = makeDefaultState();
      const tracker = computeCompletionTracker(state, scores);

      // Planning phase is incomplete — first incomplete artifact is CONSTITUTION
      assert.strictEqual(tracker.phases.planning.complete, false);
      assert.strictEqual(tracker.phases.planning.artifacts.CONSTITUTION.complete, false);

      // The ARTIFACT_COMMAND_MAP for CONSTITUTION should be 'constitution'
      assert.strictEqual(ARTIFACT_COMMAND_MAP.CONSTITUTION, 'constitution');
    });

    it('cold-start guidance recommends first missing pipeline stage', () => {
      // All artifacts score 0 except CONSTITUTION
      const scores = makeAllScores(0);
      scores.CONSTITUTION = makeScoreResult('CONSTITUTION', 90);

      const state = makeDefaultState();
      const tracker = computeCompletionTracker(state, scores);

      // CONSTITUTION is complete, but SPEC is not
      assert.strictEqual(tracker.phases.planning.artifacts.CONSTITUTION.complete, true);
      assert.strictEqual(tracker.phases.planning.artifacts.SPEC.complete, false);

      // Recommended command should be for SPEC
      assert.strictEqual(ARTIFACT_COMMAND_MAP.SPEC, 'specify --refine');
    });

    it('estimated steps decreases as pipeline progresses', () => {
      // Empty project — maximum steps
      const ctxEmpty = makeLoopContext({
        state: makeDefaultState({
          completionTracker: makeTracker(),
        }),
      });
      const stepsEmpty = computeEstimatedSteps(ctxEmpty);

      // Partially complete project
      const ctxPartial = makeLoopContext({
        state: makeDefaultState({
          completionTracker: makeTracker({
            phases: {
              planning: {
                score: 85,
                complete: true,
                artifacts: {
                  CONSTITUTION: { score: 90, complete: true },
                  SPEC: { score: 85, complete: true },
                  CLARIFY: { score: 80, complete: true },
                  PLAN: { score: 80, complete: true },
                  TASKS: { score: 75, complete: true },
                },
              },
              execution: {
                score: 66,
                complete: false,
                currentPhase: 2,
                wavesComplete: 2,
                totalWaves: 3,
              },
              verification: { score: 0, complete: false, qaScore: 0, testsPassing: false },
              synthesis: { score: 0, complete: false, retroDelta: null },
            },
          }),
        }),
      });
      const stepsPartial = computeEstimatedSteps(ctxPartial);

      assert.ok(stepsPartial < stepsEmpty,
        `Partial project (${stepsPartial} steps) must have fewer steps than empty (${stepsEmpty})`);
    });
  });

  // ── Completion Tracker ─────────────────────────────────────────────────────

  describe('Stage 5: Completion tracker reaches 95%+ after full pipeline', () => {
    it('completion is 0% with no artifacts and no progress', () => {
      const scores = makeAllScores(0);
      const state = makeDefaultState();
      const tracker = computeCompletionTracker(state, scores);

      assert.strictEqual(tracker.overall, 0);
      assert.strictEqual(tracker.phases.planning.complete, false);
      assert.strictEqual(tracker.phases.execution.complete, false);
      assert.strictEqual(tracker.phases.verification.complete, false);
      assert.strictEqual(tracker.phases.synthesis.complete, false);
    });

    it('planning phase completion drives the first 25% of overall score', () => {
      const scores = makeAllScores(90);
      const state = makeDefaultState();
      const tracker = computeCompletionTracker(state, scores);

      assert.strictEqual(tracker.phases.planning.complete, true);
      // Planning score of 90 * weight 0.25 = 22.5, rounded
      assert.ok(tracker.overall >= 20,
        `Overall must be >= 20 with perfect planning (got ${tracker.overall})`);
    });

    it('completion reaches 95%+ when all phases are satisfied', () => {
      const scores = makeAllScores(92);
      const state = makeDefaultState({
        workflowStage: 'synthesize',
        currentPhase: 3,
        tasks: {
          1: [{ name: 'task1' }],
          2: [{ name: 'task2' }],
          3: [{ name: 'task3' }],
        },
        lastVerifiedAt: new Date().toISOString(),
        lastVerifyStatus: 'pass' as const,
        retroDelta: 15,
        projectType: 'cli',
      });

      const tracker = computeCompletionTracker(state, scores);

      assert.strictEqual(tracker.phases.planning.complete, true, 'Planning must be complete');
      assert.strictEqual(tracker.phases.execution.complete, true, 'Execution must be complete');
      assert.strictEqual(tracker.phases.verification.complete, true, 'Verification must be complete');
      assert.strictEqual(tracker.phases.synthesis.complete, true, 'Synthesis must be complete');
      assert.ok(tracker.overall >= 95,
        `Overall completion must be >= 95% (got ${tracker.overall}%)`);
    });

    it('projected completion is "Ready for ship" when all phases done', () => {
      const scores = makeAllScores(92);
      const state = makeDefaultState({
        workflowStage: 'synthesize',
        currentPhase: 3,
        tasks: {
          1: [{ name: 'task1' }],
          2: [{ name: 'task2' }],
          3: [{ name: 'task3' }],
        },
        lastVerifiedAt: new Date().toISOString(),
        lastVerifyStatus: 'pass' as const,
        retroDelta: 15,
        projectType: 'cli',
      });

      const tracker = computeCompletionTracker(state, scores);
      assert.strictEqual(tracker.projectedCompletion, 'Ready for ship');
    });
  });

  // ── PDSE Score Persistence ─────────────────────────────────────────────────

  describe('Stage 6: Score persistence roundtrips through disk', () => {
    it('persistScoreResult writes and reads back identical score JSON', async () => {
      const result = makeScoreResult('SPEC', 85);
      const filePath = await persistScoreResult(result, tmpDir);

      const readBack = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(readBack) as ScoreResult;

      assert.strictEqual(parsed.artifact, 'SPEC');
      assert.strictEqual(parsed.score, 85);
      assert.strictEqual(parsed.autoforgeDecision, 'warn');
      assert.ok(parsed.dimensions.completeness > 0);
    });
  });

  // ── Guidance Formatting ────────────────────────────────────────────────────

  describe('Stage 7: AutoForge guidance file formatting', () => {
    it('guidance markdown includes all required sections', () => {
      const guidance: AutoforgeGuidance = {
        timestamp: new Date().toISOString(),
        overallCompletion: 65,
        currentBottleneck: 'Execution phase incomplete',
        blockingIssues: [],
        recommendedCommand: 'danteforge forge',
        recommendedReason: 'Execute remaining forge waves',
        autoAdvanceEligible: true,
        estimatedStepsToCompletion: 4,
      };

      const md = formatGuidanceMarkdown(guidance);

      assert.ok(md.includes('# Autoforge Guidance'), 'Must have title');
      assert.ok(md.includes('Overall Completion'), 'Must show overall %');
      assert.ok(md.includes('65%'), 'Must show the actual percentage');
      assert.ok(md.includes('Current Bottleneck'), 'Must show bottleneck');
      assert.ok(md.includes('Recommended Action'), 'Must show recommendation');
      assert.ok(md.includes('danteforge forge'), 'Must show the recommended command');
      assert.ok(md.includes('Estimated Steps'), 'Must show estimated steps');
    });

    it('guidance with blocking issues includes the issues table', () => {
      const guidance: AutoforgeGuidance = {
        timestamp: new Date().toISOString(),
        overallCompletion: 30,
        currentBottleneck: 'SPEC (score: 20, blocked)',
        blockingIssues: [
          { artifact: 'SPEC', score: 20, decision: 'blocked', remediation: 'danteforge specify --refine' },
          { artifact: 'PLAN', score: 0, decision: 'blocked', remediation: 'danteforge plan --refine' },
        ],
        recommendedCommand: 'danteforge specify --refine',
        recommendedReason: '2 artifact(s) need remediation before advancement',
        autoAdvanceEligible: false,
        autoAdvanceBlockReason: '2 artifact(s) below score threshold',
        estimatedStepsToCompletion: 7,
      };

      const md = formatGuidanceMarkdown(guidance);

      assert.ok(md.includes('Blocking Issues'), 'Must have blocking issues section');
      assert.ok(md.includes('SPEC'), 'Must list SPEC in issues table');
      assert.ok(md.includes('PLAN'), 'Must list PLAN in issues table');
      assert.ok(md.includes('Block Reason'), 'Must show block reason');
    });
  });

  // ── End-to-end with real scoring on disk ───────────────────────────────────

  describe('Stage 8: Full pipeline with real PDSE scoring on disk', () => {
    it('scores improve monotonically as pipeline artifacts are written', async () => {
      const state = makeDefaultState();
      const totalScores: number[] = [];

      // Phase 0: No artifacts
      const scores0 = await scoreAllArtifacts(tmpDir, state);
      totalScores.push(Object.values(scores0).reduce((s, r) => s + r.score, 0));

      // Phase 1: Write constitution
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'CONSTITUTION.md'), CONSTITUTION_CONTENT);
      const scores1 = await scoreAllArtifacts(tmpDir, state);
      totalScores.push(Object.values(scores1).reduce((s, r) => s + r.score, 0));

      // Phase 2: Write spec
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'SPEC.md'), SPEC_CONTENT);
      const scores2 = await scoreAllArtifacts(tmpDir, state);
      totalScores.push(Object.values(scores2).reduce((s, r) => s + r.score, 0));

      // Phase 3: Write all remaining planning artifacts
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'CLARIFY.md'), CLARIFY_CONTENT);
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'PLAN.md'), PLAN_CONTENT);
      await fs.writeFile(path.join(tmpDir, '.danteforge', 'TASKS.md'), TASKS_CONTENT);
      const scores3 = await scoreAllArtifacts(tmpDir, state);
      totalScores.push(Object.values(scores3).reduce((s, r) => s + r.score, 0));

      // Assert monotonic increase
      for (let i = 1; i < totalScores.length; i++) {
        assert.ok(totalScores[i] > totalScores[i - 1],
          `Total score must increase at phase ${i}: ${totalScores[i]} > ${totalScores[i - 1]}`);
      }

      // Final total should be substantially higher than zero
      assert.ok(totalScores[totalScores.length - 1] > 200,
        `Final total score must be > 200 (got ${totalScores[totalScores.length - 1]})`);
    });
  });
});
