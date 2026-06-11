// tests/zoo/zoo.test.ts — THE FLEET ZOO (docs/SEAM_HARDENING_PLAN.md, Component 2).
//
// Five fixture repos replicating the fleet's REAL shapes, each driven through the REAL chain:
// runAscendFrontier with the work layer seamed (scripted builders/judges via the documented
// _runSetup/_runBuildTo7/_runPushTo9/_discoverMembers seams) while the coordination layer stays
// real — bootstrap (real defineUniverse), preflight, the planner, ceiling receipts, the run
// ledger, the declarations snapshot diff. The cheap real sub-steps (evidence-scaffold,
// ground-outcomes, validate) run for real IN-PROCESS inside the seams, exactly mirroring the
// commands the production setup/build phases shell out to.
//
// HONESTY RULE: every law carries a NEGATIVE control where feasible — the bug condition is
// re-introduced through fixtures/seams and the harness must DETECT it, proving the assertions
// can actually catch their target class (a test that cannot fail is worse than no test).

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runAscendFrontier, type PushResult } from '../../src/cli/commands/ascend-frontier.js';
import { runEvidenceScaffold } from '../../src/cli/commands/evidence-scaffold.js';
import { runValidateCli, type ValidateCliResult } from '../../src/cli/commands/validate.js';
import {
  setupWorktree, teardownWorktree, defaultWorktreeDeps, type WorktreeDeps,
} from '../../src/cli/commands/autoresearch-worktree.js';
import { createAgentWorktree, removeAgentWorktree } from '../../src/utils/worktree.js';
import { loadRunBundle, type EvidenceBundle } from '../../src/core/run-ledger.js';
import { loadMatrix, invalidateMatrixCache, type CompeteMatrix } from '../../src/core/compete-matrix.js';
import { groundOutcomes, PRODUCT_RUN_GROUNDING_NOTE } from '../../src/core/outcome-grounding.js';
import { checkOutcomeIntegrity, integrityCapFor } from '../../src/matrix/engines/outcome-integrity.js';
import { tombstoneDeclaration, loadLedgerEntry } from '../../src/core/declarations-ledger.js';
import { loadAllCeilingReceipts } from '../../src/core/ceiling-receipt.js';
import type { CouncilMemberId } from '../../src/matrix/engines/council-scheduler.js';
import * as zoo from './fixtures.js';

after(async () => { await zoo.removeZooRoot(); });

// ── shared seam helpers ──────────────────────────────────────────────────────

const discoverOneMember = async (): Promise<CouncilMemberId[]> => ['codex'];

/** Push seam that records invocations; every zoo run stays sub-frontier, so a single push
 *  call is itself a finding (a dim crossed 7.0 on no evidence). */
function recordingPush(counter: { pushes: number }): (cwd: string, dimId: string) => Promise<PushResult> {
  return async (_cwd, dimId) => {
    counter.pushes++;
    return { verdict: 'REJECTED', courtRan: false, fingerprint: { dimId, command: '', artifactPath: '', gitSha: null } };
  };
}

