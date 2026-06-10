// frontier-spec-complete.ts — deterministic, evidence-grounded completion of a scaffolded
// frontier_spec.
//
// WHY: the 9.0 frontier-review court only convenes over a spec that PASSES checkFrontierSpec,
// but the scaffold honestly leaves run_command / observable_artifacts / realistic_inputs
// unauthored whenever the dim lacks an obvious product run — so `frontier-spec init --write`
// could NEVER pass `check` with zero human edits, every autonomous push recorded a
// spec-incomplete ceiling, and the court never convened. This module closes that gap WITHOUT
// weakening any guardrail: it only PROMOTES evidence the dim has ALREADY recorded — product-run
// outcome commands (cli-smoke / runtime-exec), declared T5+ artifact paths, or files an actual
// probe run was OBSERVED to create/modify (mirroring session-record's mtime witness). When the
// evidence does not exist, the field stays unauthored and the honest ceiling stands: completion
// is derivation, never invention. checkFrontierSpec itself is untouched and remains the gate.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { logger } from './logger.js';
import {
  looksLikeProductRun, resolveRunCommand, tierRank, TODO_RE, type FrontierSpec,
} from './frontier-spec.js';

/** Cap the probe-derived artifact list — a run that touches dozens of files is summarized by its
 *  first few (alphabetical, deterministic); the spec needs at least ONE real artifact, not all. */
const MAX_PROBE_ARTIFACTS = 8;
const PROBE_TIMEOUT_MS = 600_000;
/** Directories never snapshotted. Beyond .git/node_modules: .danteforge state churns on EVERY
 *  danteforge invocation (logs, reports, run-ledgers, evidence) and build outputs (dist/target/…)
 *  are produced regardless of capability — counting any of them as the "observable artifact" makes
 *  the 9.0 artifact gate trivially green for ANY command (adversarial-review finding: alphabetical
 *  ordering even made .danteforge/ paths the FIRST picks). An artifact must be product output. */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.danteforge', 'dist', 'build', 'target', 'out', 'coverage', '.venv', 'venv', '__pycache__', '.next', '.turbo']);

export interface SpecProbeRun {
  exitCode: number;
  durationMs: number;
}

export interface SpecCompleteOptions {
  cwd?: string;
  /** false = never execute the probe run (derive only from declared evidence). Default: allowed. */
  probe?: boolean;
  /** Seam: execute the probe command. Default: real execFile with shell + timeout. */
  _probeRun?: (command: string, cwd: string) => Promise<SpecProbeRun>;
  /** Seam: snapshot relative-path → mtimeMs for every file under root (minus SKIP_DIRS). */
  _snapshotMtimes?: (root: string) => Promise<Map<string, number>>;
}

export interface SpecCompletionResult {
  /** Which unauthored fields the completer was able to fill from real evidence. */
  completed: { run_command: boolean; observable_artifacts: boolean; realistic_inputs: boolean };
  /** True iff the single probe run actually executed. */
  probed: boolean;
  /** Human-readable provenance/refusal notes (surfaced as init warnings). */
  notes: string[];
}

async function defaultProbeRun(command: string, cwd: string): Promise<SpecProbeRun> {
  const start = Date.now();
  return await new Promise((resolve) => {
    execFile(command, { cwd, shell: true, timeout: PROBE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err) => {
      const code = err ? ((err as { code?: number }).code ?? 1) : 0;
      resolve({ exitCode: typeof code === 'number' ? code : 1, durationMs: Date.now() - start });
    });
  });
}

/** Real before/after witness for the probe: every file's mtime under the repo (minus SKIP_DIRS),
 *  exactly how session-record proves an artifact was produced by THIS run and not staged earlier. */
async function defaultSnapshotMtimes(root: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  async function walk(dir: string): Promise<void> {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full);
      } else if (e.isFile()) {
        try { out.set(path.relative(root, full).replace(/\\/g, '/'), (await fs.stat(full)).mtimeMs); }
        catch { /* file vanished mid-walk — skip */ }
      }
    }
  }
  await walk(root);
  return out;
}

