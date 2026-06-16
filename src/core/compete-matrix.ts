// compete-matrix.ts — Persistent matrix for the Competitive Harvest Loop (CHL)
// Tracks self vs competitor scores per dimension, sprint history, and next-sprint selection.
// The matrix is the "strategy layer" on top of the existing competitor-scanner execution layer.
//
// Two-matrix structure (from the CHL design):
//   - competitors_closed_source: Cursor, Copilot, Devin — what users pay for, gold standard
//   - competitors_oss: Aider, Continue.dev, Tabby — what you can legally harvest
// This distinction drives the sprint strategy: harvest from OSS leader, aim toward closed-source leader.

import fs from 'fs/promises';
import path from 'path';
import os from 'node:os';

const STATE_DIR = '.danteforge';
const COMPETE_DIR = 'compete';
const MATRIX_FILE = 'matrix.json';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SprintRecord {
  dimensionId: string;
  before: number;          // self score before sprint (0-10)
  after: number;           // self score after sprint (0-10)
  date: string;            // ISO date string
  commit?: string;         // git SHA for PDSE audit trail
  harvestSource?: string;  // OSS repo that was harvested
}

export type DimensionStatus = 'not-started' | 'in-progress' | 'closed';

export interface MatrixDimension {
  id: string;              // snake_case e.g. "spec_driven_pipeline"
  label: string;           // human-readable label
  weight: number;          // importance multiplier (default 1.0; high-frequency = 1.5)
  category: string;        // "performance" | "ux" | "features" | "reliability" | "quality"
  frequency: 'high' | 'medium' | 'low';
  scores: Record<string, number>; // { self: 4.5, cursor: 9.0, aider: 7.0 }

  // Primary gap (vs best competitor overall — backward compat)
  gap_to_leader: number;   // max(all competitor scores) - self score (0 if leading)
  leader: string;          // competitor name with highest score

  // Two-matrix split — the core CHL insight
  gap_to_closed_source_leader: number; // gap vs best closed-source (gold standard)
  closed_source_leader: string;        // e.g. "Cursor" at 9.2
  gap_to_oss_leader: number;           // gap vs best OSS (harvestable)
  oss_leader: string;                  // e.g. "Aider" at 7.0

  status: DimensionStatus;
  sprint_history: SprintRecord[];
  next_sprint_target: number; // target self score for next sprint
  harvest_source?: string;    // recommended OSS project to harvest from

  // Ceiling classification — max score achievable via automation
  ceiling?: number;           // if set, ascend will not attempt to push self score beyond this
  ceilingReason?: string;     // human-readable explanation (e.g. "requires external users")

  // Closing strategy — how to close this dimension
  closingStrategy?: 'code' | 'human' | 'ceiling';
  manualActionHint?: string;  // specific action for 'human' strategy dims

  // Explicit touches — file/dir paths this dimension owns. When set, overrides
  // the dimension-synthesizer's heuristic token-match inference. Use this when
  // your dimension ID doesn't share tokens with the file paths it should scope.
  touches?: string[];

  // Evidence provenance for competitor leader scores.
  // 'llm-baseline': initial score was an LLM estimate
  // 'github-evidence': adjusted down from real open-issue counts
  // 'benchmark': set from a published benchmark result
  leaderScoreSource?: Record<string, 'llm-baseline' | 'github-evidence' | 'benchmark'>;
}

export interface AdversarialCalibration {
  dimensionId: string;
  beforeScore: number;
  afterScore: number;
  adversarialScore: number;
  verdict: 'inflated' | 'trusted' | 'watch' | 'underestimated';
  rationale: string;
  date: string;
}

/**
 * One row in the score-provenance audit trail. Every `scores.self` write — from
 * any code path — produces one of these, recording who wrote it, the raw value
 * before clamping, the final value after, and which gates (if any) were proven.
 * The trail is the structural complement to the single `writeVerifiedScore` gate:
 * the gate makes a bypass impossible to write, this makes every legitimate write
 * auditable after the fact. Persisted with the matrix (capped to the last 200).
 */