async function persistRawMatrix(cwd: string, matrix: zoo.ZooMatrix): Promise<void> {
  await fs.writeFile(zoo.matrixPath(cwd), JSON.stringify(matrix, null, 2) + '\n', 'utf8');
  invalidateMatrixCache();
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

function eventTypes(bundle: EvidenceBundle): string[] {
  return bundle.events.map(e => e.eventType);
}

async function assertBundleComplete(runId: string, cwd: string): Promise<EvidenceBundle> {
  const runDir = path.join(cwd, '.danteforge', 'runs', runId);
  const summary = await fs.readFile(path.join(runDir, 'summary.md'), 'utf8');
  assert.ok(summary.includes('# Run Summary'), 'summary.md written and well-formed');
  const commands = JSON.parse(await fs.readFile(path.join(runDir, 'commands.json'), 'utf8'));
  assert.ok(Array.isArray(commands), 'commands.json written and well-formed');
  const events = await fs.readFile(path.join(runDir, 'events.jsonl'), 'utf8');
  assert.ok(events.trim().length > 0, 'events.jsonl written with at least the run_start event');
  const bundle = await loadRunBundle(runId, cwd);
  assert.ok(bundle, 'bundle.json loads');
  return bundle!;
}

// ── zoo-cold ─────────────────────────────────────────────────────────────────

describe('zoo-cold — zero-dep BOM repo, no .danteforge, full cold chain', () => {
  test('define(bootstrap) right-sizes the matrix, preflight reads the BOM manifest, terminal is honest, bundle complete', async () => {
    const dir = await zoo.buildColdZoo();
    const counter = { pushes: 0 };
    const setupRounds: string[][] = [];
    let buildRounds = 0;

    const r = await runAscendFrontier({
      cwd: dir, maxCycles: 80, maxAttemptsPerDim: 1, maxBuildAttempts: 1,
      _discoverMembers: discoverOneMember,
      // The real setup sub-step, in-process: evidence-scaffold writes capability_tests +
      // outcome scaffolds into the freshly-defined matrix (the chain's cheapest real work).
      _runSetup: async (c, dims) => {
        setupRounds.push([...dims]);
        await runEvidenceScaffold({ cwd: c, _createTimeMachineCommit: null });
        invalidateMatrixCache();
      },
      _runBuildTo7: async () => { buildRounds++; }, // scripted builder: produces nothing, honestly
      _runPushTo9: recordingPush(counter),
    });

    assert.equal(r.terminal, 'done', `cold chain ends honestly (got ${r.terminal}: ${r.summary})`);
    assert.equal(r.actions[0], 'define(bootstrap)', 'Phase A define ran first on the cold repo');
    assert.ok(r.runId, 'a real run surfaces its ledger id');

    // Right-sizing pin: a cold repo outside the AI-coding domain gets the ~19 core scorer dims,
    // NEVER the 49-dim over-scaffold (core + 30 curated market dims) the fleet hit.
    const matrix = await zoo.readRawMatrix(dir);
    assert.ok(matrix.dimensions.length >= 15 && matrix.dimensions.length <= 25,
      `right-sized core matrix expected (~19 dims), got ${matrix.dimensions.length}`);
    assert.ok(matrix.dimensions.length < 40, 'must NOT be the 49-dim over-scaffold');

    const bundle = await assertBundleComplete(r.runId!, dir);
    const define = bundle.events.find(e => e.eventType === 'define');
    assert.ok(define, 'the define(bootstrap) phase is ledgered');
    assert.equal(define!.data['dimensions'], matrix.dimensions.length, 'define event reports the real dim count');
    const preflight = bundle.events.find(e => e.eventType === 'preflight');
    assert.ok(preflight, 'preflight ran and was ledgered');
    const notes = (preflight!.data['notes'] as string[]).join(' | ');
    assert.ok(notes.includes('zero declared dependencies'),
      `the BOM zero-dep manifest is read correctly (node_modules NOT required): ${notes}`);

    // Specificity control for the declarations law: a setup pass that only ADDS outcomes
    // (scaffold) must emit NO declarations-lost event — the detector is not a constant alarm.
    assert.ok(!eventTypes(bundle).includes('declarations-lost'),
      'scaffold-only setup loses nothing — no declarations-lost event');

    // Terminal honesty: every dim carries a signed ceiling receipt at its honest (unverified)
    // score — no dim was waved through, and the push court was never even approached.
    const receipts = await loadAllCeilingReceipts(dir);
    assert.equal(receipts.length, matrix.dimensions.length, 'every dim is ceilinged, none faked green');
    for (const c of receipts) assert.ok(c.cap <= 5.0, `${c.dimId} held at its honest unverified score (cap ${c.cap})`);
    assert.equal(counter.pushes, 0, 'no dim reached push-to-9 on zero evidence');
    assert.ok(setupRounds.length >= 1 && setupRounds[0]!.length === matrix.dimensions.length,
      'the first setup round covered the whole fresh matrix');
    assert.ok(buildRounds >= 1, 'the build phase genuinely ran (and honestly produced nothing)');
    assert.equal(bundle.verdict.status, 'success');
    assert.ok(r.summary.includes('honest ceiling'), 'the terminal summary names the honest ceilings');
  });
});

// ── zoo-dantesecurity ────────────────────────────────────────────────────────

describe('zoo-dantesecurity — polyglot harness repo (Cargo.toml + pyproject, 30 dims)', () => {
  test('grounding annotates product runs (never de-tiers), validate ledgers cap-enforced-clean earns, cargo receipts are shared-visible', async () => {
    const dir = await zoo.buildDanteSecurityZoo();
    const counter = { pushes: 0 };
    let ledgerValidate: ValidateCliResult | null = null;
    let seamedValidate: ValidateCliResult | null = null;

    const r = await runAscendFrontier({
      cwd: dir, maxCycles: 80, maxAttemptsPerDim: 1, maxBuildAttempts: 1,
      _discoverMembers: discoverOneMember,
      // Mirrors the real setup phase: ground-outcomes --apply (real engine) then scaffold the
      // one un-scaffolded dim (what evidence-scaffold would do).
      _runSetup: async (c) => {
        const raw = await zoo.readRawMatrix(c);
        await groundOutcomes({ matrix: raw as unknown as CompeteMatrix, projectPath: c });
        const dim = raw.dimensions.find(d => d.id === zoo.SEC_SETUP_DIM)!;
        dim.capability_test = { command: `python dante.py --check ${zoo.SEC_SETUP_DIM}`, description: 'scaffolded yardstick', timeoutMs: 30000 };
        dim.outcomes = [{
          id: `${zoo.SEC_SETUP_DIM}-t2`, kind: 'shell', tier: 'T2',
          description: 'unit-level check', command: `python dante.py --check ${zoo.SEC_SETUP_DIM}`,
          expected_exit: 0, timeout_ms: 30000, required_callsite: 'src/cli.py',
        }];
        await persistRawMatrix(c, raw);
      },
      // Mirrors a real depth wave: `danteforge validate <dim>` for the two pin dims.
      _runBuildTo7: async (c) => {
        if (ledgerValidate === null) {
          ledgerValidate = await runValidateCli({ dimId: zoo.SEC_LEDGER_DIM, cwd: c, _createTimeMachineCommit: null });
          seamedValidate = await runValidateCli({ dimId: zoo.SEC_SEAMED_DIM, cwd: c, _createTimeMachineCommit: null });
        }
      },
      _runPushTo9: recordingPush(counter),
    });

    assert.equal(r.terminal, 'done', `polyglot chain ends honestly (got ${r.terminal}: ${r.summary})`);

    // PIN 1 — grounding ANNOTATES product runs, never de-tiers them (fleet run 2 bug class).
    const matrix = await zoo.readRawMatrix(dir);
    const annotated = matrix.dimensions.find(d => d.id === zoo.SEC_ANNOTATE_DIM)!.outcomes![0]!;
    assert.equal(annotated.tier, 'T5', 'orphan-flagged T5 product run keeps its tier');
    assert.ok(annotated.description.includes(PRODUCT_RUN_GROUNDING_NOTE), 'the product run carries the annotation note');
    assert.equal(annotated.required_callsite, 'src/scanner.py', 'the callsite is kept, not stripped');
    const t4 = matrix.dimensions.find(d => d.id === zoo.SEC_LEDGER_DIM)!.outcomes![0]!;
    assert.equal(t4.tier, 'T4', 'orphan-flagged T4 product run is left alone entirely');

    // NEGATIVE control — the harness CAN see a de-tier when one genuinely happens: the
    // test-backed orphan (the case grounding legitimately downgrades) really moved to T2.
    const detiered = matrix.dimensions.find(d => d.id === zoo.SEC_DETIER_DIM)!.outcomes![0]!;
    assert.equal(detiered.tier, 'T2', 'test-backed orphan IS downgraded — tier changes are detectable here');
    assert.match(detiered.description, /downgraded to T2/, 'the downgrade carries provenance in the description');

    // PIN 2 — the inert-ledger pin: after a passing validate, the declarations ledger RECORDS
    // the cap-enforced-clean earn (orphan flags are score BOUNDS, not recording blockers).
    assert.ok(ledgerValidate, 'the depth wave ran validate');
    const lv = ledgerValidate as unknown as ValidateCliResult;
    const ledgerDim = lv.dimensions.find(d => d.dimensionId === zoo.SEC_LEDGER_DIM)!;
    assert.equal(ledgerDim.failingOutcomes, 0, 'the T4 product run genuinely passed');
    assert.ok(ledgerDim.scoreAfter <= 7.0, 'the orphan-bounded earn never exceeds the 7.0 cap');
    const entry = await loadLedgerEntry(dir, zoo.SEC_LEDGER_DIM);
    assert.ok(entry, 'the declarations ledger file exists for the cap-enforced-clean dim');
    assert.equal(entry!.recordedBy, 'validate-gate');
    assert.ok(entry!.outcomes.some(o => o.id === 'sec-001-t4-product-run'), 'the earned declaration is durable');

    // NEGATIVE control — a passing-but-SEAMED run (dishonesty class) is REFUSED by the ledger:
    // re-introducing the bug condition (laundering dishonest evidence into durability) is caught.
    const sv = seamedValidate as unknown as ValidateCliResult;
    const seamedDim = sv.dimensions.find(d => d.dimensionId === zoo.SEC_SEAMED_DIM)!;
    assert.equal(seamedDim.failingOutcomes, 0, 'the seamed outcome exits green — that is exactly the trap');
    assert.equal(seamedDim.integrityCap, 'SEAM_USAGE', 'the integrity gate caps the seamed evidence');
    assert.equal(await loadLedgerEntry(dir, zoo.SEC_SEAMED_DIM), null,
      'the ledger refuses to record the seamed dim — dishonest evidence cannot become durable');

    // PIN 3 — polyglot receipts: one cargo target claimed by 3 dims is ONE receipt, and the
    // shared-receipt detector sees the collision through the cargo pseudo-identifier.
    const report = await checkOutcomeIntegrity(
      matrix.dimensions as unknown as Parameters<typeof checkOutcomeIntegrity>[0], dir);
    for (const id of zoo.SEC_CARGO_DIMS) {
      assert.ok(report.sharedReceiptDims.includes(id), `${id} is flagged for sharing the cargo target`);
    }
    assert.ok(report.violations.some(v => v.kind === 'SHARED_RECEIPT' && v.detail.includes('cargo-test:')),
      'the collision is keyed on the canonical cargo-test pseudo-identifier');
    // …and the orphan flag on the annotated product run is a CAP (7.0), never a de-tier.
    assert.ok(report.orphanDims.includes(zoo.SEC_ANNOTATE_DIM));
    const capped = integrityCapFor(8.0, zoo.SEC_ANNOTATE_DIM, report);
    assert.equal(capped.cappedScore, 7.0);
    assert.equal(capped.integrityCap, 'ORPHAN_CALLSITE');

    const bundle = await assertBundleComplete(r.runId!, dir);
    assert.ok(!eventTypes(bundle).includes('declarations-lost'),
      'grounding annotated/downgraded with provenance — it never silently REMOVED a declaration');
    assert.equal(counter.pushes, 0, 'no dim reached the court');
  });
});

// ── zoo-danteagents ──────────────────────────────────────────────────────────

describe('zoo-danteagents — Node monorepo, barrel-wired callsites, prior-session ledger', () => {
  test('a setup matrix rewrite is tombstone-or-event (never silent), and orphan flags cap at 7.0 without de-tier', async () => {
    const dir = await zoo.buildDanteAgentsZoo();
    const counter = { pushes: 0 };

    const r = await runAscendFrontier({
      cwd: dir, maxCycles: 40, maxAttemptsPerDim: 1, maxBuildAttempts: 1,
      _discoverMembers: discoverOneMember,
      // Real grounding, then THE FLEET BUG re-introduced through the seam: the setup pass
      // rewrites matrix.json and drops a gate-confirmed declaration (DanteAgents run 1).
      _runSetup: async (c) => {
        const raw = await zoo.readRawMatrix(c);
        await groundOutcomes({ matrix: raw as unknown as CompeteMatrix, projectPath: c });
        const ledgered = raw.dimensions.find(d => d.id === zoo.DA_LEDGERED_DIM)!;
        ledgered.outcomes = []; // the silent wipe
        const setupDim = raw.dimensions.find(d => d.id === zoo.DA_SETUP_DIM)!;
        setupDim.capability_test = { command: 'node packages/core/src/main.js --setup-check', description: 'scaffolded yardstick', timeoutMs: 30000 };
        setupDim.outcomes = [{
          id: 'da-setup-t2', kind: 'shell', tier: 'T2', description: 'unit-level check',
          command: 'node -e "console.log(\'setup t2\')"', expected_exit: 0, timeout_ms: 30000,
          required_callsite: 'packages/core/src/engine.ts',
        }];
        await persistRawMatrix(c, raw);
      },
      _runBuildTo7: async () => { /* scripted builder: no progress */ },
      _runPushTo9: recordingPush(counter),
    });

    assert.equal(r.terminal, 'done', `monorepo chain ends honestly (got ${r.terminal}: ${r.summary})`);

    // LAW (event arm): the loss was DETECTED and ledgered loudly — and with PRECISION: exactly
    // the wiped declaration, not the added/annotated ones (the detector is not a constant alarm).
    const bundle = await assertBundleComplete(r.runId!, dir);
    const lost = bundle.events.find(e => e.eventType === 'declarations-lost');
    assert.ok(lost, 'a setup rewrite that drops a declaration MUST emit a declarations-lost event');
    assert.deepEqual(lost!.data['lost'], [`${zoo.DA_LEDGERED_DIM}/${zoo.DA_LOST_OUTCOME}`],
      'the event names exactly the lost declaration — nothing more, nothing less');

    // LAW (durability arm): the prior-session ledger restores BOTH earns at read time — the
    // wipe never reached the durable record.
    invalidateMatrixCache();
    const restored = await loadMatrix(dir);
    const ids = ((restored!.dimensions.find(d => d.id === zoo.DA_LEDGERED_DIM) as unknown as
      { outcomes?: Array<{ id: string }> }).outcomes ?? []).map(o => o.id);
    assert.ok(ids.includes(zoo.DA_LOST_OUTCOME), 'the wiped declaration is overlay-restored from the ledger');
    assert.ok(ids.includes(zoo.DA_LEDGER_ONLY_OUTCOME), 'the prior-session earn the matrix never had is restored too');

    // LAW (tombstone arm): a SANCTIONED removal stays removed — tombstone-or-event, both honest.
    const tomb = await tombstoneDeclaration(dir, zoo.DA_LEDGERED_DIM, zoo.DA_LEDGER_ONLY_OUTCOME, 'retired by operator');
    assert.equal(tomb.ok, true);
    invalidateMatrixCache();
    const afterTomb = await loadMatrix(dir);
    const idsAfter = ((afterTomb!.dimensions.find(d => d.id === zoo.DA_LEDGERED_DIM) as unknown as
      { outcomes?: Array<{ id: string }> }).outcomes ?? []).map(o => o.id);
    assert.ok(idsAfter.includes(zoo.DA_LOST_OUTCOME), 'the un-tombstoned earn survives');
    assert.ok(!idsAfter.includes(zoo.DA_LEDGER_ONLY_OUTCOME), 'the tombstoned earn never resurrects');

    // Orphan flags CAP at 7.0 without de-tier: the barrel-unreachable callsite is flagged,
    // the barrel-WIRED one is not, and the flagged product run keeps its T5.
    const raw = await zoo.readRawMatrix(dir);
    const orphanOutcome = raw.dimensions.find(d => d.id === zoo.DA_ORPHAN_DIM)!.outcomes![0]!;
    assert.equal(orphanOutcome.tier, 'T5', 'orphan-flagged product run keeps T5 (annotated, never de-tiered)');
    assert.ok(orphanOutcome.description.includes(PRODUCT_RUN_GROUNDING_NOTE));
    const report = await checkOutcomeIntegrity(
      raw.dimensions as unknown as Parameters<typeof checkOutcomeIntegrity>[0], dir);
    assert.ok(report.orphanDims.includes(zoo.DA_ORPHAN_DIM), 'the unreachable callsite is orphan-flagged');
    assert.ok(!report.orphanDims.includes(zoo.DA_BARREL_DIM), 'the barrel-wired callsite is NOT orphan-flagged');
    const cap = integrityCapFor(8.0, zoo.DA_ORPHAN_DIM, report);
    assert.equal(cap.cappedScore, 7.0, 'orphan bound = 7.0 cap');
    assert.equal(cap.integrityCap, 'ORPHAN_CALLSITE');
    const noCap = integrityCapFor(8.0, zoo.DA_BARREL_DIM, report);
    assert.equal(noCap.integrityCap, undefined, 'the wired dim is not capped');
    assert.equal(counter.pushes, 0);
  });
});

// ── zoo-dantecode ────────────────────────────────────────────────────────────

describe('zoo-dantecode — broken pre-commit + dirty derived cache', () => {
  test('the run proceeds without committing, plans on honest scores (not the dirty cache), and never crashes', async () => {
    const dir = await zoo.buildDanteCodeZoo();

    // The pre-commit pipeline is verifiably BROKEN: any commit attempt fails loudly. This is
    // also the negative control for the no-commit law — had the autopilot tried to commit,
    // the hook would have rejected it and the rev count below could never move.
    await assert.rejects(
      () => zoo.git(dir, ['commit', '--allow-empty', '-m', 'hook probe']),
      'the broken pre-commit hook rejects every commit',
    );
    const commitsBefore = await zoo.revCount(dir);

    // Dirty-derived pin: matrix.json persists derived=8.6 with ZERO evidence on disk; the
    // honest read drops it (raw file keeps the dirt — the dishonesty is real and on disk).
    invalidateMatrixCache();
    const honest = await loadMatrix(dir);
    for (const d of honest!.dimensions) {
      assert.equal(d.scores['derived'], undefined, `${d.id}: the stale derived cache is dropped at read time`);
    }
    const rawBefore = await zoo.readRawMatrix(dir);
    assert.equal(rawBefore.dimensions[0]!.scores['derived'], 8.6, 'the dirt is really in the file');

    const counter = { pushes: 0 };
    let buildRounds = 0;
    const r = await runAscendFrontier({
      cwd: dir, maxCycles: 30, maxAttemptsPerDim: 1, maxBuildAttempts: 1,
      _discoverMembers: discoverOneMember,
      _runBuildTo7: async () => { buildRounds++; },
      _runPushTo9: recordingPush(counter),
    });

    assert.equal(r.terminal, 'done', `run completes honestly despite the broken hook (got ${r.terminal}: ${r.summary})`);
    assert.ok(buildRounds >= 1, 'the build phase ran');
    assert.equal(await zoo.revCount(dir), commitsBefore,
      'the autopilot created NO commits — committing is not its job, and the broken hook never crashed it');

    // Honest planning: every ceiling is signed at the unverified decision cap (5.0), never at
    // the fabricated 8.6 the dirty cache claimed.
    const receipts = await loadAllCeilingReceipts(dir);
    assert.equal(receipts.length, zoo.DC_DIMS.length, 'every dim ceilinged honestly');
    for (const c of receipts) {
      assert.equal(c.cap, 5.0, `${c.dimId}: held at the honest unverified cap, not the dirty 8.6`);
    }
    assert.equal(counter.pushes, 0, 'the fabricated 8.6 never bought a court appearance');

    const bundle = await assertBundleComplete(r.runId!, dir);
    assert.equal(bundle.verdict.status, 'success');
  });
});

// ── zoo-teardown ─────────────────────────────────────────────────────────────

describe('zoo-teardown — worktree junctions + workspace symlink chain (junction-wipe pin)', () => {
  function fixtureBoundDeps(): WorktreeDeps {
    // The real worktree implementation, with its documented _git seam bound to the FIXTURE
    // repo (the module-level default binds to process.cwd(), i.e. the real DanteForge
    // checkout — exactly the tree a zoo test must never address).
    return {
      ...defaultWorktreeDeps(),
      createWorktree: (agentName, opts) =>
        createAgentWorktree(agentName, { cwd: opts.cwd, branch: opts.branch, _git: zoo.gitRawFor(opts.cwd) }),
      removeWorktree: async (agentName, opts) => {
        await removeAgentWorktree(agentName, { cwd: opts.cwd, branch: opts.branch, _git: zoo.gitRawFor(opts.cwd) });
      },
    };
  }

  test('setupWorktree + teardownWorktree leave the host node_modules and packages byte-intact', async () => {
    const host = await zoo.buildTeardownZoo('teardown-host');
    const beforeNm = await zoo.snapshotTree(host.nodeModules);
    const beforePkg = await zoo.snapshotTree(host.packagesDir);
    assert.ok(beforeNm['left-pad/index.js']?.startsWith('sha1:'), 'fixture carries real dependency bytes');
    assert.ok(beforeNm['@scope/pkg']?.startsWith('link:'), 'fixture carries the workspace junction chain');

    const deps = fixtureBoundDeps();
    const session = await setupWorktree(host.dir, 'zoo-agent-a', 'zoo/teardown-a', deps);
    assert.ok(session, 'isolated worktree created');
    // The junction is live: reading THROUGH worktree/node_modules reaches the host's real deps.
    const throughJunction = await fs.readFile(
      path.join(session!.worktreePath, 'node_modules', 'left-pad', 'index.js'), 'utf8');
    assert.match(throughJunction, /leftPad/, 'worktree node_modules junction resolves into the host deps');

    await teardownWorktree(session!, host.dir, deps);

    assert.equal(await exists(session!.worktreePath), false, 'the worktree itself is gone');
    assert.deepEqual(await zoo.snapshotTree(host.nodeModules), beforeNm,
      'host node_modules is byte-intact after teardown (the junction-wipe pin)');
    assert.deepEqual(await zoo.snapshotTree(host.packagesDir), beforePkg,
      'host packages/ is byte-intact after teardown');
  });

  test('the raw git-worktree-remove path cannot reach the host through a live junction (blast radius contained)', async () => {
    const host = await zoo.buildTeardownZoo('teardown-host-raw');
    const sacrifice = await zoo.buildSacrificialJunction('teardown-sacrifice-raw');
    const beforeNm = await zoo.snapshotTree(host.nodeModules);
    const beforePkg = await zoo.snapshotTree(host.packagesDir);

    const wt = await createAgentWorktree('zoo-agent-b', {
      cwd: host.dir, branch: 'zoo/teardown-b', _git: zoo.gitRawFor(host.dir),
    });
    // A LIVE junction sits inside the worktree when the raw removal runs — pointed at the
    // sacrificial target so the experiment is safe whatever this git version does with it.
    await fs.symlink(sacrifice.target, path.join(wt, 'node_modules'), 'junction');

    await removeAgentWorktree('zoo-agent-b', {
      cwd: host.dir, branch: 'zoo/teardown-b', _git: zoo.gitRawFor(host.dir),
    });

    assert.deepEqual(await zoo.snapshotTree(host.nodeModules), beforeNm,
      'host node_modules untouched by the raw git worktree remove --force path');
    assert.deepEqual(await zoo.snapshotTree(host.packagesDir), beforePkg,
      'host packages/ untouched by the raw removal path');
  });

  test('NEGATIVE control — the snapshot rig detects a delete-through-junction wipe', async () => {
    const { target, junction } = await zoo.buildSacrificialJunction('teardown-sacrifice-neg');
    const before = await zoo.snapshotTree(target);
    assert.ok(before['left-pad/index.js'], 'sacrificial target starts with real content');

    // Re-introduce the bug class: a recursive delete THROUGH the junction resolves into the
    // target and destroys real content on the other side.
    await fs.rm(path.join(junction, 'left-pad'), { recursive: true, force: true });

    const afterWipe = await zoo.snapshotTree(target);
    assert.notDeepEqual(afterWipe, before, 'the rig MUST flag the wiped tree — proven able to detect');
    assert.equal(afterWipe['left-pad/index.js'], undefined, 'the wipe really crossed the junction');
    assert.equal(afterWipe['lodash/index.js'], before['lodash/index.js'],
      'the rig reports the precise blast radius (untouched content still matches)');
  });
});
