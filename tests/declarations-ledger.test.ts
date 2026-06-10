// declarations-ledger.test.ts — the durable persistence contract for gate-confirmed
// outcome declarations (fleet run 1, 2026-06-10: matrix.json is kernel-owned and never
// committed by agents, so the autopilot's git operations wiped its uncommitted outcomes[]
// on 3/3 repos — earns evaporated).
//
// Covers:
//   1. record → loadAll round-trip; corrupt file → absent + no throw
//   2. the self-ignoring .gitignore (`*`) is written on first record
//   3. loadMatrix overlay: missing ledger outcome restored; matrix wins on id collision
//      (a ground-outcomes downgrade is never resurrected)
//   4. the git-reset simulation: validate records → matrix.json rewritten without the
//      declaration → loadMatrix restores it
//   5. the gate condition: a validate run WITH an integrity cap does NOT record
//   6. seam injection: every fs operation is overridable (no real disk)

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  recordDeclarations,
  loadDeclarations,
  loadAllDeclarations,
  getLedgerDir,
  type LedgerFs,
} from '../src/core/declarations-ledger.js';
import { loadMatrix, invalidateMatrixCache } from '../src/core/compete-matrix.js';
import { runValidateCli } from '../src/cli/commands/validate.js';
import type { Outcome } from '../src/matrix/types/outcome.js';

