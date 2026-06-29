// tests/laws/rig.ts — shared rig for THE LAWS harness (docs/SEAM_HARDENING_PLAN.md, Component 1).
//
// Recording fakes + pure law-checkers driven through the REAL orchestrator entry points.
// Every checker here is paired in the law files with a NEGATIVE control (the original fleet
// bug shape re-introduced through a seam) proving the law can actually catch its target class.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { GitFn } from '../../src/cli/commands/autoresearch-git.js';
import type { CompeteMatrix, MatrixDimension } from '../../src/core/compete-matrix.js';
import { isTestSuiteCommand } from '../../src/matrix/engines/outcome-quality.js';

// ── Temp roots (X:\tmp by convention — saveMatrix's scratch guard allows tmp segments) ──

export function lawsTmpDir(name: string): string {
  return path.join(os.tmpdir(), `laws-${name}-${process.pid}-${Math.floor(Math.random() * 1e6)}`);
}

export async function rmrf(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

// ── Real git repo helper (L1 merge-back, L3 reset simulation) ──────────────────

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export async function makeRepo(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'laws@test');
  git(dir, 'config', 'user.name', 'laws');
  await fs.writeFile(path.join(dir, 'base.txt'), 'base\n', 'utf8');
  git(dir, 'add', 'base.txt');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

// ── Recording GitFn (L1) ────────────────────────────────────────────────────────

export interface RecordedGitCall {
  args: string[];
  cwd: string;
}

export interface RecordingGit {
  fn: GitFn;
  calls: RecordedGitCall[];
}

/** In-memory git emulator: records every (args, cwd) invocation; answers the handful of
 *  read commands the autoresearch loop issues; every mutation is a recorded no-op. */
export function makeRecordingGit(): RecordingGit {
  const calls: RecordedGitCall[] = [];
  const fn: GitFn = async (args, cwd) => {
    calls.push({ args: [...args], cwd });
    const verb = args[0] ?? '';
    if (verb === 'status') return '';
    if (verb === 'rev-parse') return 'feedc0defeedc0defeedc0defeedc0defeedc0de';
    return '';
  };
  return { fn, calls };
}

/** Git verbs that MUTATE a working tree / ref state. Reads (status, rev-parse, log…) are not here. */
export const MUTATING_GIT_VERBS = new Set([
  'checkout', 'switch', 'reset', 'clean', 'add', 'commit', 'merge', 'rebase',
  'branch', 'restore', 'rm', 'mv', 'stash', 'cherry-pick', 'revert', 'worktree', 'apply',
]);

export function isMutatingGit(args: string[]): boolean {
  return MUTATING_GIT_VERBS.has(args[0] ?? '');
}

/** LAW L1 checker: under isolation, NO recorded git mutation may address the user's tree. */
export function checkGitIsolation(calls: RecordedGitCall[], userTree: string): string[] {
  const user = path.resolve(userTree);
  const violations: string[] = [];
  for (const c of calls) {
    if (isMutatingGit(c.args) && path.resolve(c.cwd) === user) {
      violations.push(`git ${c.args.join(' ')} ran against the USER tree (${c.cwd}) under isolation`);
    }
  }
  return violations;
}

// ── Matrix fixtures (L2/L3/L5) ──────────────────────────────────────────────────

export function makeDim(id: string, overrides: Partial<MatrixDimension> & Record<string, unknown> = {}): MatrixDimension {
  return {
    id,
    label: id,
    weight: 1,
    category: 'features',
    frequency: 'medium',
    scores: { self: 4, cursor: 9 },
    gap_to_leader: 5,
    leader: 'cursor',
    gap_to_closed_source_leader: 5,
    closed_source_leader: 'cursor',
    gap_to_oss_leader: 0,
    oss_leader: '',
    status: 'in-progress',
    sprint_history: [],
    next_sprint_target: 7,
    ...overrides,
  } as MatrixDimension;
}

export function makeMatrix(dimensions: MatrixDimension[]): CompeteMatrix {
  return {
    project: 'laws-fixture',
    competitors: ['cursor'],
    competitors_closed_source: ['cursor'],
    competitors_oss: [],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 4,
    dimensions,
  };
}

export async function writeRawMatrix(cwd: string, matrix: CompeteMatrix): Promise<void> {
  const p = path.join(cwd, '.danteforge', 'compete', 'matrix.json');
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(matrix, null, 2), 'utf8');
}

/** Raw on-disk matrix — deliberately NOT loadMatrix (no ledger overlay, no derived scoring),
 *  so L2 snapshots compare exactly what was PERSISTED between orchestrator steps. */
