// LAW L5 — Evidence honor: execution-proven product-run evidence (runtime-exec / cli-smoke /
// e2e / shell PRODUCT commands) is NEVER de-tiered by an automated pass — bounding is only ever
// by CAP. Test-backed evidence may be downgraded only with provenance in changes[].
//
// Property-style sweep: kinds × (test-suite vs product command) × tiers T4–T8, driven through
// the REAL groundOutcomes engine over a real temp project whose callsites are deliberate orphans
// (so the integrity gate flags every dim — the worst-case grounding pressure).
//
// Pins fleet-run-2: groundOutcomes de-tiered 15 legitimate T5 product runs to T2 on DanteAgents
// because the wiring probe only understands TEST-backed commands.
//
// NEGATIVE CONTROL: the OLD behavior (de-tier everything flagged, no provenance) is replayed on
// the same fixture and the law checker is asserted to TRIP on both violation classes.

import { describe, test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { groundOutcomes, PRODUCT_RUN_GROUNDING_NOTE } from '../../src/core/outcome-grounding.js';
import { isTestSuiteCommand } from '../../src/matrix/engines/outcome-quality.js';
import type { CompeteMatrix } from '../../src/core/compete-matrix.js';
import {
  lawsTmpDir, rmrf, makeDim, makeMatrix, tierRank, checkEvidenceHonor, type SweepOutcomeShape,
} from './rig.js';

const ROOT = lawsTmpDir('l5');
const KINDS = ['shell', 'runtime-exec', 'cli-smoke', 'e2e'] as const;
const COMMAND_STYLES = ['test', 'product'] as const;
const TIERS = ['T4', 'T5', 'T6', 'T7', 'T8'] as const;

interface SweepDim { id: string; outcomes: SweepOutcomeShape[] }

function sweepDims(): SweepDim[] {
  const dims: SweepDim[] = [];
  let i = 0;
  for (const kind of KINDS) {
    for (const style of COMMAND_STYLES) {
      for (const tier of TIERS) {
        i++;
        const id = `dim_${kind.replace(/-/g, '_')}_${style}_${tier.toLowerCase()}`;
        dims.push({
          id,
          outcomes: [{
            id: `${id}-o1`,
            tier,
            kind,
            // Distinct commands per outcome — cross-dim SHARED_RECEIPT must not muddy the sweep.
            command: style === 'test'
              ? `npx tsx --test tests/sweep-${i}.test.ts`
              : `node bin/run-${i}.js --case ${i}`,
            required_callsite: 'src/orphan-mod.ts',
            description: `${kind}/${style}/${tier} sweep outcome`,
          }],
        });
      }
    }
  }
  return dims;
}

async function writeSweepProject(cwd: string, dimCount: number): Promise<void> {
  await fs.mkdir(path.join(cwd, 'tests'), { recursive: true });
  await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
  await fs.mkdir(path.join(cwd, 'bin'), { recursive: true });
  await fs.writeFile(path.join(cwd, 'package.json'), '{"name":"laws-l5-sweep"}', 'utf8');
  // The orphan callsite: exists, parses, imported by NOTHING — every T4+ outcome gets flagged.
  await fs.writeFile(path.join(cwd, 'src', 'orphan-mod.ts'), 'export const orphan = true;\n', 'utf8');
  for (let i = 1; i <= dimCount; i++) {
    await fs.writeFile(path.join(cwd, 'tests', `sweep-${i}.test.ts`),
      "import assert from 'node:assert';\nassert.ok(true);\n", 'utf8');
    await fs.writeFile(path.join(cwd, 'bin', `run-${i}.js`), 'process.exit(0);\n', 'utf8');
  }
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

before(async () => { await fs.mkdir(ROOT, { recursive: true }); });
after(async () => { await rmrf(ROOT); });

describe('L5 — property sweep through the REAL groundOutcomes engine', () => {
  test('product runs keep their tier; every test-backed downgrade carries changes[] provenance', async () => {
    const cwd = path.join(ROOT, 'sweep');
    const dims = sweepDims();
    assert.equal(dims.length, KINDS.length * COMMAND_STYLES.length * TIERS.length, 'full input space covered');
    await writeSweepProject(cwd, dims.length);

    const matrix = makeMatrix(dims.map(d => makeDim(d.id, { outcomes: d.outcomes } as never))) as CompeteMatrix;
    const beforeDims = clone(dims);

    const summary = await groundOutcomes({ matrix, projectPath: cwd });
    const afterDims = matrix.dimensions as unknown as SweepDim[];
    const changesByDim = new Map(summary.results.map(r => [r.dimId, r.changes]));

    // THE LAW — zero violations across the whole swept input space.
    assert.deepEqual(checkEvidenceHonor(beforeDims, afterDims, changesByDim), []);

    const afterById = new Map(afterDims.map(d => [d.id, d]));
    let productChecked = 0;
    let testDowngrades = 0;
    for (const before of beforeDims) {
      const b = before.outcomes[0]!;
      const a = afterById.get(before.id)!.outcomes[0]!;
      assert.equal(a.id, b.id);
      if (!isTestSuiteCommand(b.command ?? '')) {
        productChecked++;
        assert.equal(a.tier, b.tier, `${before.id}: product-run tier must survive grounding`);
        if (tierRank(b.tier) >= tierRank('T5')) {
          // T5+ flagged product runs are ANNOTATED (bounded by the orphan cap at score time) — never de-tiered.
          assert.ok((a.description ?? '').includes(PRODUCT_RUN_GROUNDING_NOTE),
            `${before.id}: flagged product run carries the annotation, got "${a.description}"`);
        }
      } else if (tierRank(a.tier) < tierRank(b.tier)) {
        testDowngrades++;
        assert.equal(a.tier, 'T2', `${before.id}: an un-grounded test-backed outcome lands at honest orphan-pending T2`);
        const lines = changesByDim.get(before.id) ?? [];
        assert.ok(lines.some(l => l.includes(b.id) && l.includes('T2')),
          `${before.id}: downgrade provenance present in changes[]: ${JSON.stringify(lines)}`);
      }
      assert.ok(tierRank(a.tier) <= tierRank(b.tier), `${before.id}: grounding may never RAISE a tier`);
    }
    // Non-vacuous: the sweep genuinely exercised both halves of the law.
    assert.equal(productChecked, KINDS.length * TIERS.length, 'every product-run combo was checked');
    assert.ok(testDowngrades >= TIERS.filter(t => tierRank(t) >= tierRank('T5')).length * KINDS.length,
      `the orphan fixture really forced test-backed downgrades (got ${testDowngrades})`);

    // Idempotency: a second pass changes NOTHING (the annotation marker is the guard).
    const afterFirst = clone(afterDims);
    const summary2 = await groundOutcomes({ matrix, projectPath: cwd });
    assert.deepEqual(checkEvidenceHonor(afterFirst, matrix.dimensions as unknown as SweepDim[],
      new Map(summary2.results.map(r => [r.dimId, r.changes]))), []);
    for (const d of matrix.dimensions as unknown as SweepDim[]) {
      const o = d.outcomes[0]!;
      const note = (o.description ?? '').split(PRODUCT_RUN_GROUNDING_NOTE).length - 1;
      assert.ok(note <= 1, `${d.id}: the annotation is appended at most once (idempotent), found ${note}`);
    }
  });
});

describe('L5 — NEGATIVE control: the OLD de-tier-everything behavior TRIPS the law', () => {
  test('replaying the fleet-run-2 shape (product runs de-tiered, no provenance) is caught on both axes', () => {
    const beforeDims = sweepDims();
    const legacyAfter = clone(beforeDims);
    // The pre-fix behavior: every flagged T5+ outcome is blindly de-tiered to T2 with the
    // callsite stripped — product runs included — and nothing is recorded.
    for (const d of legacyAfter) {
      for (const o of d.outcomes) {
        if (tierRank(o.tier) >= tierRank('T5')) {
          o.tier = 'T2';
          delete o.required_callsite;
        }
      }
    }
    const violations = checkEvidenceHonor(beforeDims, legacyAfter, new Map());
    const deTiered = violations.filter(v => v.kind === 'product-run-de-tiered');
    const undocumented = violations.filter(v => v.kind === 'undocumented-downgrade');
    assert.ok(deTiered.length >= KINDS.length * TIERS.filter(t => tierRank(t) >= tierRank('T5')).length,
      `every de-tiered product run is flagged (got ${deTiered.length})`);
    assert.ok(undocumented.length >= deTiered.length,
      'every undocumented downgrade is flagged — silent re-tiering can never pass this law');
  });
});