export interface ScoreProvenanceEntry {
  dimensionId: string;
  agent: string;          // 'merge' | 'score-audit' | 'daemon-calibration' | 'ascend-orient' | …
  before: number;         // self score before this write
  after: number;          // self score after clamp + backstop
  rawScore: number;       // the pre-clamp value the caller proposed
  rationale?: string;
  evidence?: string[];
  gatesPassed?: { capability_test?: boolean; harden?: boolean };
  date: string;           // ISO timestamp
}

export interface CompeteMatrix {
  project: string;

  // Flat list (backward compat + quick lookup)
  competitors: string[];

  // Two-matrix split — the strategy layer
  competitors_closed_source: string[]; // Cursor, Copilot Workspace, Devin…
  competitors_oss: string[];           // Aider, Continue.dev, Tabby…

  lastUpdated: string;
  overallSelfScore: number;    // weighted average across all dimensions (0-10)
  dimensions: MatrixDimension[];

  // Adversarial calibration history — records when hostile-review verdicts
  // were applied to correct inflated self-scores.
  adversarialCalibrations?: AdversarialCalibration[];

  // Score-provenance audit trail — one entry per `scores.self` write, produced
  // by the single `writeVerifiedScore` gate. Capped to the last 200 entries.
  scoreProvenance?: ScoreProvenanceEntry[];

  // Dimensions the user has explicitly de-prioritized. Excluded dimensions
  // remain in the matrix for scoring continuity but are skipped by sprint
  // selection, work-packet generation, and gap-report ranking. Reverse with
  // `danteforge compete --include <id>`.
  excludedDimensions?: string[];
}

// ── Path Helpers ──────────────────────────────────────────────────────────────

export function getMatrixPath(cwd?: string): string {
  const base = cwd ?? process.cwd();
  return path.join(base, STATE_DIR, COMPETE_DIR, MATRIX_FILE);
}

// ── Persistence ───────────────────────────────────────────────────────────────

// In-memory TTL cache: avoids re-parsing the matrix JSON on every call
// within a single process (e.g. crusade frontier loop calling loadMatrix per cycle).
const MATRIX_CACHE_TTL_MS = 5_000; // 5 s — short enough to pick up saves
interface MatrixCacheEntry { matrix: CompeteMatrix; expiresAt: number; path: string; mtimeMs: number; size: number }
let _matrixCache: MatrixCacheEntry | null = null;

/** Invalidate the in-process matrix cache (called by saveMatrix). */
export function invalidateMatrixCache(): void {
  _matrixCache = null;
}

export async function loadMatrix(
  cwd?: string,
  _fsRead?: (p: string) => Promise<string>,
): Promise<CompeteMatrix | null> {
  const matrixPath = getMatrixPath(cwd);

  // Return cached value if still valid and no injection override is active.
  // Subprocess-write seam (fleet run 3b): a CHILD process (frontier-spec init --write, validate)
  // rewrites matrix.json on disk while this process's cache is warm — TTL alone left the parent
  // blind to the child's write for up to 5s, which silently voided whole ascend push cycles
  // (spec0 read as missing right after init wrote it). Trust the cache only while the file is
  // byte-identical by mtime+size; any on-disk change forces a fresh read immediately.
  if (!_fsRead && _matrixCache && _matrixCache.path === matrixPath && Date.now() < _matrixCache.expiresAt) {
    try {
      const st = await fs.stat(matrixPath);
      if (st.mtimeMs === _matrixCache.mtimeMs && st.size === _matrixCache.size) {
        return _matrixCache.matrix;
      }
    } catch { /* stat failed (file replaced/deleted mid-swap) — fall through to a fresh read */ }
  }

  const read = _fsRead ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const raw = await read(matrixPath);
    const matrix = JSON.parse(raw) as CompeteMatrix;

    // Phase F: outcome-derived scoring. For any dim that declares `outcomes`,
    // replace `scores.self` with the score computed from the current outcome
    // evidence on disk. The original writable value is preserved at
    // `legacy_score` for transition diff display. This is the read-time
    // honesty enforcement — every consumer of loadMatrix sees the derived
    // value, never the agent-written one.
    //
    // The declarations-ledger overlay runs FIRST (before derived scoring) so a dim whose
    // gate-confirmed outcomes[] were wiped by a git reset / matrix rewrite re-derives from
    // its restored declarations + the evidence still on disk. Like applyOutcomeDerivedScores,
    // the overlay is skipped on a seamed read (_fsRead) — tests that need the raw on-disk
    // matrix get exactly that.
    if (!_fsRead) {
      await overlayLedgerDeclarations(matrix, cwd ?? process.cwd());
      await applyOutcomeDerivedScores(matrix, cwd ?? process.cwd());
      // court-audit #3: the displayed headline `overallSelfScore` was never recomputed at read, so a
      // stale or hand-edited value (e.g. 9.9 with every dim untouched) surfaced uncontested — inflating
      // the ONE number humans + CI read while every per-dim guard was bypassed. Recompute it from the
      // gated/derived per-dim scores (same recompute gap-report.ts already does), so it always coheres.
      const { computeOverallScore } = await import('./compete-matrix-score.js');
      matrix.overallSelfScore = computeOverallScore(matrix);
      let mtimeMs = -1, size = -1;
      try { const st = await fs.stat(matrixPath); mtimeMs = st.mtimeMs; size = st.size; } catch { /* keep sentinel: next hit re-stats and reloads */ }
      _matrixCache = { matrix, expiresAt: Date.now() + MATRIX_CACHE_TTL_MS, path: matrixPath, mtimeMs, size };
    }
    return matrix;
  } catch {
    return null;
  }
}