export async function readRawMatrix(cwd: string): Promise<CompeteMatrix> {
  const p = path.join(cwd, '.danteforge', 'compete', 'matrix.json');
  return JSON.parse((await fs.readFile(p, 'utf8')).replace(/^﻿/, '')) as CompeteMatrix;
}

// ── Run-ledger event reader (L2/L3) ─────────────────────────────────────────────

export interface RunEvent {
  eventType: string;
  data: Record<string, unknown>;
}

export async function readRunEvents(cwd: string, runId: string): Promise<RunEvent[]> {
  const p = path.join(cwd, '.danteforge', 'runs', runId, 'events-live.jsonl');
  let raw: string;
  try {
    raw = await fs.readFile(p, 'utf8');
  } catch {
    return [];
  }
  return raw.split('\n').filter(l => l.trim().length > 0).map(l => JSON.parse(l) as RunEvent);
}

// ── LAW L3 checker: declaration durability ──────────────────────────────────────

export interface DeclarationLossEvidence {
  /** Outcome ids carrying a tombstone in the declarations ledger (sanctioned removal). */
  tombstonedOutcomeIds: Set<string>;
  /** Run-ledger events (the loud declarations-lost path). */
  events: RunEvent[];
}

export function declaredOutcomeIds(matrix: CompeteMatrix): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const dim of matrix.dimensions) {
    const d = dim as unknown as { outcomes?: Array<{ id?: unknown }> };
    out.set(dim.id, new Set((d.outcomes ?? []).map(o => String(o.id ?? '')).filter(Boolean)));
  }
  return out;
}

/** LAW L3: every declaration that disappears between two effective matrix states must be
 *  accounted for by a tombstone OR a declarations-lost run-ledger event — never silent. */
export function checkDeclarationDurability(
  before: Map<string, Set<string>>,
  after: Map<string, Set<string>>,
  evidence: DeclarationLossEvidence,
): string[] {
  const violations: string[] = [];
  for (const [dimId, ids] of before) {
    const now = after.get(dimId) ?? new Set<string>();
    for (const id of ids) {
      if (now.has(id)) continue;
      const key = `${dimId}/${id}`;
      const tombstoned = evidence.tombstonedOutcomeIds.has(id);
      const lostEvent = evidence.events.some(e =>
        e.eventType === 'declarations-lost' && Array.isArray(e.data['lost']) && (e.data['lost'] as string[]).includes(key));
      if (!tombstoned && !lostEvent) violations.push(`${key} disappeared SILENTLY (no tombstone, no declarations-lost event)`);
    }
  }
  return violations;
}

// ── LAW L5 checker: evidence honor ──────────────────────────────────────────────

const TIER_ORDER = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];

export function tierRank(tier: string): number {
  const i = TIER_ORDER.indexOf(tier);
  return i === -1 ? 0 : i;
}

export interface SweepOutcomeShape {
  id: string;
  tier: string;
  kind?: string;
  command?: string;
  required_callsite?: string;
  description?: string;
}

export interface EvidenceHonorViolation {
  dimId: string;
  outcomeId: string;
  kind: 'product-run-de-tiered' | 'undocumented-downgrade';
  detail: string;
}

/**
 * LAW L5: over (before, after, changes) — execution-proven product-run evidence is NEVER
 * de-tiered by an automated pass; any test-backed downgrade MUST carry a provenance line
 * in the grounding changes for that dim naming the outcome.
 */
export function checkEvidenceHonor(
  beforeDims: Array<{ id: string; outcomes?: SweepOutcomeShape[] }>,
  afterDims: Array<{ id: string; outcomes?: SweepOutcomeShape[] }>,
  changesByDim: Map<string, string[]>,
): EvidenceHonorViolation[] {
  const violations: EvidenceHonorViolation[] = [];
  const afterById = new Map(afterDims.map(d => [d.id, d]));
  for (const before of beforeDims) {
    const after = afterById.get(before.id);
    if (!after) continue;
    const afterOutcomes = new Map((after.outcomes ?? []).map(o => [o.id, o]));
    for (const b of before.outcomes ?? []) {
      const a = afterOutcomes.get(b.id);
      if (!a) continue;
      const productRun = !isTestSuiteCommand(b.command ?? '');
      const deTiered = tierRank(a.tier) < tierRank(b.tier);
      if (deTiered && productRun) {
        violations.push({
          dimId: before.id, outcomeId: b.id, kind: 'product-run-de-tiered',
          detail: `product run "${b.command ?? '(cli_args)'}" was de-tiered ${b.tier} -> ${a.tier} — execution-proven evidence may only ever be BOUNDED by a cap, never de-tiered`,
        });
      }
      if (deTiered) {
        const lines = changesByDim.get(before.id) ?? [];
        if (!lines.some(l => l.includes(b.id))) {
          violations.push({
            dimId: before.id, outcomeId: b.id, kind: 'undocumented-downgrade',
            detail: `${b.tier} -> ${a.tier} happened with NO provenance line in changes[] naming "${b.id}"`,
          });
        }
      }
    }
  }
  return violations;
}