function normalizeCommand(cmd: string): string {
  return cmd.replace(/\s+/g, ' ').trim();
}

/** Distinct REAL product-run commands the dim has already recorded, highest tier first.
 *  cli-smoke is reconstructed as the exact invocation its runner spawns (`node dist/index.js
 *  <cli_args>`); the capability_test (no tier — a gate-level probe) ranks last. Every candidate
 *  must clear looksLikeProductRun, so test runners and help screens never qualify. */
function evidenceRunCandidates(dim: Record<string, unknown>): string[] {
  const ranked: Array<{ cmd: string; rank: number }> = [];
  const outcomes = (dim.outcomes as Array<Record<string, unknown>> | undefined) ?? [];
  for (const o of outcomes) {
    if (o._scaffold === true) continue;
    const kind = String(o.kind ?? 'shell');
    let cmd: string | null = null;
    if ((kind === 'runtime-exec' || kind === 'shell') && typeof o.command === 'string') {
      cmd = o.command;
    } else if (kind === 'cli-smoke' && Array.isArray(o.cli_args)) {
      cmd = `node dist/index.js ${(o.cli_args as unknown[]).map(String).join(' ')}`.trim();
    }
    if (cmd && looksLikeProductRun(cmd)) ranked.push({ cmd: normalizeCommand(cmd), rank: tierRank(String(o.tier ?? '')) });
  }
  const capCmd = (dim.capability_test as { command?: string } | undefined)?.command;
  if (typeof capCmd === 'string' && looksLikeProductRun(capCmd)) ranked.push({ cmd: normalizeCommand(capCmd), rank: -1 });
  ranked.sort((a, b) => b.rank - a.rank); // stable: ties keep declaration order
  return [...new Set(ranked.map(r => r.cmd))];
}

/** Factor ≥2 distinct recorded commands into `<common prefix> {input}` + per-variant inputs, so the
 *  two-session protocol (selectInputForSession) runs a genuinely DIFFERENT real command per session.
 *  Substituting each input reconstructs an exact recorded command — nothing synthesized. */
function splitIntoTemplate(cmds: string[]): { runCommand: string; inputs: string[] } | null {
  const tokenLists = cmds.map(c => c.split(' '));
  let prefixLen = Math.min(...tokenLists.map(t => t.length));
  for (let i = 0; i < prefixLen; i += 1) {
    const tok = tokenLists[0]![i];
    if (!tokenLists.every(t => t[i] === tok)) { prefixLen = i; break; }
  }
  // Every variant must contribute a non-empty input: when one command IS the common prefix,
  // shrink the prefix so its last token becomes that variant's input.
  while (prefixLen > 0 && tokenLists.some(t => t.length <= prefixLen)) prefixLen -= 1;
  const inputs = [...new Set(tokenLists.map(t => t.slice(prefixLen).join(' ')))];
  if (inputs.length < 2 || inputs.some(i => i.length === 0)) return null;
  const prefix = tokenLists[0]!.slice(0, prefixLen).join(' ');
  return { runCommand: prefix ? `${prefix} {input}` : '{input}', inputs };
}

/** For a human-authored run_command that already carries an {input} slot: which recorded commands
 *  instantiate that template? Their captured slot values are the only honest realistic_inputs. */
function inputsMatchingTemplate(template: string, cmds: string[]): string[] {
  const [headRaw, tailRaw = ''] = template.split('{input}');
  const head = normalizeCommand(headRaw ?? '');
  const tail = normalizeCommand(tailRaw);
  const inputs: string[] = [];
  for (const c of cmds) {
    if (head && !c.startsWith(head)) continue;
    let rest = c.slice(head.length).trim();
    if (tail) {
      if (!rest.endsWith(tail)) continue;
      rest = rest.slice(0, rest.length - tail.length).trim();
    }
    if (rest) inputs.push(rest);
  }
  return [...new Set(inputs)];
}

