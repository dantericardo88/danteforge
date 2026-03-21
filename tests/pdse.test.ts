// PDSE Scoring Engine tests — all 6 dimensions, all 5 artifact types, decision thresholds
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  scoreArtifact,
  computeAutoforgeDecision,
  generateRemediationSuggestions,
  loadCachedScore,
  persistScoreResult,
  type ScoringContext,
  type ScoredArtifact,
} from '../src/core/pdse.js';
import type { DanteState } from '../src/core/state.js';

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-project',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    lastHandoff: 'none',
    profile: 'balanced',
    auditLog: [],
    ...overrides,
  };
}

function makeContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    artifactContent: '',
    artifactName: 'SPEC',
    stateYaml: makeState(),
    upstreamArtifacts: {},
    isWebProject: false,
    ...overrides,
  };
}

// Well-formed SPEC with all required sections, clear acceptance criteria, and constitution keywords
const WELL_FORMED_SPEC = `# Feature Specification

## Feature Name
User Authentication System

## What & Why
Implement secure user authentication with zero ambiguity in the requirements.

## User Stories
- As a user I must be able to log in with email and password
- As a user I must be able to reset my password

## Non-functional Requirements
- Response time must be under 200ms
- Local-first data storage with fail-closed behavior
- Audit trail for all authentication events
- Deterministic session handling with atomic commit support

## Acceptance Criteria
1. Login endpoint returns 200 with valid credentials and a session token
2. Login endpoint returns 401 with invalid credentials
3. Password reset sends email within 30 seconds
4. All operations verify before commit

## Testing Strategy
- Unit tests for auth service
- Integration tests for login flow
- E2E tests for password reset
`;

const AMBIGUOUS_SPEC = `# Feature Specification

## Feature Name
Some feature

Users should be able to do something.
They might need to log in maybe.
This could work with TBD integration.
We will probably figure out the details later.
The implementation should somehow handle etc. stuff.
`;

const SPEC_WITH_CEO_REVIEW = `${WELL_FORMED_SPEC}
## CEO Review Notes
This feature was elevated using the 10-star framework.
The original spec was good but the CEO review pushed for a higher bar.
`;

describe('scoreArtifact — SPEC.md', () => {
  it('scores a well-formed SPEC.md with all sections at >= 80', () => {
    const result = scoreArtifact(makeContext({
      artifactContent: WELL_FORMED_SPEC,
      artifactName: 'SPEC',
      upstreamArtifacts: { CONSTITUTION: 'zero ambiguity local-first verify' },
    }));
    assert.ok(result.score >= 80, `Expected >= 80, got ${result.score}`);
    assert.strictEqual(result.autoforgeDecision, 'advance');
  });

  it('scores a SPEC with ambiguity words at <= 60', () => {
    const result = scoreArtifact(makeContext({
      artifactContent: AMBIGUOUS_SPEC,
      artifactName: 'SPEC',
    }));
    assert.ok(result.score <= 60, `Expected <= 60, got ${result.score}`);
    assert.ok(
      result.autoforgeDecision === 'pause' || result.autoforgeDecision === 'blocked',
      `Expected pause or blocked, got ${result.autoforgeDecision}`,
    );
    assert.ok(result.issues.some(i => i.dimension === 'clarity'));
  });

  it('scores a SPEC with CEO Review Notes section with clarity bonus', () => {
    const withCEO = scoreArtifact(makeContext({
      artifactContent: SPEC_WITH_CEO_REVIEW,
      artifactName: 'SPEC',
      upstreamArtifacts: { CONSTITUTION: 'zero ambiguity local-first verify' },
    }));
    assert.strictEqual(withCEO.hasCEOReviewBonus, true);
  });

  it('detects missing required sections and reduces completeness', () => {
    const result = scoreArtifact(makeContext({
      artifactContent: '# My Spec\nSome content',
      artifactName: 'SPEC',
    }));
    assert.ok(result.dimensions.completeness <= 4, `Expected <= 4, got ${result.dimensions.completeness}`);
    assert.ok(result.issues.filter(i => i.dimension === 'completeness').length >= 3);
  });

  it('scores a completely empty artifact at < 10 and decision = blocked', () => {
    const result = scoreArtifact(makeContext({
      artifactContent: '',
      artifactName: 'SPEC',
    }));
    assert.ok(result.score < 10, `Expected < 10, got ${result.score}`);
    assert.strictEqual(result.autoforgeDecision, 'blocked');
  });

  it('produces remediation suggestions with specific runnable commands', () => {
    const result = scoreArtifact(makeContext({
      artifactContent: AMBIGUOUS_SPEC,
      artifactName: 'SPEC',
    }));
    assert.ok(result.remediationSuggestions.length > 0);
    assert.ok(result.remediationSuggestions.some(s => s.includes('danteforge')));
  });
});