// ── LAW L4 checker: spawn hygiene (track/untrack pairing + kill-before-untrack) ──

export type SpawnHygieneEvent =
  | { kind: 'spawn'; pid: number }
  | { kind: 'track'; pid: number | undefined }
  | { kind: 'untrack'; pid: number | undefined }
  | { kind: 'kill'; pid: number | undefined };

/** LAW L4: every spawned pid is tracked exactly once and untracked exactly once (reaped);
 *  a kill (timeout path) must be followed by the untrack of the same pid. */
export function checkSpawnHygiene(events: SpawnHygieneEvent[]): string[] {
  const violations: string[] = [];
  const pids = new Set(events.filter(e => e.kind === 'spawn').map(e => (e as { pid: number }).pid));
  for (const pid of pids) {
    const tracks = events.filter(e => e.kind === 'track' && e.pid === pid).length;
    const untracks = events.filter(e => e.kind === 'untrack' && e.pid === pid).length;
    if (tracks !== 1) violations.push(`pid ${pid}: tracked ${tracks} times (expected exactly 1)`);
    if (untracks !== 1) violations.push(`pid ${pid}: untracked ${untracks} times (expected exactly 1 — an untracked-0 child is the zombie-leak shape)`);
    const killIdx = events.findIndex(e => e.kind === 'kill' && e.pid === pid);
    if (killIdx !== -1) {
      const untrackIdx = events.findIndex(e => e.kind === 'untrack' && e.pid === pid);
      if (untrackIdx !== -1 && untrackIdx < killIdx) {
        violations.push(`pid ${pid}: untracked BEFORE the tree-kill — the kill would race an already-released pid`);
      }
    }
  }
  return violations;
}

// ── LAW L6 checker: clock nesting over emitted command lists ────────────────────

export const CLOCK_SLACK_MINUTES = 2;

export function parseDeclaredBudgetsMin(args: string[]): { time?: number; maxMinutes?: number } {
  const out: { time?: number; maxMinutes?: number } = {};
  for (let i = 0; i < args.length - 1; i++) {
    const v = parseFloat(String(args[i + 1]).replace(/m(in(utes)?)?$/i, ''));
    if (args[i] === '--time' && Number.isFinite(v)) out.time = v;
    if (args[i] === '--max-minutes' && Number.isFinite(v)) out.maxMinutes = v;
  }
  return out;
}

/**
 * LAW L6: for a command list + its outer kill cap —
 *  R1: the outer cap strictly exceeds EVERY declared inner budget + slack
 *      (inner==outer was the fleet-run-2 dead-loop: the kill always landed mid-cycle).
 *  R2: a --loop command must declare --max-minutes (a clean checkpoint exit must exist —
 *      otherwise the outer kill is the ONLY exit and nothing ever persists).
 *  R3: with both --time and --max-minutes declared, at least TWO full cycles
 *      (time + slack each) must fit inside the checkpoint budget — the progress-per-pass
 *      guarantee that pins --time 18 against a revert to the old 30.
 */
export function checkClockNesting(args: string[], outerMs: number): string[] {
  const violations: string[] = [];
  const { time, maxMinutes } = parseDeclaredBudgetsMin(args);
  const cmd = args.join(' ');
  for (const [flag, budget] of [['--time', time], ['--max-minutes', maxMinutes]] as const) {
    if (budget === undefined) continue;
    if (outerMs <= (budget + CLOCK_SLACK_MINUTES) * 60_000) {
      violations.push(`${cmd}: outer kill cap ${outerMs / 60_000}m does NOT exceed inner ${flag} ${budget}m + ${CLOCK_SLACK_MINUTES}m slack (the dead-loop shape)`);
    }
  }
  if (args.includes('--loop') && maxMinutes === undefined) {
    violations.push(`${cmd}: --loop with NO --max-minutes checkpoint — the outer tree-kill becomes the only exit and no cycle ever persists`);
  }
  if (time !== undefined && maxMinutes !== undefined && 2 * (time + CLOCK_SLACK_MINUTES) > maxMinutes) {
    violations.push(`${cmd}: fewer than 2 full cycles (2×(${time}+${CLOCK_SLACK_MINUTES})m) fit inside --max-minutes ${maxMinutes}m — reverting the per-cycle budget starves the pass of progress`);
  }
  return violations;
}
