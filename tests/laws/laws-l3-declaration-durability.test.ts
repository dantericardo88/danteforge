// LAW L3 — Declaration durability: no flow silently REMOVES a gate-confirmed declaration.
// Every disappearance must be a tombstone (sanctioned removal) or a loud declarations-lost
// run-ledger event — never silent (the fleet-run-1 class: earns evaporated on 3/3 repos).
//
// Driven through: (a) the REAL runAscendFrontier setup branch (its snapshot/diff detector must
// ledger a loss the seamed setup inflicts), (b) the REAL declarations-ledger + loadMatrix overlay
// under a git-reset simulation, (c) groundOutcomes' sanctioned-downgrade write-through.
//
// NEGATIVE CONTROL: a pruned ledger + wiped matrix (the silent class) is fed to the law checker
// and the checker is asserted to TRIP.

import { describe, test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runAscendFrontier } from '../../src/cli/commands/ascend-frontier.js';
import type { DimState } from '../../src/core/ascend-frontier-engine.js';
import { loadMatrix, invalidateMatrixCache, type CompeteMatrix } from '../../src/core/compete-matrix.js';
import {
  recordDeclarations, tombstoneDeclaration, pruneDeclarations, loadLedgerEntry, loadDeclarations,
} from '../../src/core/declarations-ledger.js';
import { groundOutcomes } from '../../src/core/outcome-grounding.js';
import type { Outcome } from '../../src/matrix/types/outcome.js';
import {
  lawsTmpDir, rmrf, makeRepo, git, makeDim, makeMatrix, writeRawMatrix, readRunEvents,
  declaredOutcomeIds, checkDeclarationDurability, type RunEvent,
} from './rig.js';

const ROOT = lawsTmpDir('l3');
before(async () => { await fs.mkdir(ROOT, { recursive: true }); });
after(async () => { await rmrf(ROOT); });

const OUTCOME_A: Outcome = {
  id: 'oA', tier: 'T5', kind: 'runtime-exec',
  command: 'node dist/index.js laws-probe', required_callsite: 'src/laws-mod.ts',
  description: 'gate-confirmed product run (fixture)',
} as unknown as Outcome;

async function effectiveIds(cwd: string): Promise<Map<string, Set<string>>> {
  invalidateMatrixCache();
  const m = await loadMatrix(cwd);
  assert.ok(m, 'matrix must load');
  return declaredOutcomeIds(m as CompeteMatrix);
}

