// declarations-tombstones.test.ts — adversarial finding 4 closed: sanctioned removal + downgrade
// write-through. A dropped declaration must STAY dropped (no overlay restore, no re-record), and a
// grounding downgrade must become the durable snapshot (no pre-downgrade resurrection after a wipe).
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  recordDeclarations, tombstoneDeclaration, updateLedgeredOutcomes,
  loadDeclarations, loadAllLedgerEntries, getLedgerDir,
} from '../src/core/declarations-ledger.js';
import { loadMatrix, invalidateMatrixCache } from '../src/core/compete-matrix.js';
import { runDeclarationsCli } from '../src/cli/commands/declarations.js';
import type { Outcome } from '../src/matrix/types/outcome.js';

const ROOT = path.join('X:\\tmp', `decl-tombstones-${process.pid}`);
let n = 0;
async function makeCwd(): Promise<string> {
  const dir = path.join(ROOT, `case-${n++}`);
  await fs.mkdir(path.join(dir, '.danteforge', 'compete'), { recursive: true });
  return dir;
}
function outcome(id: string, tier = 'T5'): Outcome {
  return { id, tier, kind: 'shell', description: `proof ${id}`,
    check: { type: 'shell', command: `node run-${id}.mjs` } } as unknown as Outcome;
}
async function writeMatrix(cwd: string, outcomes: Outcome[]): Promise<void> {
  const matrix = {
    project: 't', competitors: [], competitors_closed_source: [], competitors_oss: [],
    lastUpdated: new Date().toISOString(), overallSelfScore: 5,
    dimensions: [{
      id: 'd1', label: 'd1', weight: 1, category: 'quality', frequency: 'high', scores: { self: 5 },
      gap_to_leader: 0, leader: '', gap_to_closed_source_leader: 0, closed_source_leader: '',
      gap_to_oss_leader: 0, oss_leader: '', status: 'in-progress', sprint_history: [], next_sprint_target: 8,
      outcomes,
    }],
  };
  await fs.writeFile(path.join(cwd, '.danteforge', 'compete', 'matrix.json'), JSON.stringify(matrix, null, 2), 'utf8');
}

after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

describe('tombstones — sanctioned removal is durable', () => {
  test('drop removes from the snapshot, blocks overlay restore AND blocks re-record', async () => {
    const cwd = await makeCwd();
    await recordDeclarations(cwd, 'd1', [outcome('o1'), outcome('o2')]);
    const r = await tombstoneDeclaration(cwd, 'd1', 'o1', 'fabricated — operator removal');
    assert.equal(r.ok, true);
    assert.equal(r.removedFromOutcomes, true);

    // Overlay surface no longer sees o1.
    assert.deepEqual((await loadDeclarations(cwd, 'd1'))!.map(o => o.id), ['o2']);

    // The end-to-end resurrection test: matrix.json with NO outcomes (the git-reset shape) —
    // loadMatrix's overlay restores o2 but never the tombstoned o1.
    await writeMatrix(cwd, []);
    invalidateMatrixCache();
    const m = await loadMatrix(cwd);
    const ids = ((m!.dimensions[0] as unknown as { outcomes?: Outcome[] }).outcomes ?? []).map(o => o.id);
    assert.deepEqual(ids.sort(), ['o2'], `overlay must not resurrect the dropped id, got ${ids.join(',')}`);

    // A later gate-confirmed re-record including o1 cannot bring it back.
    await recordDeclarations(cwd, 'd1', [outcome('o1'), outcome('o2'), outcome('o3')]);
    assert.deepEqual((await loadDeclarations(cwd, 'd1'))!.map(o => o.id).sort(), ['o2', 'o3']);
    const entry = (await loadAllLedgerEntries(cwd)).get('d1')!;
    assert.equal(entry.tombstones?.length, 1, 're-record preserves the tombstone');
  });

  test('old-format ledger file (no tombstones field) still loads', async () => {
    const cwd = await makeCwd();
    const dir = getLedgerDir(cwd);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'd1.json'), JSON.stringify({
      dimensionId: 'd1', outcomes: [outcome('legacy')], updatedAt: new Date().toISOString(), recordedBy: 'validate-gate',
    }), 'utf8');
    assert.deepEqual((await loadDeclarations(cwd, 'd1'))!.map(o => o.id), ['legacy']);
  });
});

describe('downgrade write-through — the durable snapshot follows sanctioned grounding', () => {
  test('updateLedgeredOutcomes replaces a held id (T5→T2 survives a wipe), never ADDS one', async () => {
    const cwd = await makeCwd();
    await recordDeclarations(cwd, 'd1', [outcome('o1', 'T5')]);
    const downgraded = { ...outcome('o1', 'T2'), description: '[grounded: downgraded to T2] proof o1' } as Outcome;
    const wrote = await updateLedgeredOutcomes(cwd, 'd1', [downgraded, outcome('newcomer', 'T5')]);
    assert.equal(wrote, true);
    const after1 = (await loadDeclarations(cwd, 'd1'))!;
    assert.deepEqual(after1.map(o => `${o.id}:${o.tier}`), ['o1:T2'], 'replaced, and newcomer NOT added (no laundering path)');

    // Wipe simulation: the overlay restores the DOWNGRADED entry, not the original T5.
    await writeMatrix(cwd, []);
    invalidateMatrixCache();
    const m = await loadMatrix(cwd);
    const restored = ((m!.dimensions[0] as unknown as { outcomes?: Outcome[] }).outcomes ?? [])[0]!;
    assert.equal(restored.tier, 'T2', `pre-downgrade resurrection is closed — restored at ${restored.tier}`);
  });
});

describe('declarations CLI — list/drop/prune', () => {
  test('drop then list reflects the tombstone; prune deletes the file', async () => {
    const cwd = await makeCwd();
    await recordDeclarations(cwd, 'd1', [outcome('o1')]);
    const drop = await runDeclarationsCli({ action: 'drop', dimId: 'd1', outcomeId: 'o1', reason: 'test removal', cwd });
    assert.equal(drop.ok, true);
    const list = await runDeclarationsCli({ action: 'list', cwd, json: false });
    assert.equal(list.ok, true);
    const prune = await runDeclarationsCli({ action: 'prune', dimId: 'd1', cwd });
    assert.equal(prune.ok, true);
    assert.equal(prune.detail, 'deleted');
    assert.equal(await loadDeclarations(cwd, 'd1'), null, 'ledger file gone after prune');
  });
});