/**
 * Declarations-ledger overlay (the durable-persistence read side): re-attach any
 * gate-confirmed outcome declaration the on-disk matrix has LOST. matrix.json is
 * kernel-owned and never committed by agents, so the autopilot's git operations
 * (`reset --hard`, branch switches) wipe its uncommitted outcomes[] — that is exactly
 * how the fleet's earns evaporated (3/3 repos, 2026-06-10). The ledger
 * (.danteforge/compete/declarations/, self-gitignored) survives those operations, and
 * this overlay restores its declarations at read time.
 *
 * Collision rule: the MATRIX ENTRY ALWAYS WINS on outcome-id collision. A
 * ground-outcomes downgrade writes the downgraded entry back into matrix.json, and the
 * overlay must never resurrect the older (higher-tier) ledger snapshot — it only ADDS
 * ids the matrix no longer has. Best-effort: any failure leaves the matrix untouched.
 */
async function overlayLedgerDeclarations(matrix: CompeteMatrix, cwd: string): Promise<void> {
  try {
    const { loadAllDeclarations } = await import('./declarations-ledger.js');
    const ledger = await loadAllDeclarations(cwd);
    if (ledger.size === 0) return;
    let restored = 0;
    for (const dim of matrix.dimensions) {
      const declared = ledger.get(dim.id);
      if (!declared || declared.length === 0) continue;
      const d = dim as unknown as Record<string, unknown>;
      const existing = Array.isArray(d['outcomes'])
        ? d['outcomes'] as Array<{ id?: unknown }>
        : [];
      const existingIds = new Set(
        existing.map(o => (typeof o?.id === 'string' ? o.id : '')).filter(id => id.length > 0),
      );
      const missing = declared.filter(o => !existingIds.has(o.id));
      if (missing.length === 0) continue;
      d['outcomes'] = [...existing, ...missing];
      restored += missing.length;
    }
    if (restored > 0) {
      // One line per LOAD (not per outcome) — enough to explain why a wiped matrix still
      // scores, without spamming every loop iteration.
      const { logger } = await import('./logger.js');
      logger.info(`[declarations-ledger] restored ${restored} gate-confirmed declaration(s) from the ledger (matrix.json lost them — likely a git reset)`);
    }
  } catch {
    // best-effort — the overlay is a recovery net and must never break loadMatrix
  }
}

/**
 * Phase F: walk the matrix, and for every dim that declares outcomes, compute
 * the outcome-evidence-derived score and store it in `scores.derived`.
 * `scores.self` is the competitive/adversarial assessment — this function does NOT touch it.
 * Best-effort — if evidence cannot be loaded, derived is left unchanged.
 */
