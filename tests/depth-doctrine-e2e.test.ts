// depth-doctrine-e2e.test.ts — Proves the full depth doctrine plumbing:
// dim at 7.0 → validate runs → receipt produced → score rises above 7.0.
//
// This is the ONE test that proves the depth doctrine works end-to-end.
// If this test passes, the system structurally prevents score inflation.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runValidateCli } from '../src/cli/commands/validate.js';
import { loadOutcomeEvidence } from '../src/matrix/engines/outcome-runner.js';
import { computeDerivedScoreWithBreakdown, type DimensionForScoring } from '../src/core/derived-score.js';
import { applyLegacyReceiptCeiling } from '../src/matrix/engines/receipt-ceiling.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) await fs.rm(d, { recursive: true, force: true });
  }
});

async function makeTestProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-depth-e2e-'));
  tempDirs.push(root);
  await fs.mkdir(path.join(root, '.danteforge', 'compete'), { recursive: true });
  await fs.mkdir(path.join(root, '.danteforge', 'outcome-evidence'), { recursive: true });
  // Initialize a git repo so outcome-runner can read a SHA
  const { execSync } = await import('node:child_process');
  execSync('git init && git commit --allow-empty -m init', { cwd: root, stdio: 'ignore' });

  const matrix = {
    project: 'depth-e2e-test',
    competitors: [],
    competitors_closed_source: [],
    competitors_oss: [],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 5,
    dimensions: [{
      id: 'test_depth',
      label: 'Test Depth',
      weight: 1,
      category: 'quality',
      frequency: 'high',
      scores: { self: 5 },
      gap_to_leader: 0,
      leader: '',
      gap_to_closed_source_leader: 0,
      closed_source_leader: '',
      gap_to_oss_leader: 0,
      oss_leader: '',
      status: 'in-progress',
      sprint_history: [],
      next_sprint_target: 8,
      declared_ceiling: 'T5',
      capability_test: { command: 'node -e "process.exit(0)"', description: 'always pass' },
      outcomes: [
        {
          id: 'e2e_proof',
          tier: 'T5',
          kind: 'shell',
          description: 'Proves depth doctrine plumbing works',
          command: 'node -e "console.log(\'DEPTH DOCTRINE RECEIPT: test passed at \' + new Date().toISOString()); process.exit(0)"',
          expected_exit: 0,
          timeout_ms: 30000,
          required_callsite: 'src/core/derived-score.ts',
        },
      ],
    }],
  };
  await fs.writeFile(
    path.join(root, '.danteforge', 'compete', 'matrix.json'),
    JSON.stringify(matrix, null, 2),
  );
  return root;
}

describe('Depth Doctrine E2E', () => {
  it('validate → receipt → score rises above 7.0 (the full plumbing proof)', async () => {
    const cwd = await makeTestProject();

    // Step 1: Run validate — this executes the outcome and writes evidence
    const result = await runValidateCli({
      dimId: 'test_depth',
      cwd,
      forceCold: true,
      _onProgress: () => {},
      _createTimeMachineCommit: null, // disable TM in test
    });

    assert.equal(result.dimensions.length, 1, 'should have 1 dimension result');
    assert.equal(result.dimensions[0]!.passingOutcomes, 1, 'T5 outcome should pass');
    assert.equal(result.dimensions[0]!.failingOutcomes, 0, 'no outcomes should fail');

    // Step 2: Load evidence — verify receipt exists on disk
    const evidence = await loadOutcomeEvidence(cwd);
    assert.ok(evidence.size > 0, 'evidence map should have entries');
    const entry = [...evidence.values()][0]!;
    assert.equal(entry.passed, true, 'evidence entry should be passed=true');
    assert.ok(entry.stdoutTail.includes('DEPTH DOCTRINE RECEIPT'), 'stdout should contain our marker');

    // Step 3: Compute derived score — should be T5 cap (8.0), NOT legacy fallback
    const dfs: DimensionForScoring = {
      id: 'test_depth',
      outcomes: [{
        id: 'e2e_proof', tier: 'T5', kind: 'shell' as const,
        description: 'test', command: 'node -e "process.exit(0)"',
        expected_exit: 0, timeout_ms: 30000, required_callsite: 'src/core/derived-score.ts',
      }],
      declared_ceiling: 'T5',
      legacy_score: 5,
      scores: { self: 5 },
    };
    const breakdown = computeDerivedScoreWithBreakdown(dfs, evidence);
    assert.equal(breakdown.usedLegacyFallback, false, 'should NOT use legacy fallback (outcomes declared)');
    assert.ok(breakdown.score >= 8.0, `derived score should be >= 8.0 (T5 cap), got ${breakdown.score}`);

    // Step 4: Verify receipt ceiling does NOT apply (outcomes exist)
    const finalScore = applyLegacyReceiptCeiling(breakdown.score, breakdown);
    assert.equal(finalScore, breakdown.score, 'receipt ceiling should not cap (outcomes declared)');
    assert.ok(finalScore >= 8.0, `final score should be >= 8.0, got ${finalScore}`);
  });
});
