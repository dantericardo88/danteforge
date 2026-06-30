// ascend-rehearse.ts — rehearsal mode: run the FULL ascend-frontier coordination layer against a
// scripted synthetic repo, with the work layer stubbed by recording fakes. Minutes, zero LLM cost.
//
// Five of the six failure classes the fleet found live (seam plan, docs/SEAM_HARDENING_PLAN.md)
// were coordination bugs — contracts between verified components — that only a real end-to-end
// drive-through could catch. Rehearsal IS that drive-through, runnable before every live run:
// REAL planNextAction, REAL state builder (matrix + ceiling receipts + cause-aware re-opening),
// REAL attempt ledger + evidence novelty, REAL run-ledger bundle — only setup/build/push are
// scripted. The scenario covers the canonical arcs: a dim that builds to 7 then court-VALIDATES
// after its spec-incomplete ceiling re-opens, a dim the court REJECTS to a generator-ceiling via
// evidence-novelty exhaustion, a build-staller that earns an honest ceiling, a market-capped dim,
// and an already-validated dim. Every invariant is asserted from ON-DISK truth afterward.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../../core/logger.js';
import { loadCeilingReceipt } from '../../core/ceiling-receipt.js';
import { loadAttemptLedger } from '../../core/evidence-novelty.js';
import { runAscendFrontier } from './ascend-frontier.js';
import type { PushResult } from './ascend-frontier-push.js';

export interface RehearsalInvariant { name: string; ok: boolean; detail: string }
export interface RehearsalReport {
  ok: boolean;
  terminal: string;
  cycles: number;
  invariants: RehearsalInvariant[];
  recorded: { builds: number; pushes: number; setups: number };
  scratchDir: string;
}

export interface RehearseOptions {
  json?: boolean;
  /** Keep the scratch repo on disk for inspection (default: removed). */
  keep?: boolean;
  _scratchRoot?: string;
}

interface SyntheticDim {
  id: string;
  label: string;
  weight: number;
  scores: Record<string, number>;
  gap_to_leader: number;
  leader: string;
  status: string;
  sprint_history: unknown[];
  capability_test?: { command: string };
  outcomes?: Array<Record<string, unknown>>;
  frontier_spec?: Record<string, unknown>;
}

function spec(status: string): Record<string, unknown> {
  return {
    version: 1, target_score: 9, status,
    leader_target: { competitor: 'rehearsal-leader', score: 9, observed_capability: 'scripted competitor capability' },
    real_user_path: {
      required_callsite: 'src/rehearsal.ts', run_command: 'node dist/index.js rehearse {input}',
      observable_artifacts: [{ kind: 'file', path: 'out/rehearsal.json' }],
      realistic_inputs: ['alpha', 'beta'],
    },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
  };
}

// The scratch repo must satisfy the REAL read-time honesty machinery (the first rehearsal runs
// proved it fires here exactly as in production): loadMatrix recomputes scores.derived from
// on-disk evidence, deletes synthetic derived values with no receipts behind them, and
// decision-caps outcome-declaring dims at 5.0. So the fixture writes REAL-SHAPED receipts
// (.danteforge/outcome-evidence/nogit-<dim>-<outcome>.json, fresh ranAt) and lets the genuine
// derivation produce the scores — a T5 product-run outcome derives ~7-8, a T2 derives ~5.x.
function outcomeOf(id: string, tier: 'T2' | 'T5'): Record<string, unknown> {
  return { id: `${id}_${tier.toLowerCase()}`, tier, kind: 'runtime-exec', command: `node dist/index.js ${id}-probe`, required_callsite: 'src/rehearsal.ts' };
}
async function writeReceipt(cwd: string, dimId: string, outcomeId: string, tier: string, session: string): Promise<void> {
  const dir = path.join(cwd, '.danteforge', 'outcome-evidence');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `nogit-${dimId}-${outcomeId}.json`), JSON.stringify({
    dimensionId: dimId, outcomeId, tier, gitSha: null, passed: true, exitCode: 0,
    durationMs: 1200, ranAt: new Date().toISOString(), session_id: session,
    evidencePath: path.join(dir, `nogit-${dimId}-${outcomeId}.json`),
  }, null, 2), 'utf8');
}

