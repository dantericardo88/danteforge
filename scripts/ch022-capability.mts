// ch022-capability.mts — the REAL capability_test for depth_doctrine (replaces the dishonest `--help`
// proxy). It exercises the rung-9 arc end-to-end against PRODUCTION code and exits non-zero if any step
// is broken, so the capability gate + sensitivity probe can verify genuine dependence:
//   1. AUTO RE-ENTRY: seed a WaveLedger (waves 0,1 completed, wave 2 crashed/running) and assert
//      resolveResumeIndex resumes from wave 2 — not 0.
//   2. INTERRUPT-BEFORE-SCORE-WRITE: arm the interrupt, assert saveMatrix BLOCKS (no score frozen);
//      clear it, assert saveMatrix proceeds.
// Run: npx tsx scripts/ch022-capability.mts   (exit 0 = capability present; exit 1 = broken).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startWave, finishWave } from '../src/core/wave-ledger.js';
import { resolveResumeIndex } from '../src/core/wave-replay.js';
import { INTERRUPT_SENTINEL } from '../src/core/score-interrupt.js';
import { saveMatrix, type CompeteMatrix, type MatrixDimension } from '../src/core/compete-matrix.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) { console.error(`[ch022-capability] FAIL: ${msg}`); process.exit(1); }
}

function fixtureMatrix(): CompeteMatrix {
  const dim = {
    id: 'd', name: 'D', weight: 1, frequency: 'medium', scores: { self: 7, Cursor: 8 },
    gap_to_leader: 1, leader: 'Cursor', gap_to_closed_source_leader: 0, closed_source_leader: 'Cursor',
    gap_to_oss_leader: 0, oss_leader: 'u', status: 'in-progress', sprint_history: [], next_sprint_target: 9,
  } as MatrixDimension;
  return { project: 'p', competitors: ['Cursor'], competitors_closed_source: ['Cursor'], competitors_oss: [], lastUpdated: '', overallSelfScore: 7, dimensions: [dim] };
}

async function main(): Promise<void> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ch022-cap-'));
  try {
    await fs.mkdir(path.join(cwd, '.danteforge', 'compete'), { recursive: true });

    // (1) AUTO RE-ENTRY — crash mid-wave-2, resume must skip the two completed waves.
    const runId = 'ch022-cap-run';
    const w0 = await startWave(cwd, { runId, loopName: 'harden-crusade', waveIndex: 0, dimensionId: 'd' });
    await finishWave(cwd, w0, { status: 'completed', scoreAfter: 6 });
    const w1 = await startWave(cwd, { runId, loopName: 'harden-crusade', waveIndex: 1, dimensionId: 'd' });
    await finishWave(cwd, w1, { status: 'completed', scoreAfter: 7 });
    await startWave(cwd, { runId, loopName: 'harden-crusade', waveIndex: 2, dimensionId: 'd' }); // crash — no finish
    const resume = await resolveResumeIndex(cwd, runId);
    assert(resume === 2, `auto re-entry should resume from wave 2, got ${resume}`);

    // (2) INTERRUPT-BEFORE-SCORE-WRITE — armed sentinel blocks the persist; cleared lets it through.
    let wrote = 0;
    const spy = async () => { wrote++; };
    const sentinel = path.join(cwd, INTERRUPT_SENTINEL);
    await fs.writeFile(sentinel, 'ch022 capability probe — pause before committing the crashed wave');
    let blocked = false;
    try { await saveMatrix(fixtureMatrix(), cwd, spy); } catch (e) { blocked = /BLOCKED by interrupt/.test(String(e)); }
    assert(blocked, 'an armed interrupt must BLOCK the score write');
    assert(wrote === 0, 'a blocked save must persist nothing (the crashed wave stays resumable)');

    await fs.rm(sentinel, { force: true });
    await saveMatrix(fixtureMatrix(), cwd, spy);
    assert(wrote === 1, 'clearing the interrupt must let the score write proceed');

    console.log('[ch022-capability] OK — auto re-entry (resume@2) + interrupt-before-score-write both verified.');
    process.exit(0);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true }).catch(() => { /* best effort */ });
  }
}

main().catch(err => { console.error(`[ch022-capability] ERROR: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); });