async function applyOutcomeDerivedScores(matrix: CompeteMatrix, cwd: string): Promise<void> {
  let evidence: import('../matrix/types/outcome.js').OutcomeEvidence | null = null;
  // Outcome-integrity report is computed lazily — only when a dim actually has
  // fresh evidence to score — so steady-state loadMatrix (no fresh evidence)
  // pays nothing. Without this, the derived score was recomputed UNcapped at
  // load and clobbered validate's honest integrity-capped value, so the headline
  // reverted from ~6.5 (honest) to ~7.9 on the next load.
  let integrityReport: import('../matrix/engines/outcome-integrity.js').IntegrityReport | null = null;
  let integrityChecked = false;
  for (const dim of matrix.dimensions) {
    const outcomes = (dim as unknown as Record<string, unknown>)['outcomes'];
    if (!Array.isArray(outcomes) || outcomes.length === 0) continue;

    // Lazy-load evidence only when at least one dim declares outcomes.
    if (evidence === null) {
      try {
        const { loadOutcomeEvidence } = await import('../matrix/engines/outcome-runner.js');
        evidence = await loadOutcomeEvidence(cwd);
      } catch {
        return; // best-effort
      }
    }

    try {
      // Staleness guard: only override scores.self when at least one evidence entry for this
      // dimension is still within ITS TIER's freshness window. Tier-aware (was a flat 24h that
      // over-decayed T5, which the tier system allows for 7 days — so an overnight unattended run
      // dropped T5 scores to unverified by hour 25 and the loop churned on stale 5s). T6/T8 stay
      // same-day; T5 holds a week; T1/T2 hold months — see TIER_FRESHNESS_MS.
      const nowDate = new Date();
      const { makeEvidenceKey } = await import('../matrix/types/outcome.js');
      const { isEvidenceStale } = await import('../matrix/types/capability-test.js');
      const dimOutcomes = outcomes as Array<{ id: string; tier?: import('../matrix/types/capability-test.js').CapabilityTier }>;
      const hasFreshEvidence = dimOutcomes.some(o => {
        const entry = evidence!.get(makeEvidenceKey(dim.id, o.id));
        if (!entry?.ranAt) return false;
        return !isEvidenceStale(o.tier ?? 'T5', entry.ranAt, nowDate);
      });
      if (!hasFreshEvidence) {
        // No fresh evidence (<24h) — a stored `derived` is STALE and must NOT coast at its old value.
        // Dropping it makes the dim read as UNVERIFIED: decisionDimScore caps a declared-outcome dim
        // with no derived at 5.0 (the T2 floor), and computeOverallScore ranks on that. Keeping the
        // stale value is EXACTLY how 22/24 dims showed 9.0 on zero current evidence (council reality
        // check). Unverified ≠ proven; it also ≠ broken — hence the 5.0 floor, not 0.
        delete (dim.scores as unknown as Record<string, unknown>)['derived'];
        continue;
      }

      const { computeDerivedScoreWithBreakdown } = await import('./derived-score.js');
      const { applyLegacyReceiptCeiling } = await import('../matrix/engines/receipt-ceiling.js');
      const dfs = {
        id: dim.id,
        outcomes: outcomes as import('../matrix/types/outcome.js').Outcome[],
        declared_ceiling: (dim as unknown as Record<string, unknown>)['declared_ceiling'] as 'T0'|'T1'|'T2'|'T3'|'T4'|'T5'|'T6'|undefined,
        legacy_score: dim.scores.self,
        scores: dim.scores,
      };
      const breakdown = computeDerivedScoreWithBreakdown(dfs, evidence!, new Date());
      // Depth doctrine: dims with no outcomes declared cannot exceed 7.0.
      let derived = applyLegacyReceiptCeiling(breakdown.score, breakdown);
      // Outcome-integrity caps (seamed → 6.0, shared-receipt / callsite-decoupled
      // → 7.0): the SAME caps validate.ts applies, via the shared integrityCapFor.
      // Computed once (lazily) and reused for every dim so the headline derived
      // score matches validate's honest score instead of an uncapped tier score.
      if (!integrityChecked) {
        integrityChecked = true;
        try {
          const { checkOutcomeIntegrity } = await import('../matrix/engines/outcome-integrity.js');
          integrityReport = await checkOutcomeIntegrity(
            matrix.dimensions as unknown as Parameters<typeof checkOutcomeIntegrity>[0],
            cwd,
          );
        } catch { integrityReport = null; }
      }
      if (integrityReport) {
        const { integrityCapFor } = await import('../matrix/engines/outcome-integrity.js');
        derived = integrityCapFor(derived, dim.id, integrityReport).cappedScore;
      }
      // Frontier gate at READ TIME (live pilot finding, fleet run 3): >8.0 requires a
      // court-VALIDATED frontier_spec. validate.ts applied this only in its own display path,
      // so a frozen-but-unvalidated dim with T7 receipts read 9.0 through loadMatrix — gap,
      // decision scores, and the headline all showed a 9.0 the court had REJECTED.
      {
        const { applyFrontierGate, applyGroundingGate } = await import('./frontier-spec.js');
        derived = applyFrontierGate(derived, dim).score;
        // Phase 1c (default-off until the first external benchmark): >7 requires external grounding.
        derived = applyGroundingGate(derived, dim).score;
      }
      // Write derived score to scores.derived only.
      // scores.self is the human/adversarial competitive assessment — do not overwrite it.
      (dim.scores as unknown as Record<string, unknown>)['derived'] = derived;
    } catch {
      // best-effort; if scoring fails, leave the legacy value
    }
  }
}

