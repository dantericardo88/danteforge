import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildSessionContext, buildMatrixSection } from '../hooks/session-start.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMatrixState(overrides: Partial<{
  overallScore: number;
  daysOld: number | null;
  project: string;
  next: { label: string; gap_to_leader: number; harvest_source?: string; oss_leader?: string } | null;
}> = {}) {
  return {
    overallScore: 6.2,
    daysOld: 2,
    project: 'TestProject',
    next: {
      label: 'UX Polish & Onboarding',
      gap_to_leader: 4.7,
      harvest_source: 'Aider',
      oss_leader: 'Aider',
    },
    ...overrides,
  };
}

// ── buildMatrixSection tests ──────────────────────────────────────────────────

describe('buildMatrixSection', () => {
  it('returns empty string when matrixState is null', () => {
    const result = buildMatrixSection(null);
    assert.strictEqual(result, '');
  });

  it('surfaces next sprint dimension when matrix exists', () => {
    const result = buildMatrixSection(makeMatrixState());
    assert.ok(result.includes('UX Polish & Onboarding'), 'Should include dimension label');
    assert.ok(result.includes('4.7'), 'Should include gap size');
    assert.ok(result.includes('Aider'), 'Should include harvest source');
    assert.ok(result.includes('6.2'), 'Should include overall score');
  });

  it('shows stale warning when matrix >7 days old', () => {
    const result = buildMatrixSection(makeMatrixState({ daysOld: 10 }));
    assert.ok(result.includes('10d old'), 'Should show days old');
    assert.ok(result.includes('compete --init'), 'Should suggest reinit');
  });

  it('does not show stale warning when matrix is fresh', () => {
    const result = buildMatrixSection(makeMatrixState({ daysOld: 3 }));
    assert.ok(!result.includes('old'), 'Should not show stale warning for fresh matrix');
  });

  it('shows "all gaps closed" when next is null', () => {
    const result = buildMatrixSection(makeMatrixState({ next: null }));
    assert.ok(result.includes('All gaps closed'), 'Should indicate completion');
  });

  it('falls back to oss_leader when harvest_source is undefined', () => {
    const state = makeMatrixState({
      next: { label: 'Testing', gap_to_leader: 2.0, harvest_source: undefined, oss_leader: 'Continue.dev' },
    });
    const result = buildMatrixSection(state);
    assert.ok(result.includes('Continue.dev'), 'Should use oss_leader as fallback');
  });
});

// ── buildSessionContext tests ─────────────────────────────────────────────────

describe('buildSessionContext', () => {
  it('T1: with matrix, surfaces next sprint dimension in session context', () => {
    const result = buildSessionContext(null, makeMatrixState());
    assert.ok(result.includes('Competitive Position'), 'Should include matrix section header');
    assert.ok(result.includes('UX Polish & Onboarding'), 'Should include dimension label');
    assert.ok(result.includes('compete --sprint'), 'Should suggest sprint command');
  });

  it('T2: with stale matrix (>7 days), shows age warning in session context', () => {
    const result = buildSessionContext(null, makeMatrixState({ daysOld: 8 }));
    assert.ok(result.includes('8d old'), 'Should show staleness warning');
  });

  it('T3: with no matrix, no matrix section in output', () => {
    const result = buildSessionContext(null, null);
    assert.ok(!result.includes('Competitive Position'), 'Should not show matrix section');
    assert.ok(!result.includes('CHL Sprint'), 'Should not show sprint suggestion');
  });

  it('T4: with all dimensions closed, shows "all gaps closed" message', () => {
    const result = buildSessionContext(null, makeMatrixState({ next: null }));
    assert.ok(result.includes('All gaps closed'), 'Should show completion message');
  });

  it('matrix section appears before footer in forge stage', () => {
    const stateYaml = 'workflowStage: forge\ncurrentPhase: 1\nproject: MyApp\n';
    const result = buildSessionContext(stateYaml, makeMatrixState());
    const matrixIdx = result.indexOf('Competitive Position');
    const footerIdx = result.indexOf('Available Commands');
    assert.ok(matrixIdx > 0, 'Matrix section should be present');
    assert.ok(matrixIdx < footerIdx, 'Matrix section should appear before footer');
  });

  it('matrix section appears in non-forge stage context', () => {
    const stateYaml = 'workflowStage: specify\nproject: MyApp\n';
    const result = buildSessionContext(stateYaml, makeMatrixState());
    assert.ok(result.includes('Competitive Position'), 'Matrix section should appear in non-forge stage');
    assert.ok(result.includes('clarify'), 'Stage-based next action should also appear');
  });
});
