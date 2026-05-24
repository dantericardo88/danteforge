import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { mergeScoreProposals, writeScoreProposal } from '../src/core/matrix-development-engine.js';
import { runEvidenceScaffold } from '../src/cli/commands/evidence-scaffold.js';
import { runEvidenceAudit } from '../src/cli/commands/evidence-audit.js';
import type { RunCapabilityTestOptions } from '../src/matrix/engines/capability-test-runner.js';
import type { CapabilityTestVerdict } from '../src/matrix/engines/capability-test-runner.js';

// ── Minimal matrix fixture ─────────────────────────────────────────────────────

function makeMatrix(dims: { id: string; score: number; capTest?: { command: string } | null }[]) {
  return {
    project: 'test',
    competitors: [],
    competitors_closed_source: [],
    competitors_oss: [],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 0,
    excludedDimensions: [],
    dimensions: dims.map(d => ({
      id: d.id,
      label: d.id,
      weight: 1,
      category: 'quality',
      frequency: 'medium' as const,
      scores: { self: d.score },
      gap_to_leader: 0,
      leader: 'none',
      gap_to_closed_source_leader: 0,
      closed_source_leader: 'none',
      gap_to_oss_leader: 0,
      oss_leader: 'none',
      status: 'active' as const,
      sprint_history: [],
      next_sprint_target: 9,
      ...(d.capTest !== undefined ? { capability_test: d.capTest } : {}),
    })),
  };
}

async function setupTmpDir(matrix: ReturnType<typeof makeMatrix>): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'evidence-gate-'));
  const dir = path.join(tmp, '.danteforge', 'compete');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'matrix.json'), JSON.stringify(matrix, null, 2), 'utf8');
  return tmp;
}