/** Artifact paths the dim's T5+ outcomes ALREADY declare (e2e-workflow steps' expected_artifacts,
 *  or a string artifact/artifact_path/observable_artifact field). Declared = previously authored
 *  and court-visible evidence, so promoting it into the spec invents nothing. */
function declaredArtifactPaths(dim: Record<string, unknown>): string[] {
  const out: string[] = [];
  const outcomes = (dim.outcomes as Array<Record<string, unknown>> | undefined) ?? [];
  for (const o of outcomes) {
    if (o._scaffold === true || tierRank(String(o.tier ?? '')) < 5) continue;
    for (const key of ['artifact', 'artifact_path', 'observable_artifact']) {
      const v = o[key];
      if (typeof v === 'string' && v.trim() && !TODO_RE.test(v)) out.push(v.trim());
    }
    const steps = Array.isArray(o.steps) ? (o.steps as Array<Record<string, unknown>>) : [];
    for (const s of steps) {
      const arts = Array.isArray(s.expected_artifacts) ? (s.expected_artifacts as unknown[]) : [];
      for (const a of arts) {
        if (typeof a === 'string' && a.trim() && !TODO_RE.test(a)) out.push(a.trim());
      }
    }
  }
  return [...new Set(out)];
}

/** The concrete command a probe would execute: run_command with the session-0 input substituted.
 *  null when run_command is unauthored or an {input} slot has no input to fill — nothing real to run. */
function probeCommandOf(spec: FrontierSpec): string | null {
  const rc = spec.real_user_path.run_command;
  if (!rc || TODO_RE.test(rc)) return null;
  const resolved = resolveRunCommand(spec, 0);
  if (resolved.includes('{input}')) return null;
  return resolved;
}

/**
 * Deterministically fill the unauthored real-user-path fields of `spec` from `dim`'s existing
 * evidence. Mutates `spec` in place (mirrors seedLeaderTargetFromLadder) and NEVER overwrites an
 * authored (non-sentinel) value:
 *
 *  (a) run_command       ← the best (highest-tier) recorded cli-smoke/runtime-exec product run,
 *                          when the scaffold could not derive one from the capability_test
 *  (c) realistic_inputs  ← ≥2 genuinely distinct recorded variants, factored into a
 *                          `<prefix> {input}` template; one variant → left unauthored (honest)
 *  (b) observable_artifacts ← declared T5+ artifact paths; otherwise ONE probe run of the chosen
 *                          command, recording files actually created/modified (mtime witness,
 *                          .git/node_modules excluded); nothing observable → left unauthored
 */
