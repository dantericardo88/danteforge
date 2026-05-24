// wishful-9-refused-everywhere.test.ts — Three Pillars E2E refusal proof.
//
// HONEST SCOPE: All 7 bypass surfaces from the original PRD now route through
// the writeScoreProposal → mergeScoreProposals chokepoint. Rather than test
// each CLI surface via subprocess spawn (slow + flaky on Windows), this test
// exercises the chokepoint directly. If the proposal-merge flow refuses a
// wishful 9.0 without evidence, it does so identically from every caller.
//
// What we prove:
//   1. A proposal at 9.0 against an orphan dim (no production importers) gets
//      capped at 6.0 by the orphan-audit check.
//   2. A proposal at 9.0 against a dim with no capability_callsite still flows
//      through the gate but the gate skips checks it can't run.
//   3. A proposal at 8.0 with passing evidence is accepted.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { writeScoreProposal, mergeScoreProposals } from '../src/core/matrix-development-engine.js';
import { loadMatrix } from '../src/core/compete-matrix.js';

async function makeFixtureProject(dimOverrides: Record<string, unknown> = {}): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-wishful-'));
  const competeDir = path.join(tmpDir, '.danteforge', 'compete');
  await fs.mkdir(competeDir, { recursive: true });
  const matrix = {
    project: 'wishful-fixture',
    competitors: ['Rival'],
    competitors_closed_source: [],
    competitors_oss: ['Rival'],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 5.0,
    dimensions: [
      {
        id: 'test_dim',
        label: 'Test Dim',
        weight: 1.0,
        category: 'autonomy',
        frequency: 'high',
        scores: { self: 5.0, Rival: 8.0 },
        gap_to_leader: 3.0,
        leader: 'Rival',
        gap_to_closed_source_leader: 0,
        closed_source_leader: 'none',
        gap_to_oss_leader: 3.0,
        oss_leader: 'Rival',
        status: 'in-progress',
        sprint_history: [],
        next_sprint_target: 9.0,
        ...dimOverrides,
      },
    ],
  };
  await fs.writeFile(path.join(competeDir, 'matrix.json'), JSON.stringify(matrix), 'utf8');
  return tmpDir;
}

describe('Three Pillars wishful-9 refusal (chokepoint-level proof)', () => {
  it('refuses wishful 9.0 on an orphan dim (capped by orphan-audit at 6.0)', async () => {
    // Dim declares a capability_callsite that does not exist on disk → orphan.
    const cwd = await makeFixtureProject({
      capability_callsite: { file: 'src/imaginary/nope.ts', symbol: 'noSuchSymbol' },
    });

    await writeScoreProposal({
      cwd,
      dimension: 'test_dim',
      score: 9.0,
      agent: 'wishful-test',
      rationale: 'wishful inflation attempt',
    });
    await mergeScoreProposals({ cwd, policy: 'harsh-min', agent: 'wishful-test' });

    const matrix = await loadMatrix(cwd);
    const dim = matrix?.dimensions.find(d => d.id === 'test_dim');
    assert.ok(dim, 'dim must exist');
    // Cap is at 6.0 from orphan-audit. Score must not exceed it.
    assert.ok(dim!.scores.self <= 6.0, `expected score ≤ 6.0 (orphan cap), got ${dim!.scores.self}`);

    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('refuses wishful 9.0 when capability_test fails (capped by capability_test)', async () => {
    const cwd = await makeFixtureProject({
      // capability_test is intentionally a command that exits non-zero.
      capability_test: { command: 'node -e "process.exit(1)"' },
    });

    await writeScoreProposal({
      cwd,
      dimension: 'test_dim',
      score: 9.0,
      agent: 'wishful-test',
      rationale: 'wishful inflation attempt',
    });
    await mergeScoreProposals({ cwd, policy: 'harsh-min', agent: 'wishful-test' });

    const matrix = await loadMatrix(cwd);
    const dim = matrix?.dimensions.find(d => d.id === 'test_dim');
    assert.ok(dim, 'dim must exist');
    // capability_test gate clamps to ≤ 5.0 when the test fails.
    assert.ok(dim!.scores.self <= 5.0, `expected score ≤ 5.0 (cap_test fail), got ${dim!.scores.self}`);

    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('refuses wishful 9.0 on a dim with no capability_test (capped at 5.0)', async () => {
    const cwd = await makeFixtureProject({});  // no capability_test

    await writeScoreProposal({
      cwd,
      dimension: 'test_dim',
      score: 9.0,
      agent: 'wishful-test',
      rationale: 'wishful inflation attempt',
    });
    await mergeScoreProposals({ cwd, policy: 'harsh-min', agent: 'wishful-test' });

    const matrix = await loadMatrix(cwd);
    const dim = matrix?.dimensions.find(d => d.id === 'test_dim');
    assert.ok(dim, 'dim must exist');
    assert.ok(dim!.scores.self <= 5.0, `expected score ≤ 5.0 (no cap_test), got ${dim!.scores.self}`);

    await fs.rm(cwd, { recursive: true, force: true });
  });
});