function dim(id: string, self: number, tier: 'T2' | 'T5', overrides: Partial<SyntheticDim> = {}): SyntheticDim {
  return {
    id, label: id, weight: 1, scores: { self, 'rehearsal-leader': 9 },
    gap_to_leader: Math.max(0, 9 - self), leader: 'rehearsal-leader',
    status: 'in-progress', sprint_history: [],
    capability_test: { command: 'node -e "process.exit(0)"' },
    outcomes: [outcomeOf(id, tier)],
    ...overrides,
  };
}

async function readMatrix(cwd: string): Promise<{ dimensions: SyntheticDim[] } & Record<string, unknown>> {
  const raw = await fs.readFile(path.join(cwd, '.danteforge', 'compete', 'matrix.json'), 'utf8');
  return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
}
async function writeMatrix(cwd: string, m: unknown): Promise<void> {
  await fs.writeFile(path.join(cwd, '.danteforge', 'compete', 'matrix.json'), JSON.stringify(m, null, 2), 'utf8');
}

export async function runAscendRehearsal(options: RehearseOptions = {}): Promise<RehearsalReport> {
  const root = options._scratchRoot ?? os.tmpdir();
  const cwd = path.join(root, `danteforge-rehearse-${process.pid}-${Math.floor(performance.now() * 1000) % 1_000_000}`);
  await fs.mkdir(path.join(cwd, '.danteforge', 'compete'), { recursive: true });

  // ── The scripted cast ──────────────────────────────────────────────────────────
  await writeMatrix(cwd, {
    project: 'rehearsal', competitors: ['rehearsal-leader'],
    competitors_closed_source: ['rehearsal-leader'], competitors_oss: [],
    lastUpdated: new Date().toISOString(), overallSelfScore: 6,
    dimensions: [
      dim('hero_dim', 5.5, 'T2'),                                        // builds → spec-incomplete → re-open → VALIDATED
      dim('rejected_dim', 7.5, 'T5', { frontier_spec: spec('frozen') }), // court rejects ×2 novel, then non-novel → generator-ceiling
      dim('staller_dim', 4.0, 'T2'),                                     // build never moves → honest ceiling
      dim('token_economy', 4.5, 'T2'),                                   // canonical market dim → market-cap ceiling
      dim('done_dim', 9.0, 'T5', { frontier_spec: spec('validated') }),  // already at the validated frontier
    ],
  });
  // Fresh receipts so the REAL derivation produces the intended starting scores.
  await writeReceipt(cwd, 'hero_dim', 'hero_dim_t2', 'T2', 'rehearsal-s0');
  await writeReceipt(cwd, 'rejected_dim', 'rejected_dim_t5', 'T5', 'rehearsal-s0');
  await writeReceipt(cwd, 'staller_dim', 'staller_dim_t2', 'T2', 'rehearsal-s0');
  await writeReceipt(cwd, 'token_economy', 'token_economy_t2', 'T2', 'rehearsal-s0');
  await writeReceipt(cwd, 'done_dim', 'done_dim_t5', 'T5', 'rehearsal-s0');

  const recorded = { builds: 0, pushes: 0, setups: 0 };
  const heroPushes = { count: 0 };
  const rejectedPushes = { count: 0 };
  const seamCwds = new Set<string>();

  const result = await runAscendFrontier({
    cwd,
    maxCycles: 25,
    maxAttemptsPerDim: 3,
    maxBuildAttempts: 2,
    json: true, // suppress the human summary print; the rehearsal prints its own report
    _preflight: async (c) => { seamCwds.add(c); return { ok: true, notes: ['rehearsal: environment probing skipped (scripted work layer)'] }; },
    _runSetup: async (c, dims) => {
      seamCwds.add(c); recorded.setups += 1;
      // Setup "authors" capability scaffolding: give the dims a declared outcome so needsSetup clears.
      const m = await readMatrix(c);
      for (const d of m.dimensions) if (dims.includes(d.id)) d.outcomes = [{ id: `${d.id}_o1`, tier: 'T2', kind: 'shell', command: 'node -e "process.exit(0)"' }];
      await writeMatrix(c, m);
    },
    _runBuildTo7: async (c, dims) => {
      seamCwds.add(c); recorded.builds += 1;
      const m = await readMatrix(c);
      for (const d of m.dimensions) {
        if (!dims.includes(d.id)) continue;
        if (d.id === 'hero_dim') {
          // A real build that works: a T5 product-run outcome lands, with a fresh receipt — the
          // genuine derivation then lifts the dim past the build target. The self-score raise
          // routes through the REAL writeVerifiedScore (clamp + provenance), exactly like
          // production — the score-write gate structurally forbids any other path, here included.
          const { writeVerifiedScore } = await import('../../core/write-verified-score.js');
          writeVerifiedScore(m as never, 'hero_dim', 7.5,
            { agent: 'rehearsal-build', rationale: 'scripted build outcome (rehearsal scratch repo)', gatesPassed: { capability_test: true } });
          if (!d.outcomes!.some(o => o['id'] === 'hero_dim_t5')) d.outcomes!.push(outcomeOf('hero_dim', 'T5'));
          await writeReceipt(c, 'hero_dim', 'hero_dim_t5', 'T5', 'rehearsal-s1');
        }
        // staller_dim: scripted to never move — the loop must ceiling it honestly.
      }
      await writeMatrix(c, m);
    },
    _runPushTo9: async (c, dimId): Promise<PushResult> => {
      seamCwds.add(c); recorded.pushes += 1;
      const m = await readMatrix(c);
      const d = m.dimensions.find(x => x.id === dimId)!;
      if (dimId === 'hero_dim') {
        heroPushes.count += 1;
        if (heroPushes.count === 1) {
          // First push: the spec is unauthored — the honest ACTIONABLE ceiling. The "operator"
          // (scenario) then authors + freezes it, and the REAL cause-aware re-opening must fire.
          d.frontier_spec = spec('frozen');
          await writeMatrix(c, m);
          return {
            verdict: 'REJECTED', courtRan: false,
            ceiling: { cause: 'spec-incomplete', detail: 'rehearsal: real-user-path unauthored (scripted) — authored+frozen right after this push' },
            fingerprint: { dimId, command: '', artifactPath: '', gitSha: null },
          };
        }
        // Second push: evidence captured, court validates — exactly what the real court does on PASS.
        (d.frontier_spec as Record<string, unknown>)['status'] = 'validated';
        await writeMatrix(c, m);
        return { verdict: 'VALIDATED', courtRan: true, fingerprint: { dimId, command: `push-${heroPushes.count}`, artifactPath: 'out/rehearsal.json', gitSha: `sha-${heroPushes.count}` } };
      }
      if (dimId === 'rejected_dim') {
        rejectedPushes.count += 1;
        // Two NOVEL rejections (distinct fingerprints), then a NON-novel push — the evidence-novelty
        // ledger must convert that into a generator-ceiling instead of spinning.
        const novel = rejectedPushes.count <= 2 ? rejectedPushes.count : 2;
        return { verdict: 'REJECTED', courtRan: true, fingerprint: { dimId, command: `attempt-${novel}`, artifactPath: 'out/rehearsal.json', gitSha: `sha-r${novel}` } };
      }
      return { verdict: 'REJECTED', courtRan: false, fingerprint: { dimId, command: '', artifactPath: '', gitSha: null } };
    },
  });

  // ── Invariants, asserted from ON-DISK truth ────────────────────────────────────
  const invariants: RehearsalInvariant[] = [];
  const check = (name: string, ok: boolean, detail: string): void => { invariants.push({ name, ok, detail }); };

  const finalMatrix = await readMatrix(cwd);
  const hero = finalMatrix.dimensions.find(d => d.id === 'hero_dim')!;
  const attempts = await loadAttemptLedger(cwd);
  const heroCeiling = await loadCeilingReceipt(cwd, 'hero_dim');
  const rejectedCeiling = await loadCeilingReceipt(cwd, 'rejected_dim');
  const stallerCeiling = await loadCeilingReceipt(cwd, 'staller_dim');
  const marketCeiling = await loadCeilingReceipt(cwd, 'token_economy');

  check('terminates honestly', result.terminal === 'done',
    `terminal=${result.terminal} after ${result.cycles} cycles (every dim validated or actively ceilinged — never max-cycles)`);
  check('no spinning', result.cycles <= 15, `${result.cycles} cycles for a 5-dim scenario (bound 15)`);
  const heroSpecStatus = (hero.frontier_spec as Record<string, unknown> | undefined)?.['status'];
  check('hero validates after re-open', heroSpecStatus === 'validated' && heroPushes.count >= 2,
    `spec=${String(heroSpecStatus)}, pushes=${heroPushes.count} — the spec-incomplete ceiling resolved once frozen and the push re-ran`);
  check('hero validated attempt ledgered', attempts.some(a => a.dimId === 'hero_dim' && a.outcome === 'validated'),
    `attempt ledger has ${attempts.filter(a => a.dimId === 'hero_dim').length} hero entries`);
  check('hero carries no terminal ceiling', heroCeiling === null || heroCeiling.cause === 'spec-incomplete',
    `ceiling=${heroCeiling?.cause ?? 'none'} (a resolved spec-incomplete receipt may remain on disk; it must not be terminal)`);
  check('rejected dim earns generator-ceiling via novelty exhaustion', rejectedCeiling?.cause === 'generator-ceiling',
    `ceiling=${rejectedCeiling?.cause ?? 'none'} after ${rejectedPushes.count} pushes (2 novel rejections + 1 non-novel)`);
  check('rejected dim attempts recorded', attempts.filter(a => a.dimId === 'rejected_dim' && a.outcome === 'rejected').length >= 2,
    `${attempts.filter(a => a.dimId === 'rejected_dim').length} ledgered attempts`);
  check('staller earns an honest build ceiling', stallerCeiling?.cause === 'generator-ceiling',
    `ceiling=${stallerCeiling?.cause ?? 'none'} (build never moved the score; the loop must not spin)`);
  check('market dim ceilinged as market-cap', marketCeiling?.cause === 'market-cap', `ceiling=${marketCeiling?.cause ?? 'none'}`);
  check('work layer fully scripted', recorded.builds > 0 && recorded.pushes > 0,
    `builds=${recorded.builds} pushes=${recorded.pushes} setups=${recorded.setups} — all via recording seams, zero real subprocesses`);
  check('every seam ran in the scratch repo', [...seamCwds].every(c => path.resolve(c) === path.resolve(cwd)),
    `seam cwds: ${[...seamCwds].join(', ') || '(none)'}`);
  const bundleOk = await fs.access(path.join(cwd, '.danteforge', 'runs')).then(() => true).catch(() => false);
  check('run-ledger bundle written', bundleOk, '.danteforge/runs/<runId>/ exists in the scratch repo');

  const ok = invariants.every(i => i.ok);
  const report: RehearsalReport = { ok, terminal: result.terminal, cycles: result.cycles, invariants, recorded, scratchDir: cwd };

  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    logger.info('');
    logger.info(`[rehearse] coordination-layer drive-through: ${result.cycles} cycles, terminal=${result.terminal}`);
    for (const i of invariants) {
      if (i.ok) logger.success(`  ✓ ${i.name} — ${i.detail}`);
      else logger.error(`  ✗ ${i.name} — ${i.detail}`);
    }
    logger.info('');
    if (ok) logger.success(`[rehearse] PASS — the coordination layer is safe to point at a live repo.`);
    else logger.error(`[rehearse] FAIL — fix the coordination layer BEFORE a live run burns budget on it. Scratch repo kept: ${cwd}`);
  }

  if (ok && !options.keep) await fs.rm(cwd, { recursive: true, force: true }).catch(() => { /* scratch */ });
  return report;
}