describe('scoreArtifact — CONSTITUTION.md', () => {
  const WELL_FORMED_CONSTITUTION = `# Project Constitution

Prioritize zero ambiguity in all communications.
Adopt local-first architecture.
Use atomic commits for all changes.
Always verify before commit.
Enforce fail-closed behavior.
Maintain audit trail.
Ensure deterministic outcomes.
`;

  it('scores a constitution with all required principles at >= 70', () => {
    const result = scoreArtifact(makeContext({
      artifactContent: WELL_FORMED_CONSTITUTION,
      artifactName: 'CONSTITUTION',
    }));
    assert.ok(result.score >= 70, `Expected >= 70, got ${result.score}`);
  });

  it('scores a constitution missing fail-closed principle with lower constitutionAlignment', () => {
    const incomplete = '# Constitution\nBe nice and do stuff.';
    const result = scoreArtifact(makeContext({
      artifactContent: incomplete,
      artifactName: 'CONSTITUTION',
    }));
    assert.ok(result.dimensions.constitutionAlignment < 10);
  });

  it('gives integration fitness max when no upstream dependencies expected', () => {
    const result = scoreArtifact(makeContext({
      artifactContent: WELL_FORMED_CONSTITUTION,
      artifactName: 'CONSTITUTION',
    }));
    assert.strictEqual(result.dimensions.integrationFitness, 10);
  });

  it('gives freshness 10 when no deduction markers present', () => {
    const result = scoreArtifact(makeContext({
      artifactContent: WELL_FORMED_CONSTITUTION,
      artifactName: 'CONSTITUTION',
    }));
    assert.strictEqual(result.dimensions.freshness, 10);
  });

  it('reduces freshness when markers present', () => {
    const withMarkers = WELL_FORMED_CONSTITUTION + '\nWe need to figure out later the deployment.';
    const result = scoreArtifact(makeContext({
      artifactContent: withMarkers,
      artifactName: 'CONSTITUTION',
    }));
    assert.ok(result.dimensions.freshness < 10);
  });
});

describe('scoreArtifact — TASKS.md', () => {
  it('scores testability based on tasks with done-conditions', () => {
    const tasksContent = `# Tasks
### Phase 1
- Build auth service — verify: login endpoint returns 200
- Build user model — verify: user can be created and queried
- Setup database — no verify condition
- Build UI — assert: form renders correctly
`;
    const result = scoreArtifact(makeContext({
      artifactContent: tasksContent,
      artifactName: 'TASKS',
    }));
    // 3 out of 4 tasks have verify/assert keywords = 75% = 15/20
    assert.ok(result.dimensions.testability >= 14, `Expected >= 14, got ${result.dimensions.testability}`);
  });
});