export async function completeFrontierSpec(
  spec: FrontierSpec,
  dim: Record<string, unknown>,
  options: SpecCompleteOptions = {},
): Promise<SpecCompletionResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const result: SpecCompletionResult = {
    completed: { run_command: false, observable_artifacts: false, realistic_inputs: false },
    probed: false,
    notes: [],
  };
  const rup = spec.real_user_path;
  const candidates = evidenceRunCandidates(dim);

  // ── (a) + (c): run_command and realistic_inputs, derived together ──────────────
  const runUnfilled = !rup.run_command || TODO_RE.test(rup.run_command);
  const inputsUnfilled = (rup.realistic_inputs?.length ?? 0) < 2;
  // Machine-owned = the completer may restructure it: either still the scaffold sentinel, or
  // verbatim one of the recorded evidence commands (what the scaffold derives from capability_test).
  const machineOwned = runUnfilled || candidates.includes(normalizeCommand(rup.run_command));

  if (!runUnfilled && rup.run_command.includes('{input}')) {
    if (inputsUnfilled) {
      const inputs = inputsMatchingTemplate(rup.run_command, candidates);
      if (inputs.length >= 2) {
        rup.realistic_inputs = inputs;
        result.completed.realistic_inputs = true;
        result.notes.push(`realistic_inputs derived from ${inputs.length} recorded variants matching the run_command {input} slot.`);
      } else {
        result.notes.push(`run_command has an {input} slot but only ${inputs.length} recorded variant(s) instantiate it — realistic_inputs left unauthored (honest).`);
      }
    }
  } else if (machineOwned) {
    const split = inputsUnfilled && candidates.length >= 2 ? splitIntoTemplate(candidates) : null;
    if (split) {
      rup.run_command = split.runCommand;
      rup.realistic_inputs = split.inputs;
      result.completed.run_command = true;
      result.completed.realistic_inputs = true;
      result.notes.push(`run_command + realistic_inputs derived from ${split.inputs.length} distinct recorded product-run variants.`);
    } else if (runUnfilled && candidates.length >= 1) {
      rup.run_command = candidates[0]!;
      result.completed.run_command = true;
      if (inputsUnfilled) result.notes.push('only ONE distinct recorded product-run variant — realistic_inputs left unauthored (honest; record a second real variant to unlock the two-session protocol).');
    } else if (runUnfilled) {
      result.notes.push('no recorded product-run evidence (capability_test is not a product run and no cli-smoke/runtime-exec outcome runs the real product) — run_command left unauthored.');
    }
  } else if (inputsUnfilled) {
    result.notes.push('run_command is human-authored without an {input} slot — realistic_inputs cannot be derived for it.');
  }

  // ── (b): observable_artifacts ───────────────────────────────────────────────────
  const artsUnfilled = rup.observable_artifacts.length === 0
    || rup.observable_artifacts.some(a => TODO_RE.test(a.path) || TODO_RE.test(a.kind));
  if (!artsUnfilled) return result;

  const declared = declaredArtifactPaths(dim);
  if (declared.length > 0) {
    rup.observable_artifacts = declared.map(p => ({ kind: 'file', path: p }));
    result.completed.observable_artifacts = true;
    result.notes.push(`observable_artifacts derived from ${declared.length} declared T5+ outcome artifact path(s).`);
    return result;
  }
  if (options.probe === false) {
    result.notes.push('probe disabled — observable_artifacts left unauthored.');
    return result;
  }
  const probeCmd = probeCommandOf(spec);
  if (!probeCmd) {
    result.notes.push('no runnable run_command to probe — observable_artifacts left unauthored.');
    return result;
  }

  const probeRun = options._probeRun ?? defaultProbeRun;
  const snapshot = options._snapshotMtimes ?? defaultSnapshotMtimes;
  logger.info(`[frontier-spec] probe-running ONCE to observe artifacts: ${probeCmd}`);
  const before = await snapshot(cwd);
  const run = await probeRun(probeCmd, cwd);
  result.probed = true;
  if (run.exitCode !== 0) {
    result.notes.push(`probe run exited ${run.exitCode} — observable_artifacts left unauthored (a failing run witnesses nothing).`);
    return result;
  }
  const after = await snapshot(cwd);
  const changed: string[] = [];
  for (const [p, mtime] of after) {
    const prev = before.get(p);
    if (prev === undefined || mtime > prev) changed.push(p);
  }
  changed.sort();
  if (changed.length === 0) {
    result.notes.push('probe run produced no observable file changes — observable_artifacts left unauthored (the honest ceiling stands).');
    return result;
  }
  rup.observable_artifacts = changed.slice(0, MAX_PROBE_ARTIFACTS).map(p => ({ kind: 'file', path: p }));
  result.completed.observable_artifacts = true;
  result.notes.push(`observable_artifacts recorded from a real probe run (${run.durationMs}ms): ${changed.length} file(s) created/modified${changed.length > MAX_PROBE_ARTIFACTS ? ` (keeping the first ${MAX_PROBE_ARTIFACTS})` : ''}.`);
  return result;
}