/**
 * Persistence-time score reconciliation: clamp every dim's persisted `scores.self` and
 * `scores.derived` (when present) through the canonical clampDimScore — market cap +
 * declared ceiling, ONE clamp in one place (compete-matrix-score.ts). Live derivation
 * already refuses values above those caps, so a persisted value above them is by
 * definition stale split-brain state (e.g. token_economy sitting at 7.0 against its
 * permanent 5.0 market cap) and must die at the save boundary.
 *
 * scores.self routes through writeVerifiedScore — the single sanctioned gate — so the
 * lowering carries an auditable provenance row and passes assertScoreProvenance at the
 * production save boundary. scores.derived has no gate (validate writes it directly) and
 * is clamped in place. clampDimScore is min-composed, so this pass can only LOWER or
 * hold values, never raise them.
 */
async function reconcileScoreCaps(matrix: CompeteMatrix): Promise<void> {
  const { clampDimScore } = await import('./compete-matrix-score.js');
  let writeVerifiedScoreFn: typeof import('./write-verified-score.js').writeVerifiedScore | null = null;
  for (const dim of matrix.dimensions) {
    const derived = dim.scores['derived'];
    if (typeof derived === 'number' && Number.isFinite(derived)) {
      const clampedDerived = clampDimScore(dim.id, derived, dim.ceiling);
      if (clampedDerived < derived) dim.scores['derived'] = clampedDerived;
    }
    const self = dim.scores['self'];
    if (typeof self === 'number' && Number.isFinite(self) && clampDimScore(dim.id, self, dim.ceiling) < self) {
      if (!writeVerifiedScoreFn) {
        writeVerifiedScoreFn = (await import('./write-verified-score.js')).writeVerifiedScore;
      }
      // Pass the CURRENT value as rawScore — the gate applies the same canonical clamp
      // internally, records before/raw/after provenance, and recomputes gap/leader/overall
      // in lockstep. skipHistory/skipStatus: this is reconciliation, not a sprint result.
      writeVerifiedScoreFn(matrix, dim.id, self, {
        agent: 'save-reconcile',
        rationale: 'persistence-time clamp: stale value above market cap / declared ceiling',
      }, { skipHistory: true, skipStatus: true });
    }
  }
}