describe('scoreArtifact — anti-stub enforcement', () => {
  it('floors clarity to 0 when anti-stub patterns are found', () => {
    const stubContent = `# SPEC
## Feature Name
Auth stub placeholder
## Acceptance Criteria
None yet
`;
    const result = scoreArtifact(makeContext({
      artifactContent: stubContent,
      artifactName: 'SPEC',
    }));
    assert.strictEqual(result.dimensions.clarity, 0);
    assert.ok(result.issues.some(i => i.message.includes('Anti-stub')));
  });
});

describe('computeAutoforgeDecision', () => {
  it('returns advance for score >= 90', () => {
    assert.strictEqual(computeAutoforgeDecision(90), 'advance');
    assert.strictEqual(computeAutoforgeDecision(95), 'advance');
    assert.strictEqual(computeAutoforgeDecision(100), 'advance');
  });

  it('returns warn for score 70–89', () => {
    assert.strictEqual(computeAutoforgeDecision(70), 'warn');
    assert.strictEqual(computeAutoforgeDecision(75), 'warn');
    assert.strictEqual(computeAutoforgeDecision(89), 'warn');
  });

  it('returns pause for score 50–69', () => {
    assert.strictEqual(computeAutoforgeDecision(50), 'pause');
    assert.strictEqual(computeAutoforgeDecision(60), 'pause');
    assert.strictEqual(computeAutoforgeDecision(69), 'pause');
  });

  it('returns blocked for score < 50', () => {
    assert.strictEqual(computeAutoforgeDecision(0), 'blocked');
    assert.strictEqual(computeAutoforgeDecision(25), 'blocked');
    assert.strictEqual(computeAutoforgeDecision(49), 'blocked');
  });

  it('handles exact boundary values correctly', () => {
    assert.strictEqual(computeAutoforgeDecision(90), 'advance');
    assert.strictEqual(computeAutoforgeDecision(70), 'warn');
    assert.strictEqual(computeAutoforgeDecision(50), 'pause');
  });
});

describe('generateRemediationSuggestions', () => {
  it('suggests commands for completeness issues', () => {
    const suggestions = generateRemediationSuggestions(
      [{ dimension: 'completeness', severity: 'error', message: 'Missing section' }],
      'SPEC',
    );
    assert.ok(suggestions.length > 0);
    assert.ok(suggestions.some(s => s.includes('danteforge')));
  });

  it('suggests anti-stub removal for clarity issues with stubs', () => {
    const suggestions = generateRemediationSuggestions(
      [{ dimension: 'clarity', severity: 'error', message: 'Anti-stub violation found' }],
      'PLAN',
    );
    assert.ok(suggestions.some(s => s.includes('stub') || s.includes('placeholder')));
  });

  it('returns at least one suggestion for any issue', () => {
    const suggestions = generateRemediationSuggestions(
      [{ dimension: 'freshness', severity: 'warning', message: 'Freshness marker found' }],
      'TASKS',
    );
    assert.ok(suggestions.length >= 1);
  });
});

// ─── PASS 3: Integration hardening ────────────────────────────────────────────