const tempDirs: string[] = [];
after(async () => {
  for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

async function mkTmp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-decl-ledger-'));
  tempDirs.push(root);
  return root;
}

// T2 outcomes by default: below T4 they trip neither the orphan-callsite nor the seam
// integrity checks in a bare temp project, so a passing run is genuinely gate-confirmed.
function outcome(id: string, over: Record<string, unknown> = {}): Outcome {
  return {
    id,
    tier: 'T2',
    kind: 'shell',
    description: `proof ${id}`,
    command: 'node -e "process.exit(0)"',
    expected_exit: 0,
    timeout_ms: 30000,
    required_callsite: 'src/core/declarations-ledger.ts',
    ...over,
  } as unknown as Outcome;
}

async function writeMatrix(root: string, outcomes: unknown[]): Promise<string> {
  await fs.mkdir(path.join(root, '.danteforge', 'compete'), { recursive: true });
  await fs.mkdir(path.join(root, '.danteforge', 'outcome-evidence'), { recursive: true });
  const matrix = {
    project: 'decl-ledger-test', competitors: [], competitors_closed_source: [], competitors_oss: [],
    lastUpdated: new Date().toISOString(), overallSelfScore: 5,
    dimensions: [{
      id: 'd', label: 'd', weight: 1, category: 'quality', frequency: 'high', scores: { self: 5 },
      gap_to_leader: 0, leader: '', gap_to_closed_source_leader: 0, closed_source_leader: '',
      gap_to_oss_leader: 0, oss_leader: '', status: 'in-progress', sprint_history: [],
      next_sprint_target: 8, declared_ceiling: 'T5',
      outcomes,
    }],
  };
  const mPath = path.join(root, '.danteforge', 'compete', 'matrix.json');
  await fs.writeFile(mPath, JSON.stringify(matrix, null, 2));
  return mPath;
}

async function gitInit(root: string): Promise<void> {
  const { execSync } = await import('node:child_process');
  execSync('git init && git commit --allow-empty -m init', { cwd: root, stdio: 'ignore' });
}

// ── 1. round-trip + corruption tolerance ─────────────────────────────────────

describe('declarations-ledger: record/load round-trip', () => {
  it('record → loadAll round-trip; a corrupt sibling file is absent and never throws', async () => {
    const cwd = await mkTmp();
    const ok = await recordDeclarations(cwd, 'dim_a', [outcome('o1'), outcome('o2')]);
    assert.equal(ok, true);

    // Corrupt sibling: must be skipped with a warn, never thrown.
    await fs.writeFile(path.join(getLedgerDir(cwd), 'dim_corrupt.json'), '{not json at all');

    const all = await loadAllDeclarations(cwd);
    assert.equal(all.size, 1, 'corrupt file must be skipped, valid one loaded');
    assert.deepEqual(all.get('dim_a')!.map(o => o.id), ['o1', 'o2']);

    const one = await loadDeclarations(cwd, 'dim_a');
    assert.equal(one!.length, 2);
    assert.equal(await loadDeclarations(cwd, 'dim_corrupt'), null, 'corrupt → treated as absent');
    assert.equal(await loadDeclarations(cwd, 'never_recorded'), null, 'missing → null, silent');
  });

  it('re-record overwrites: the last gate-confirmed snapshot wins', async () => {
    const cwd = await mkTmp();
    await recordDeclarations(cwd, 'dim_a', [outcome('o1')]);
    await recordDeclarations(cwd, 'dim_a', [outcome('o1'), outcome('o3')]);
    const loaded = await loadDeclarations(cwd, 'dim_a');
    assert.deepEqual(loaded!.map(o => o.id), ['o1', 'o3']);
  });

  it('the on-disk entry carries the validate-gate provenance fields', async () => {
    const cwd = await mkTmp();
    await recordDeclarations(cwd, 'dim_p', [outcome('o1')]);
    const raw = JSON.parse(await fs.readFile(path.join(getLedgerDir(cwd), 'dim_p.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(raw['dimensionId'], 'dim_p');
    assert.equal(raw['recordedBy'], 'validate-gate');
    assert.ok(typeof raw['updatedAt'] === 'string' && raw['updatedAt'].length > 0);
  });
});

// ── 2. the self-ignoring-directory trick ─────────────────────────────────────

describe('declarations-ledger: self-ignoring .gitignore', () => {
  it('first record creates declarations/.gitignore containing `*`', async () => {
    const cwd = await mkTmp();
    await recordDeclarations(cwd, 'dim_g', [outcome('o1')]);
    const gi = await fs.readFile(path.join(getLedgerDir(cwd), '.gitignore'), 'utf8');
    assert.equal(gi, '*\n', 'the ledger must ignore EVERYTHING in its own directory, including itself');
  });
});

// ── 6. seam injection (no real disk) ─────────────────────────────────────────

describe('declarations-ledger: fs seams', () => {
  it('record + loadAll run entirely through injected fs (no real disk)', async () => {
    const store = new Map<string, string>();
    const seam: LedgerFs = {
      readFile: async (p) => {
        if (!store.has(p)) {
          throw Object.assign(new Error(`missing ${p}`), { code: 'ENOENT' });
        }
        return store.get(p)!;
      },
      writeFile: async (p, c) => { store.set(p, c); },
      mkdir: async () => {},
      readdir: async () => [...store.keys()].map(p => path.basename(p)),
      // True for stored files AND for the ledger directory itself (any stored key under it).
      exists: async (p) => store.has(p) || [...store.keys()].some(k => k.startsWith(p)),
    };
    const ok = await recordDeclarations('/no/disk', 'dim_s', [outcome('o1')], { _fs: seam });
    assert.equal(ok, true);
    assert.ok([...store.keys()].some(p => p.endsWith('.gitignore')), 'gitignore went through the seam');

    const all = await loadAllDeclarations('/no/disk', { _fs: seam });
    assert.deepEqual([...all.keys()], ['dim_s']);
    assert.deepEqual(all.get('dim_s')!.map(o => o.id), ['o1']);
  });
});

// ── 3. loadMatrix overlay semantics ──────────────────────────────────────────

describe('loadMatrix declarations overlay', () => {
  it('restores a ledger outcome the matrix lost; matrix entry wins on id collision', async () => {
    const cwd = await mkTmp();
    // matrix.json declares ONLY 'kept' — with a marker distinguishing it from the ledger copy
    // (this is the ground-outcomes-downgrade shape: the matrix holds the NEWER entry).
    await writeMatrix(cwd, [outcome('kept', { description: 'matrix-version' })]);
    await recordDeclarations(cwd, 'd', [
      outcome('kept', { description: 'ledger-version' }),
      outcome('lost', { description: 'ledger-only' }),
    ]);

    invalidateMatrixCache();
    const m = await loadMatrix(cwd);
    const outs = (m!.dimensions[0] as unknown as { outcomes: Array<{ id: string; description: string }> }).outcomes;
    assert.deepEqual(outs.map(o => o.id).sort(), ['kept', 'lost'], 'the lost declaration must be restored');
    assert.equal(
      outs.find(o => o.id === 'kept')!.description,
      'matrix-version',
      'matrix entry must win on id collision — the ledger may never resurrect a downgrade',
    );
  });

  it('seamed raw reads (_fsRead) skip the overlay entirely', async () => {
    const cwd = await mkTmp();
    await writeMatrix(cwd, [outcome('kept')]);
    await recordDeclarations(cwd, 'd', [outcome('kept'), outcome('lost')]);

    invalidateMatrixCache();
    const raw = await loadMatrix(cwd, (p) => fs.readFile(p, 'utf8'));
    const outs = (raw!.dimensions[0] as unknown as { outcomes: Array<{ id: string }> }).outcomes;
    assert.deepEqual(outs.map(o => o.id), ['kept'], '_fsRead must return the raw on-disk matrix, no overlay');
  });
});

// ── 4 + 5. the full pipeline: validate writes, git reset wipes, loadMatrix restores ──

describe('validate gate → ledger → git-reset recovery (the fleet-run-1 fix)', () => {
  it('gate-confirmed validate records; a matrix rewrite that loses outcomes is healed at load', async () => {
    const cwd = await mkTmp();
    await gitInit(cwd);
    const mPath = await writeMatrix(cwd, [outcome('p')]);

    const r = await runValidateCli({
      dimId: 'd', cwd, forceCold: true, _onProgress: () => {}, _createTimeMachineCommit: null,
    });
    assert.equal(r.allPassed, true, 'premise: the T2 outcome passes');
    assert.equal(r.dimensions[0]!.integrityCap, undefined, 'premise: no integrity cap');

    // The gate-confirmed earn snapshotted the declarations.
    const ledgerRaw = await fs.readFile(path.join(getLedgerDir(cwd), 'd.json'), 'utf8');
    assert.ok(ledgerRaw.includes('"validate-gate"'), 'recorded by the validate gate');
    assert.ok(ledgerRaw.includes('"p"'), 'snapshot holds the declared outcome');

    // Simulate the autopilot's git reset / matrix rewrite: outcomes[] are GONE on disk.
    const onDisk = JSON.parse(await fs.readFile(mPath, 'utf8')) as { dimensions: Array<Record<string, unknown>> };
    delete onDisk.dimensions[0]!['outcomes'];
    await fs.writeFile(mPath, JSON.stringify(onDisk, null, 2));

    invalidateMatrixCache();
    const healed = await loadMatrix(cwd);
    const outs = (healed!.dimensions[0] as unknown as { outcomes?: Array<{ id: string }> }).outcomes;
    assert.ok(outs && outs.some(o => o.id === 'p'), 'the wiped declaration must be restored from the ledger');
    // With the declaration restored, the evidence from the validate run re-derives the earn.
    const derived = healed!.dimensions[0]!.scores['derived'];
    assert.ok(typeof derived === 'number' && derived > 0, `restored declaration + on-disk evidence must re-derive the earn, got ${derived}`);
  });

  it('a validate run WITH an integrity cap does NOT record to the ledger', async () => {
    const cwd = await mkTmp();
    await gitInit(cwd);
    // T5 + a seam token in the command: the outcome PASSES but SEAM_USAGE (and, in a bare
    // temp project, ORPHAN_CALLSITE) caps the score — exactly the run that must never
    // launder its declarations into durability.
    await writeMatrix(cwd, [outcome('seamed', {
      tier: 'T5',
      command: 'node -e "console.log(\'_cipCheck marker\'); process.exit(0)"',
    })]);

    const r = await runValidateCli({
      dimId: 'd', cwd, forceCold: true, _onProgress: () => {}, _createTimeMachineCommit: null,
    });
    assert.equal(r.dimensions[0]!.failingOutcomes, 0, 'premise: the outcome itself passes');
    assert.ok(r.dimensions[0]!.integrityCap, 'premise: the integrity cap fires');

    await assert.rejects(
      () => fs.access(path.join(getLedgerDir(cwd), 'd.json')),
      'an integrity-capped run must not snapshot declarations',
    );
  });

  it('a partial (filtered) run does NOT record — all declared outcomes must run and pass', async () => {
    const cwd = await mkTmp();
    await gitInit(cwd);
    // One runtime-kind outcome + one plain shell outcome. --runtime-only runs just the
    // first, so even a clean pass is NOT "all declared outcomes passed".
    await writeMatrix(cwd, [
      outcome('rt', { kind: 'runtime-exec', command: 'node -e "process.exit(0)"' }),
      outcome('sh'),
    ]);

    const r = await runValidateCli({
      dimId: 'd', cwd, forceCold: true, runtimeOnly: true,
      _onProgress: () => {}, _createTimeMachineCommit: null,
    });
    assert.equal(r.dimensions[0]!.totalOutcomes, 1, 'premise: the filter dropped the shell outcome');
    assert.equal(r.dimensions[0]!.failingOutcomes, 0, 'premise: the filtered run passes');

    await assert.rejects(
      () => fs.access(path.join(getLedgerDir(cwd), 'd.json')),
      'a filtered run must not snapshot the full declared set',
    );
  });
});

// ── Task 2: validate persists derived DECREASES (the rank-8 split-brain fix) ──

describe('validate persists derived decreases', () => {
  it('a failing re-run lowers the PERSISTED derived score (no stale inflated value survives)', async () => {
    const cwd = await mkTmp();
    await gitInit(cwd);
    const mPath = await writeMatrix(cwd, [outcome('p')]);

    // Run 1: passing → derived persisted.
    await runValidateCli({ dimId: 'd', cwd, forceCold: true, _onProgress: () => {}, _createTimeMachineCommit: null });
    const after1 = JSON.parse(await fs.readFile(mPath, 'utf8')) as { dimensions: Array<{ scores: Record<string, number>; outcomes: Array<Record<string, unknown>> }> };
    const derived1 = after1.dimensions[0]!.scores['derived'];
    assert.ok(typeof derived1 === 'number' && derived1 > 0, `passing run persists a positive derived, got ${derived1}`);

    // Regression: the SAME outcome id now fails. The old write-back guard
    // (`failingOutcomes === 0 && scoreAfter > 0`) skipped failing runs, so the stale
    // inflated derived sat in matrix.json while live derivation said lower.
    after1.dimensions[0]!.outcomes[0]!['command'] = 'node -e "process.exit(1)"';
    await fs.writeFile(mPath, JSON.stringify(after1, null, 2));
    invalidateMatrixCache();

    const r2 = await runValidateCli({ dimId: 'd', cwd, forceCold: true, _onProgress: () => {}, _createTimeMachineCommit: null });
    assert.equal(r2.allPassed, false, 'premise: the re-run fails');

    const after2 = JSON.parse(await fs.readFile(mPath, 'utf8')) as { dimensions: Array<{ scores: Record<string, number> }> };
    const derived2 = after2.dimensions[0]!.scores['derived'];
    assert.ok(typeof derived2 === 'number', 'the failing run must still persist derived');
    assert.ok(derived2! < derived1!, `persisted derived must DECREASE (was ${derived1}, now ${derived2})`);
    assert.equal(
      derived2,
      Math.round(r2.dimensions[0]!.scoreAfter * 100) / 100,
      'the persisted value equals the freshly recomputed (lower) score',
    );

    // And the failing run did not overwrite the gate-confirmed ledger snapshot:
    const ledger = await loadDeclarations(cwd, 'd');
    assert.ok(ledger, 'run-1 snapshot still present');
    assert.equal(
      (ledger![0] as unknown as { command: string }).command,
      'node -e "process.exit(0)"',
      'the ledger keeps the LAST GATE-CONFIRMED snapshot — a failing run never overwrites it',
    );
  });
});