describe('L3 — the orchestrator setup branch makes a removal LOUD (declarations-lost event)', () => {
  test('a setup pass that drops a declaration produces a declarations-lost run-ledger event', async () => {
    const cwd = path.join(ROOT, 'loud-setup');
    await fs.mkdir(cwd, { recursive: true });
    // outcomes exist but capability_test is missing → the planner routes to SETUP first.
    await writeRawMatrix(cwd, makeMatrix([makeDim('alpha', {
      outcomes: [
        { id: 'keep-me', tier: 'T2', kind: 'shell', command: 'node -e "process.exit(0)"' },
        { id: 'drop-me', tier: 'T5', kind: 'runtime-exec', command: 'node dist/index.js x' },
      ],
    } as never)]));

    const buildState = async (c: string): Promise<DimState[]> => {
      const raw = JSON.parse(await fs.readFile(path.join(c, '.danteforge', 'compete', 'matrix.json'), 'utf8')) as CompeteMatrix;
      return raw.dimensions.map(dim => {
        const d = dim as unknown as { capability_test?: unknown; outcomes?: unknown[] };
        return {
          id: dim.id, effectiveScore: dim.scores['self'] ?? 0, frontierStatus: 'none' as const,
          ceiling: null, attempts: 0, isMarketCapped: false,
          needsSetup: d.capability_test === undefined || !Array.isArray(d.outcomes) || d.outcomes.length === 0,
        };
      });
    };

    const result = await runAscendFrontier({
      cwd, maxCycles: 1,
      _buildState: buildState,
      _runSetup: async (c) => {
        // The fleet shape: a matrix rewrite that silently DROPS a declared outcome.
        const p = path.join(c, '.danteforge', 'compete', 'matrix.json');
        const m = JSON.parse(await fs.readFile(p, 'utf8')) as CompeteMatrix;
        const d = m.dimensions[0] as unknown as { capability_test?: unknown; outcomes?: Array<{ id: string }> };
        d.capability_test = { command: 'node -e "process.exit(0)"' };
        d.outcomes = (d.outcomes ?? []).filter(o => o.id !== 'drop-me');
        await fs.writeFile(p, JSON.stringify(m, null, 2), 'utf8');
        invalidateMatrixCache();
      },
      _runBuildTo7: async () => {},
      _runPushTo9: async (_c, dimId) => ({
        verdict: 'REJECTED' as const, courtRan: false,
        fingerprint: { dimId, command: '', artifactPath: '', gitSha: null },
      }),
    });

    assert.ok(result.runId, 'a real cycle ran, so a run ledger exists');
    const events = await readRunEvents(cwd, result.runId!);
    const lost = events.filter(e => e.eventType === 'declarations-lost');
    assert.equal(lost.length, 1, `exactly one declarations-lost event: ${JSON.stringify(events.map(e => e.eventType))}`);
    assert.deepEqual(lost[0]!.data['lost'], ['alpha/drop-me'], 'the event names the exact dim/outcome');

    // And the LAW accepts the loss because it was loudly accounted for.
    const before = new Map([['alpha', new Set(['keep-me', 'drop-me'])]]);
    const after = new Map([['alpha', new Set(['keep-me'])]]);
    assert.deepEqual(
      checkDeclarationDurability(before, after, { tombstonedOutcomeIds: new Set(), events }),
      [], 'a ledgered loss is not silent');
  });
});