describe('PDSE — RegExp anti-stub patterns (integration hardening)', () => {
  it('floors clarity to 0 when content contains "as any" (RegExp pattern)', () => {
    const content = `# SPEC\n## Feature Name\nAuth\n## Acceptance Criteria\nconst value = data as any;\n`;
    const result = scoreArtifact(makeContext({ artifactContent: content, artifactName: 'SPEC' }));
    assert.strictEqual(result.dimensions.clarity, 0, 'as any should trigger anti-stub RegExp');
    assert.ok(result.issues.some(i => i.message.includes('Anti-stub')));
  });

  it('floors clarity to 0 when content contains @ts-ignore (RegExp pattern)', () => {
    const content = `# PLAN\n## Phase 1\nImplement auth\n// @ts-ignore\nconst x = getUser();\n`;
    const result = scoreArtifact(makeContext({ artifactContent: content, artifactName: 'PLAN' }));
    assert.strictEqual(result.dimensions.clarity, 0);
  });

  it('floors clarity to 0 when content contains @ts-expect-error (RegExp pattern)', () => {
    const content = `# TASKS\n- [ ] Task 1\n// @ts-expect-error\nconst y = broken();\n`;
    const result = scoreArtifact(makeContext({ artifactContent: content, artifactName: 'TASKS' }));
    assert.strictEqual(result.dimensions.clarity, 0);
  });

  it('does NOT floor clarity for clean content with no anti-stub patterns', () => {
    const content = `# SPEC\n## Feature Name\nLogin\n## Acceptance Criteria\n1. User logs in successfully\n`;
    const result = scoreArtifact(makeContext({ artifactContent: content, artifactName: 'SPEC' }));
    assert.ok(result.dimensions.clarity > 0, 'Clean content should not trigger anti-stub');
  });

  it('handles empty content without crashing (completeness = 0)', () => {
    const result = scoreArtifact(makeContext({ artifactContent: '', artifactName: 'SPEC' }));
    assert.ok(typeof result.score === 'number');
    assert.ok(result.score >= 0);
    // Empty content: no checklist sections found
    assert.strictEqual(result.dimensions.completeness, 0);
  });

  it('handles content with only whitespace (treated as empty)', () => {
    const result = scoreArtifact(makeContext({ artifactContent: '   \n  \t  \n', artifactName: 'PLAN' }));
    assert.ok(typeof result.score === 'number');
    assert.ok(result.score >= 0);
  });

  it('web project evidence bonus applies when isWebProject + evidenceDir are set', () => {
    const baseResult = scoreArtifact(makeContext({
      artifactContent: WELL_FORMED_SPEC,
      artifactName: 'SPEC',
      isWebProject: false,
    }));
    const webResult = scoreArtifact(makeContext({
      artifactContent: WELL_FORMED_SPEC,
      artifactName: 'SPEC',
      isWebProject: true,
      evidenceDir: '/some/evidence/dir',
    }));
    // Web project should have equal or higher testability
    assert.ok(
      webResult.dimensions.testability >= baseResult.dimensions.testability,
      `Web project testability ${webResult.dimensions.testability} should be >= ${baseResult.dimensions.testability}`,
    );
  });
});

describe('loadCachedScore + persistScoreResult (integration hardening)', () => {
  it('loadCachedScore returns null for a non-existent artifact', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-pdse-cache-'));
    const result = await loadCachedScore('SPEC', tmpDir);
    assert.strictEqual(result, null);
    await fs.rm(tmpDir, { recursive: true });
  });

  it('persistScoreResult writes file and loadCachedScore reads it back', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-pdse-persist-'));
    const scoreResult = scoreArtifact(makeContext({
      artifactContent: WELL_FORMED_SPEC,
      artifactName: 'SPEC',
    }));

    const savedPath = await persistScoreResult(scoreResult, tmpDir);
    assert.ok(typeof savedPath === 'string' && savedPath.length > 0);

    const loaded = await loadCachedScore('SPEC', tmpDir);
    assert.ok(loaded !== null, 'should load the persisted score');
    assert.strictEqual(loaded!.score, scoreResult.score);
    assert.strictEqual(loaded!.artifact, 'SPEC');

    await fs.rm(tmpDir, { recursive: true });
  });

  it('persistScoreResult uses atomic tmp→rename pattern (no partial writes)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-pdse-atomic-'));
    const scoreResult = scoreArtifact(makeContext({ artifactContent: '# TEST', artifactName: 'PLAN' }));

    await persistScoreResult(scoreResult, tmpDir);

    const scoreDir = path.join(tmpDir, '.danteforge', 'scores');
    const files = await fs.readdir(scoreDir);
    // Only the final file should exist — no .tmp files left over
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    assert.strictEqual(tmpFiles.length, 0, 'No .tmp files should remain after persist');
    assert.ok(files.some(f => f === 'PLAN-score.json'));

    await fs.rm(tmpDir, { recursive: true });
  });
});