function makeCapTestSeam(exitCode: number): (opts: RunCapabilityTestOptions) => CapabilityTestVerdict {
  return (opts) => ({
    dimensionId: opts.dimensionId,
    allowed: exitCode === 0,
    scoreCap: exitCode === 0 ? 10 : 5.0,
    reason: exitCode === 0 ? 'test passed' : `test failed (exit ${exitCode})`,
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function readMatrix(cwd: string) {
  const raw = await fs.readFile(path.join(cwd, '.danteforge', 'compete', 'matrix.json'), 'utf8');
  return JSON.parse(raw) as ReturnType<typeof makeMatrix>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('evidence gate — mergeScoreProposals', () => {
  it('clamps score to 5.0 when capability_test is absent', async () => {
    const cwd = await setupTmpDir(makeMatrix([{ id: 'testing', score: 6.0 }]));
    await writeScoreProposal({ cwd, dimension: 'testing', score: 9.0, agent: 'test', rationale: 'great' });
    await mergeScoreProposals({ cwd, _runCapabilityTest: makeCapTestSeam(1) });
    const m = await readMatrix(cwd);
    const dim = m.dimensions.find(d => d.id === 'testing')!;
    assert.equal(dim.scores['self'], 5.0, 'should be clamped to 5.0 when no cap test');
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('clamps score to 5.0 when capability_test fails (exit 1)', async () => {
    const cwd = await setupTmpDir(makeMatrix([
      { id: 'testing', score: 6.0, capTest: { command: 'exit 1' } },
    ]));
    await writeScoreProposal({ cwd, dimension: 'testing', score: 9.0, agent: 'test', rationale: 'great' });
    await mergeScoreProposals({ cwd, _runCapabilityTest: makeCapTestSeam(1) });
    const m = await readMatrix(cwd);
    assert.equal(m.dimensions[0]!.scores['self'], 5.0);
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('accepts full score when capability_test passes (exit 0)', async () => {
    const cwd = await setupTmpDir(makeMatrix([
      { id: 'testing', score: 6.0, capTest: { command: 'exit 0' } },
    ]));
    await writeScoreProposal({ cwd, dimension: 'testing', score: 9.0, agent: 'test', rationale: 'great' });
    await mergeScoreProposals({ cwd, _runCapabilityTest: makeCapTestSeam(0) });
    const m = await readMatrix(cwd);
    assert.equal(m.dimensions[0]!.scores['self'], 9.0);
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('skips capability test for scores at or below 5.0', async () => {
    let capTestCalled = false;
    const cwd = await setupTmpDir(makeMatrix([{ id: 'testing', score: 3.0 }]));
    await writeScoreProposal({ cwd, dimension: 'testing', score: 4.5, agent: 'test', rationale: 'low' });
    await mergeScoreProposals({
      cwd,
      _runCapabilityTest: (opts) => {
        capTestCalled = true;
        return makeCapTestSeam(0)(opts);
      },
    });
    assert.equal(capTestCalled, false, 'should not call cap test for score <= 5.0');
    const m = await readMatrix(cwd);
    assert.equal(m.dimensions[0]!.scores['self'], 4.5);
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('respects injection seam — _runCapabilityTest override is used', async () => {
    let seamCalled = false;
    const cwd = await setupTmpDir(makeMatrix([
      { id: 'testing', score: 5.0, capTest: { command: 'this-would-fail' } },
    ]));
    await writeScoreProposal({ cwd, dimension: 'testing', score: 8.0, agent: 'test', rationale: 'ok' });
    await mergeScoreProposals({
      cwd,
      _runCapabilityTest: (opts) => {
        seamCalled = true;
        return makeCapTestSeam(0)(opts);
      },
    });
    assert.ok(seamCalled, 'injection seam should be called');
    const m = await readMatrix(cwd);
    assert.equal(m.dimensions[0]!.scores['self'], 8.0, 'seam returned pass so score should be accepted');
    await fs.rm(cwd, { recursive: true, force: true });
  });
});

describe('evidence-scaffold', () => {
  it('auto-detects npm capability tests for known dims', async () => {
    const cwd = await setupTmpDir(makeMatrix([
      { id: 'testing', score: 7.0, capTest: null },
      { id: 'security', score: 7.0, capTest: null },
    ]));
    // Add package.json so project type is detected as npm
    await fs.writeFile(path.join(cwd, 'package.json'), '{"name":"test"}', 'utf8');

    const written: string[] = [];
    const result = await runEvidenceScaffold({
      cwd,
      projectType: 'npm',
      _writeFile: async (p, c) => { written.push(p); await fs.writeFile(p, c, 'utf8'); },
      _writeMatrix: async (m, p) => { await fs.writeFile(p, JSON.stringify(m, null, 2), 'utf8'); },
    });

    assert.ok(result.autoDetected.includes('testing'), 'testing should be auto-detected');
    assert.ok(result.autoDetected.includes('security'), 'security should be auto-detected');
    assert.equal(result.stubGenerated.length, 0);

    const m = await readMatrix(cwd);
    const testingDim = m.dimensions.find(d => d.id === 'testing')! as Record<string, unknown> & { scores: { self: number } };
    assert.ok(testingDim['capability_test'], 'testing dim should now have capability_test');
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('generates stub scripts for unknown dims', async () => {
    const cwd = await setupTmpDir(makeMatrix([
      { id: 'unknown_custom_dim', score: 7.0, capTest: null },
    ]));

    const written: string[] = [];
    const result = await runEvidenceScaffold({
      cwd,
      projectType: 'npm',
      _writeFile: async (p, c) => { written.push(p); await fs.writeFile(p, c, 'utf8'); },
      _writeMatrix: async (m, p) => { await fs.writeFile(p, JSON.stringify(m, null, 2), 'utf8'); },
    });

    assert.equal(result.stubGenerated.length, 1);
    assert.ok(result.stubGenerated.includes('unknown_custom_dim'));
    assert.ok(written.some(p => p.includes('unknown_custom_dim.sh')), 'stub script should be written');
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('dry-run makes no changes to matrix.json', async () => {
    const matrix = makeMatrix([{ id: 'testing', score: 7.0, capTest: null }]);
    const cwd = await setupTmpDir(matrix);
    const matrixBefore = JSON.stringify(await readMatrix(cwd));

    await runEvidenceScaffold({
      cwd,
      projectType: 'npm',
      dryRun: true,
      _writeFile: async () => { throw new Error('should not write in dry-run'); },
      _writeMatrix: async () => { throw new Error('should not write matrix in dry-run'); },
    });

    const matrixAfter = JSON.stringify(await readMatrix(cwd));
    assert.equal(matrixBefore, matrixAfter, 'matrix.json should not change in dry-run');
    await fs.rm(cwd, { recursive: true, force: true });
  });
});

describe('evidence-audit', () => {
  it('flags dims > 5.0 with no capability_test as would-be-capped', async () => {
    const cwd = await setupTmpDir(makeMatrix([
      { id: 'testing', score: 8.0 },
      { id: 'security', score: 3.0 },
    ]));

    const result = await runEvidenceAudit({ cwd });
    const testingEntry = result.dimensions.find(e => e.dimensionId === 'testing')!;
    const securityEntry = result.dimensions.find(e => e.dimensionId === 'security')!;

    assert.equal(testingEntry.wouldBeCapped, true, 'testing (score 8.0, no cap test) should be flagged');
    assert.equal(securityEntry.wouldBeCapped, false, 'security (score 3.0, below cap) should not be flagged');
    assert.equal(result.wouldBeCapped, 1);
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('shows dim as passing when runTests=true and test passes', async () => {
    const cwd = await setupTmpDir(makeMatrix([
      { id: 'testing', score: 8.0, capTest: { command: 'exit 0' } },
    ]));

    const result = await runEvidenceAudit({
      cwd,
      runTests: true,
      _runCapabilityTest: makeCapTestSeam(0),
    });

    const entry = result.dimensions.find(e => e.dimensionId === 'testing')!;
    assert.equal(entry.testPassed, true);
    assert.equal(entry.wouldBeCapped, false);
    await fs.rm(cwd, { recursive: true, force: true });
  });
});
