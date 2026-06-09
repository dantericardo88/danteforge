// capability-test-sensitivity.ts — the DEFINITIVE honesty proof the red-team demanded.
//
// A static pass cannot tell a real yardstick from a decoupled one: `npx tsx --test x.test.ts` that
// imports the wired module looks identical to one that names it but never calls it, and a trivially-green
// product probe (`danteforge help`) looks like a real metric. The only ground truth is EXECUTION +
// DEPENDENCE: a genuine yardstick's pass/fail must CHANGE when the production code it claims to exercise
// is broken. This probe runs the capability_test, then faults the declared callsite and runs it again:
//
//   baseline GREEN, faulted FAILS  -> GENUINE  (the metric depends on the real code)
//   baseline GREEN, faulted GREEN  -> STUB     (invariant to the code → decoupled / self-fulfilling)
//   baseline RED                   -> BASELINE_RED (an unbuilt/failing metric — not a "passing" claim to verify)
//
// The fault is restored in a finally so the working tree is never left mutated. Pre-built product runs
// (`node dist/index.js …`) are INCONCLUSIVE here — faulting source doesn't reach the built bundle without
// a rebuild — so the probe honestly declines rather than mislabel them.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

export type SensitivityVerdict = 'GENUINE' | 'STUB' | 'BASELINE_RED' | 'INCONCLUSIVE';

export interface SensitivityResult {
  verdict: SensitivityVerdict;
  baselineExit: number | null;
  faultedExit: number | null;
  reason: string;
}

export interface SensitivityProbeOptions {
  cwd: string;
  command: string;
  /** The production src/ file the yardstick claims to exercise — faulted to test dependence. */
  callsite: string;
  timeoutMs?: number;
  /** Seams for tests. */
  _run?: (command: string, cwd: string, timeoutMs: number) => Promise<number>;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, c: string) => Promise<void>;
}

/** A token that is a syntax error in every language we target — breaks parse/compile/import of the file
 *  so any consumer that actually loads it fails, while a test that never loads it is unaffected. */
const FAULT_MARKER = '@@@DANTE_SENSITIVITY_FAULT@@@';

const defaultRun = (command: string, cwd: string, timeoutMs: number): Promise<number> =>
  new Promise(resolve => {
    const child = execFile(command, { cwd, shell: true, timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err) => {
      const code = (err as (NodeJS.ErrnoException & { code?: number | string }) | null)?.code;
      resolve(typeof code === 'number' ? code : (err ? 1 : 0));
    });
    child.on('error', () => resolve(1));
  });

/** True for a command whose exit is decided by a PRE-BUILT artifact (dist bundle) — faulting source can't
 *  reach it without a rebuild, so the probe can't conclude from source mutation alone. */
function usesPrebuiltArtifact(command: string): boolean {
  return /node\s+dist[/\\]/i.test(command) || /(?:^|\s)\.[/\\]dist[/\\]/i.test(command);
}

export async function sensitivityProbe(opts: SensitivityProbeOptions): Promise<SensitivityResult> {
  const run = opts._run ?? defaultRun;
  const readFile = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFile = opts._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const none = (verdict: SensitivityVerdict, reason: string): SensitivityResult => ({ verdict, baselineExit: null, faultedExit: null, reason });

  if (!opts.callsite) return none('INCONCLUSIVE', 'no declared callsite to fault — cannot prove code dependence.');
  if (usesPrebuiltArtifact(opts.command)) {
    return none('INCONCLUSIVE', 'command runs a pre-built dist artifact — faulting source needs a rebuild to take effect (probe declines rather than mislabel).');
  }

  const callsitePath = path.isAbsolute(opts.callsite) ? opts.callsite : path.join(opts.cwd, opts.callsite);
  let original: string;
  try { original = await readFile(callsitePath); }
  catch { return none('INCONCLUSIVE', `callsite ${opts.callsite} could not be read.`); }

  const baselineExit = await run(opts.command, opts.cwd, timeoutMs);
  if (baselineExit !== 0) {
    return { verdict: 'BASELINE_RED', baselineExit, faultedExit: null, reason: 'the yardstick fails on HEAD — there is nothing to verify as a passing metric (it is unbuilt/red, not a green claim).' };
  }

  let faultedExit: number | null = null;
  try {
    await writeFile(callsitePath, `${FAULT_MARKER}\n${original}`);
    faultedExit = await run(opts.command, opts.cwd, timeoutMs);
  } finally {
    await writeFile(callsitePath, original).catch(() => { /* best-effort restore */ });
  }

  if (faultedExit !== 0) {
    return { verdict: 'GENUINE', baselineExit, faultedExit, reason: `breaking ${opts.callsite} made the yardstick FAIL — it genuinely exercises the production code.` };
  }
  return { verdict: 'STUB', baselineExit, faultedExit, reason: `the yardstick still PASSES with ${opts.callsite} broken — it is invariant to the production code (decoupled / self-fulfilling), not a real metric.` };
}