describe('L3 — git-reset simulation: the ledger overlay restores; a tombstone is a sanctioned removal', () => {
  test('a reset-wiped matrix re-reads its gate-confirmed declarations from the ledger (no loss at all)', async () => {
    const cwd = await makeRepo(path.join(ROOT, 'reset-sim'));
    await writeRawMatrix(cwd, makeMatrix([makeDim('alpha', { outcomes: [OUTCOME_A] } as never)]));
    assert.equal(await recordDeclarations(cwd, 'alpha', [OUTCOME_A]), true, 'ledger snapshot persisted');
    const before = await effectiveIds(cwd);
    assert.ok(before.get('alpha')?.has('oA'));

    // Simulate the fleet's blast radius: commit a matrix WITHOUT the declaration, then
    // git reset --hard — matrix.json on disk now lacks oA, exactly like a wiped earn.
    await writeRawMatrix(cwd, makeMatrix([makeDim('alpha')]));
    git(cwd, 'add', '-f', '.danteforge/compete/matrix.json');
    git(cwd, 'commit', '-qm', 'matrix without declarations');
    await writeRawMatrix(cwd, makeMatrix([makeDim('alpha', { outcomes: [OUTCOME_A] } as never)]));
    git(cwd, 'reset', '--hard', '-q', 'HEAD');
    const onDisk = JSON.parse(await fs.readFile(path.join(cwd, '.danteforge', 'compete', 'matrix.json'), 'utf8')) as CompeteMatrix;
    assert.equal((onDisk.dimensions[0] as unknown as { outcomes?: unknown[] }).outcomes, undefined,
      'the reset really wiped the on-disk declaration');

    // The ledger lives OUTSIDE git's blast radius (self-gitignored) and the overlay restores.
    const after = await effectiveIds(cwd);
    assert.ok(after.get('alpha')?.has('oA'), 'overlay restored the gate-confirmed declaration');
    assert.deepEqual(
      checkDeclarationDurability(before, after, { tombstonedOutcomeIds: new Set(), events: [] }),
      [], 'nothing disappeared — durability held through the reset');
  });

  test('a tombstoned removal stays removed AND is fully accounted for (never silent)', async () => {
    const cwd = path.join(ROOT, 'tombstone');
    await fs.mkdir(cwd, { recursive: true });
    await writeRawMatrix(cwd, makeMatrix([makeDim('alpha', { outcomes: [OUTCOME_A] } as never)]));
    await recordDeclarations(cwd, 'alpha', [OUTCOME_A]);
    const before = await effectiveIds(cwd);

    const ts = await tombstoneDeclaration(cwd, 'alpha', 'oA', 'operator removed: superseded by oB');
    assert.equal(ts.ok, true);
    await writeRawMatrix(cwd, makeMatrix([makeDim('alpha')])); // matrix rewrite drops it too
    const after = await effectiveIds(cwd);
    assert.equal(after.get('alpha')?.has('oA'), false, 'the overlay must NOT resurrect a tombstoned id');

    const entry = await loadLedgerEntry(cwd, 'alpha');
    const tombstoned = new Set((entry?.tombstones ?? []).map(t => t.outcomeId));
    assert.ok(tombstoned.has('oA'), 'the removal is durably recorded with provenance');
    assert.match(entry!.tombstones![0]!.reason, /superseded/);
    assert.deepEqual(
      checkDeclarationDurability(before, after, { tombstonedOutcomeIds: tombstoned, events: [] }),
      [], 'a tombstoned disappearance is sanctioned, not silent');
  });

  test('groundOutcomes writes a sanctioned downgrade THROUGH to the ledger (the durable truth is the downgraded one)', async () => {
    const cwd = path.join(ROOT, 'write-through');
    await fs.mkdir(path.join(cwd, 'tests'), { recursive: true });
    await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'package.json'), '{"name":"laws-l3-wt"}', 'utf8');
    await fs.writeFile(path.join(cwd, 'src', 'laws-orphan.ts'), 'export const x = 1;\n', 'utf8');
    await fs.writeFile(path.join(cwd, 'tests', 'wt.test.ts'), "import assert from 'node:assert';\nassert.ok(true);\n", 'utf8');
    const testBacked: Outcome = {
      id: 'oT', tier: 'T5', kind: 'shell',
      command: 'npx tsx --test tests/wt.test.ts', required_callsite: 'src/laws-orphan.ts',
    } as unknown as Outcome;
    const matrix = makeMatrix([makeDim('alpha', { outcomes: [testBacked] } as never)]);
    await recordDeclarations(cwd, 'alpha', [testBacked]);

    const summary = await groundOutcomes({ matrix, projectPath: cwd });
    const dimResult = summary.results.find(r => r.dimId === 'alpha');
    assert.ok(dimResult && dimResult.changes.some(c => c.includes('oT') && c.includes('T2')),
      `the downgrade carries provenance: ${JSON.stringify(dimResult)}`);

    const ledgered = await loadDeclarations(cwd, 'alpha');
    assert.equal(ledgered?.find(o => o.id === 'oT')?.tier, 'T2',
      'the ledger now holds the DOWNGRADED truth — a later wipe restores honesty, not the old inflated tier');
  });
});

describe('L3 — NEGATIVE control: the silent-loss shape TRIPS the law', () => {
  test('pruned ledger + wiped matrix + no event = exactly the fleet bug, and the checker catches it', async () => {
    const cwd = path.join(ROOT, 'silent');
    await fs.mkdir(cwd, { recursive: true });
    await writeRawMatrix(cwd, makeMatrix([makeDim('alpha', { outcomes: [OUTCOME_A] } as never)]));
    await recordDeclarations(cwd, 'alpha', [OUTCOME_A]);
    const before = await effectiveIds(cwd);

    // Re-introduce the bug condition: durability layer removed, matrix wiped, nothing recorded.
    assert.equal(await pruneDeclarations(cwd, 'alpha'), true);
    await writeRawMatrix(cwd, makeMatrix([makeDim('alpha')]));
    const after = await effectiveIds(cwd);
    assert.equal(after.get('alpha')?.has('oA'), false, 'the declaration is gone');

    const events: RunEvent[] = [];
    const violations = checkDeclarationDurability(before, after, { tombstonedOutcomeIds: new Set(), events });
    assert.equal(violations.length, 1, 'the law MUST trip on a silent disappearance');
    assert.match(violations[0]!, /alpha\/oA disappeared SILENTLY/);
  });
});
