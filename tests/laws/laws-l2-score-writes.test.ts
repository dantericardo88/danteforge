// LAW L2 — Score writes: nothing raises a persisted scores.self except writeVerifiedScore.
//
// Extends the existing grep gate (tests/score-write-gate.test.ts) with a RUNTIME drive-through:
// runAscendFrontier is driven through its real planning loop (setup → build-to-7 → push-to-9 →
// done) with seams that mutate a REAL temp matrix file the way the production flows do
// (loadMatrix → writeVerifiedScore → saveMatrix). The on-disk matrix is snapshotted between every
// orchestrator step and every adjacent pair must satisfy assertScoreProvenance — a raise with no
// writeVerifiedScore provenance row is exactly the inflation the gate exists to stop.
//
// NEGATIVE CONTROL: a cheating _runBuildTo7 seam bumps scores.self by raw JSON edit (no
// provenance) and the law is asserted to TRIP on that step's snapshot pair.

import { describe, test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runAscendFrontier, type PushResult } from '../../src/cli/commands/ascend-frontier.js';
import type { DimState } from '../../src/core/ascend-frontier-engine.js';
import { loadMatrix, saveMatrix, invalidateMatrixCache, type CompeteMatrix } from '../../src/core/compete-matrix.js';
import { writeVerifiedScore, assertScoreProvenance } from '../../src/core/write-verified-score.js';
import { lawsTmpDir, rmrf, makeDim, makeMatrix, writeRawMatrix, readRawMatrix } from './rig.js';

const ROOT = lawsTmpDir('l2');
before(async () => { await fs.mkdir(ROOT, { recursive: true }); });
after(async () => { await rmrf(ROOT); });

interface Snapshot { label: string; matrix: CompeteMatrix }

/** Read raw state from disk (no overlays) and append it to the trail. */
async function snap(trail: Snapshot[], cwd: string, label: string): Promise<void> {
  trail.push({ label, matrix: await readRawMatrix(cwd) });
}

/** LAW L2 over a snapshot trail: every adjacent pair must pass assertScoreProvenance. */
function checkScoreWriteLaw(trail: Snapshot[]): string[] {
  const violations: string[] = [];
  for (let i = 1; i < trail.length; i++) {
    for (const v of assertScoreProvenance(trail[i - 1]!.matrix, trail[i]!.matrix)) {
      violations.push(`${trail[i - 1]!.label} -> ${trail[i]!.label}: ${v.dimId} ${v.before} -> ${v.after} with NO writeVerifiedScore provenance`);
    }
  }
  return violations;
}

/** Build DimState[] from the RAW on-disk matrix — the same honest surfaces the production
 *  state builder reads, minus the live evidence machinery this fixture does not exercise. */
async function buildStateFromDisk(cwd: string): Promise<DimState[]> {
  const m = await readRawMatrix(cwd);
  return m.dimensions.map(dim => {
    const d = dim as unknown as { capability_test?: unknown; outcomes?: unknown[]; frontier_spec?: { status?: string } };
    return {
      id: dim.id,
      effectiveScore: dim.scores['self'] ?? 0,
      frontierStatus: d.frontier_spec?.status === 'validated' ? 'validated' as const : 'none' as const,
      ceiling: null,
      attempts: 0,
      isMarketCapped: false,
      needsSetup: d.capability_test === undefined || !Array.isArray(d.outcomes) || d.outcomes.length === 0,
    };
  });
}

/** Mutate the matrix THE WAY REAL FLOWS DO: load, mutate in memory, persist via saveMatrix. */
async function mutateMatrix(cwd: string, mutate: (m: CompeteMatrix) => void): Promise<void> {
  invalidateMatrixCache();
  const m = await loadMatrix(cwd);
  assert.ok(m, 'fixture matrix must load');
  mutate(m);
  await saveMatrix(m, cwd);
}