export async function saveMatrix(
  matrix: CompeteMatrix,
  cwd?: string,
  _fsWrite?: (p: string, content: string) => Promise<void>,
): Promise<void> {
  const matrixPath = getMatrixPath(cwd);

  // Test-isolation guard (council 2026-05-29): a test once called saveMatrix()
  // with the default (real-disk) write and the real repo as cwd, clobbering the
  // live .danteforge/compete/matrix.json with a 1-dim fixture. Catch the whole
  // class at the chokepoint: when running under Node's test runner with a REAL
  // disk write (no _fsWrite seam) to a path OUTSIDE the OS temp dir, throw.
  // Tests must either pass the _fsWrite seam or a tmp cwd. This never fires in
  // production (NODE_TEST_CONTEXT is only set by `node --test`).
  if (process.env['NODE_TEST_CONTEXT'] && !_fsWrite) {
    const resolved = path.resolve(matrixPath);
    const tmpReal = path.resolve(os.tmpdir());
    // Scratch locations are fine: os.tmpdir() OR any path with a literal tmp/temp segment
    // (this machine's convention keeps test scratch on X:\tmp so C: never fills — those are
    // exactly as disposable as os.tmpdir()). Everything else is treated as a REAL project
    // matrix and refused.
    const isOsTmp = resolved.toLowerCase().startsWith(tmpReal.toLowerCase());
    const hasTmpSegment = resolved.toLowerCase().split(path.sep).some(seg => seg === 'tmp' || seg === 'temp');
    if (!isOsTmp && !hasTmpSegment) {
      throw new Error(
        `[saveMatrix] Refusing to write a real matrix.json during a test run: ${resolved}. ` +
        `Tests must pass the _fsWrite seam or use a scratch cwd (os.tmpdir() or a tmp/temp ` +
        `directory) — writing the live project matrix from a test clobbers real competitive scores.`,
      );
    }
  }

  // Reconciliation clamp (rank-8 split-brain backstop): a STALE persisted score above the
  // market cap or the dim's declared ceiling must never survive a save — live derivation
  // already refuses such values, so persisting them is pure split-brain. Runs on every
  // save path (seamed and real) and can only LOWER or hold values, never raise.
  await reconcileScoreCaps(matrix);

  // CH-022 interrupt-before-score-write gate: pause at a clean boundary BEFORE persisting any score so a
  // partially-built wave is never frozen into the matrix (it stays `running` and resume picks it up). One
  // check covers BOTH branches below — it is default-OFF (checkScoreInterrupt returns paused:false unless
  // an operator armed the env/sentinel), so the smoke suite is unaffected. Escape: DANTEFORGE_ALLOW_SCORE_WRITE=1.
  {
    const { checkScoreInterrupt } = await import('./score-interrupt.js');
    const interrupt = await checkScoreInterrupt(cwd ?? process.cwd());
    if (interrupt.paused) {
      if (process.env['DANTEFORGE_ALLOW_SCORE_WRITE'] === '1') {
        const { logger } = await import('./logger.js');
        logger.warn(`[saveMatrix] score-write interrupt active (${interrupt.reason}) — bypassed via DANTEFORGE_ALLOW_SCORE_WRITE.`);
      } else {
        throw new Error(`[saveMatrix] score write BLOCKED by interrupt: ${interrupt.reason}. The matrix was NOT written — the in-flight wave stays resumable. Clear .danteforge/INTERRUPT (or unset ${'DANTEFORGE_INTERRUPT_BEFORE_SCORE'}) to resume, or set DANTEFORGE_ALLOW_SCORE_WRITE=1 to force this write.`);
      }
    }
  }

  const content = JSON.stringify(matrix, null, 2);
  const write = _fsWrite ?? (async (p: string, c: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, c, 'utf8');
  });

  if (_fsWrite || process.env['NODE_TEST_CONTEXT']) {
    // Tests are seam-driven or run in isolated tmp cwds — no cross-process contention, and fixture
    // matrices set scores directly (no gate provenance), so the production-only backstops are skipped.
    await write(matrixPath, content);
  } else {
    // Read the previous on-disk matrix once for both integrity backstops.
    let prev: CompeteMatrix | null = null;
    try { prev = JSON.parse(await fs.readFile(matrixPath, 'utf8')) as CompeteMatrix; } catch { prev = null; }

    // (A) Frozen-spec preservation: a frozen/validated frontier_spec is hard-won protocol state and
    // must NEVER be silently wiped by a matrix rewrite (DanteAgents: a no-op build cycle clobbered
    // D19's frozen spec frozen→undefined). Re-attach any the incoming matrix dropped — purely
    // additive, never removes. Override for a deliberate reset: DANTEFORGE_ALLOW_SPEC_RESET=1.
    if (prev && process.env['DANTEFORGE_ALLOW_SPEC_RESET'] !== '1') {
      const { preserveFrozenSpecs } = await import('./write-verified-score.js');
      const restored = preserveFrozenSpecs(prev, matrix);
      if (restored.length > 0) {
        const { logger } = await import('./logger.js');
        logger.warn(`[saveMatrix] preserved frozen/validated frontier_spec for [${restored.join(', ')}] — a rewrite tried to drop it. (DANTEFORGE_ALLOW_SPEC_RESET=1 to override.)`);
      }
    }

    // (B) Score-provenance backstop (closes the grep-guard's blind spot): a `scores.self` changed
    // versus the on-disk matrix with NO matching writeVerifiedScore provenance entry is unverified
    // inflation — fail closed. Escape: DANTEFORGE_ALLOW_UNVERIFIED_SCORE=1.
    if (prev) {
      const { assertScoreProvenance } = await import('./write-verified-score.js');
      const violations = assertScoreProvenance(prev, matrix);
      if (violations.length > 0) {
        const detail = violations.map(v => `${v.dimId} ${v.before}→${v.after}`).join(', ');
        if (process.env['DANTEFORGE_ALLOW_UNVERIFIED_SCORE'] === '1') {
          const { logger } = await import('./logger.js');
          logger.warn(`[saveMatrix] unverified scores.self change(s) [${detail}] — allowed via DANTEFORGE_ALLOW_UNVERIFIED_SCORE.`);
        } else {
          throw new Error(
            `[saveMatrix] Refusing to persist scores.self change(s) with no writeVerifiedScore provenance: ${detail}. ` +
            `Every self-score write must go through writeVerifiedScore(). If this is a deliberate out-of-band ` +
            `edit/migration, re-run with DANTEFORGE_ALLOW_UNVERIFIED_SCORE=1.`,
          );
        }
      }
    }

    // (C) Validated-receipt backstop (court-audit #10): `status:'validated'` is the 8.0→9.0 certificate,
    // but assertScoreProvenance only guards scores.self — NOT this transition. So a load→mutate→save (or
    // an in-process Object.assign) could persist a hand-set `validated`. Strip any `validated` whose court
    // receipt does not verify (bound to dim + content + the out-of-repo kernel secret); only the
    // frontier-review court can mint a real one. Demote to 'frozen' rather than fail the whole save.
    {
      const { stripUnverifiedValidations } = await import('./write-verified-score.js');
      const stripped = stripUnverifiedValidations(matrix);
      if (stripped.length > 0) {
        const { logger } = await import('./logger.js');
        logger.warn(`[saveMatrix] stripped unverified frontier_spec validation for [${stripped.join(', ')}] — only the frontier-review court can mint a 9.0 receipt; demoted to 'frozen'.`);
      }
    }

    // Re-serialize AFTER preservation may have re-attached a dropped spec, then write under an
    // exclusive cross-process lock (fail CLOSED — an unlocked fallback would defeat the guarantee).
    const finalContent = JSON.stringify(matrix, null, 2);
    const { withFileLock } = await import('./sanitize-locks.js');
    await withFileLock(
      { cwd: cwd ?? process.cwd(), filePath: path.relative(cwd ?? process.cwd(), matrixPath), lockDir: '.danteforge/locks', maxWaitMs: 30_000 },
      () => write(matrixPath, finalContent),
    );
  }
  // Bust the in-process cache so the next loadMatrix reads the saved value
  invalidateMatrixCache();
}

export { FREQUENCY_MULTIPLIERS, computeGapPriority, getNextSprintDimension, classifyDimensions, effectiveDimScore, decisionDimScore, UNVERIFIED_DECISION_CAP, computeOverallScore, computeTwoGaps, updateDimensionScore, applyIntelLeaderScores, applyAdversarialCalibration, clampDimScore, MARKET_DIMS_SCORE_CAP, MARKET_DIM_MAX_SCORE } from './compete-matrix-score.js';
export { KNOWN_OSS_TOOLS, isOssTool, KNOWN_CEILINGS, addOrUpdateCompetitor, addOrUpdateDimension, removeCompetitor, dropDimension, recategorizeDimension, setDimensionWeight, bootstrapMatrixFromComparison, checkMatrixStaleness, getDimensionStrategy, computeUnweightedComposite, getTopGapDimensions, HUMAN_ACTION_DIMENSION_IDS, excludeDimension, includeDimension } from './compete-matrix-ops.js';
export type { MatrixStalenessReport } from './compete-matrix-ops.js';