describe('L2 — full ascend drive-through: setup → build-to-7 → push-to-9 → done, all raises gated', () => {
  test('no persisted scores.self ever rises without writeVerifiedScore provenance', async () => {
    const cwd = path.join(ROOT, 'honest');
    await fs.mkdir(cwd, { recursive: true });
    await writeRawMatrix(cwd, makeMatrix([makeDim('alpha')]));
    const trail: Snapshot[] = [];
    await snap(trail, cwd, 'initial');

    const result = await runAscendFrontier({
      cwd,
      _buildState: buildStateFromDisk,
      _runSetup: async (c) => {
        await mutateMatrix(c, (m) => {
          const d = m.dimensions[0] as unknown as Record<string, unknown>;
          d['capability_test'] = { command: 'node -e "process.exit(0)"' };
          d['outcomes'] = [{ id: 'alpha-o1', tier: 'T2', kind: 'shell', command: 'node -e "process.exit(0)"' }];
        });
        await snap(trail, c, 'after-setup');
      },
      _runBuildTo7: async (c) => {
        await mutateMatrix(c, (m) => {
          writeVerifiedScore(m, 'alpha', 7.2, {
            agent: 'laws-l2-build',
            rationale: 'build-to-7 wave (recorded drive-through)',
            gatesPassed: { capability_test: true, harden: true },
          });
        });
        await snap(trail, c, 'after-build');
      },
      _runPushTo9: async (c, dimId): Promise<PushResult> => {
        await mutateMatrix(c, (m) => {
          writeVerifiedScore(m, dimId, 9.0, {
            agent: 'frontier-review',
            rationale: 'court VALIDATED (recorded drive-through)',
            gatesPassed: { capability_test: true, harden: true },
          });
          (m.dimensions[0] as unknown as Record<string, unknown>)['frontier_spec'] = { status: 'validated' };
        });
        await snap(trail, c, 'after-push');
        return {
          verdict: 'VALIDATED', courtRan: true,
          fingerprint: { dimId, command: 'node dist/index.js alpha-run', artifactPath: 'out/alpha.txt', gitSha: 'sha-l2' },
        };
      },
    });
    await snap(trail, cwd, 'final');

    assert.equal(result.terminal, 'done', `the loop must complete honestly — got ${result.terminal}: ${result.summary}`);
    assert.ok(trail.length >= 5, 'the trail covered every orchestrator step');
    assert.deepEqual(checkScoreWriteLaw(trail), [], 'L2 clean: every raise carries gate provenance');

    // Non-vacuous: scores genuinely ROSE across the run (4 → 7.2 → 9.0), so the law had raises to audit.
    const final = trail[trail.length - 1]!.matrix.dimensions[0]!;
    assert.equal(final.scores['self'], 9.0);
    const agents = (trail[trail.length - 1]!.matrix.scoreProvenance ?? []).map(p => p.agent);
    assert.ok(agents.includes('laws-l2-build') && agents.includes('frontier-review'),
      `every raise is attributable in the provenance trail: ${agents.join(', ')}`);
  });
});

describe('L2 — NEGATIVE control: a raw scores.self bump with no provenance TRIPS the law', () => {
  test('a cheating build seam (the silent-inflation shape) is caught on its snapshot pair', async () => {
    const cwd = path.join(ROOT, 'cheat');
    await fs.mkdir(cwd, { recursive: true });
    const fixture = makeMatrix([makeDim('alpha', {
      capability_test: { command: 'node -e "process.exit(0)"' },
      outcomes: [{ id: 'alpha-o1', tier: 'T2', kind: 'shell', command: 'node -e "process.exit(0)"' }],
    } as never)]);
    await writeRawMatrix(cwd, fixture);
    const trail: Snapshot[] = [];
    await snap(trail, cwd, 'initial');

    const result = await runAscendFrontier({
      cwd,
      maxCycles: 2, // the cheat never converges — bound the run, the law reads the trail either way
      _buildState: buildStateFromDisk,
      _runSetup: async () => {},
      _runBuildTo7: async (c) => {
        // The bug shape: bypass writeVerifiedScore entirely — a raw on-disk score bump.
        const p = path.join(c, '.danteforge', 'compete', 'matrix.json');
        const m = JSON.parse(await fs.readFile(p, 'utf8')) as CompeteMatrix;
        m.dimensions[0]!.scores['self'] = 6.5;
        await fs.writeFile(p, JSON.stringify(m, null, 2), 'utf8');
        invalidateMatrixCache();
        await snap(trail, c, 'after-cheat-build');
      },
      _runPushTo9: async (_c, dimId): Promise<PushResult> => ({
        verdict: 'REJECTED', courtRan: false,
        fingerprint: { dimId, command: '', artifactPath: '', gitSha: null },
      }),
    });
    await snap(trail, cwd, 'final');

    assert.ok(result.terminal === 'max-cycles' || result.terminal === 'stalled' || result.terminal === 'failed',
      `the cheating run must not read done — got ${result.terminal}`);
    const violations = checkScoreWriteLaw(trail);
    assert.ok(violations.length >= 1, 'the law MUST trip on the unprovenanced raise');
    assert.match(violations[0]!, /alpha 4 -> 6\.5/);
  });
});
