// capability-test-author-runtime.ts — the REAL author executor: wires authorYardstick's seams to a
// deterministic, git-isolated examiner dispatch so the conductor's authorFn actually runs (no human).
//
// Protocol that keeps it honest + verifiable:
//  - The SYSTEM (not the agent) chooses the test file path AND the command up front, deterministically
//    from the target module's language — so there is no fragile parse of the agent's output, and the
//    command can't be gamed by the examiner.
//  - The examiner writes ONLY that test file (it exercises the wired module, RED until built).
//  - git isolation: anything the examiner changed outside the test file is PRODUCTION → reject (an
//    examiner that edits production could author the exam AND the stub that passes it).
//  - The candidate {chosen command, target module} runs the three honesty gates (authorYardstick).
//  - Install the command into matrix.json only on acceptance; else delete the examiner's test file.

import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { authorYardstick, type AuthorResult, type AuthorContext } from './capability-test-author.js';
import { loadMatrix, saveMatrix } from '../../core/compete-matrix.js';

const execFileAsync = promisify(execFile);

/** Real default: the working-tree paths git reports as changed (tracked + untracked). */
export async function defaultGitChanged(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, maxBuffer: 10 * 1024 * 1024 });
    return stdout.split('\n').map(l => l.slice(3).trim()).filter(Boolean).map(p => p.replace(/^"|"$/g, ''));
  } catch { return []; }
}

/** Real default: persist the accepted capability_test command into the dim's matrix.json. */
export async function defaultInstallCommand(cwd: string, dimId: string, command: string): Promise<void> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) return;
  const dim = matrix.dimensions.find(d => d.id === dimId) as unknown as { capability_test?: { command?: string; description?: string } } | undefined;
  if (!dim) return;
  dim.capability_test = { ...(dim.capability_test ?? {}), command, description: `Authored yardstick (real, RED-until-built) for ${dimId}` };
  await saveMatrix(matrix, cwd);
}

export interface TestScaffold { testFilePath: string; command: string }

/** Pick the test file path + runner command for a target module's language. null = unsupported (honest). */
export function chooseTestScaffold(targetModule: string, dimId: string): TestScaffold | null {
  const ext = path.extname(targetModule).toLowerCase();
  const slug = dimId.replace(/[^a-z0-9_-]/gi, '-');
  if (['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(ext)) {
    const p = `tests/${slug}.capability.test.ts`;
    return { testFilePath: p, command: `npx tsx --test ${p}` };
  }
  // Rust/Python/Go need package/runner specifics (Cargo package, pytest layout) — not auto-scaffolded yet.
  return null;
}

/** A changed path that is PRODUCTION code (not a test, not config/state) — the examiner must not touch it. */
export function isProductionSrc(file: string): boolean {
  const f = file.replace(/\\/g, '/');
  if (/(^|\/)(tests?|__tests__)\//.test(f)) return false;
  if (/\.(test|spec)\.[a-z]+$/i.test(f)) return false;
  if (/(^|\/)\.danteforge\//.test(f) || /(^|\/)\.git\//.test(f)) return false;
  return /(^|\/)(src|lib|packages)\//.test(f) || /\.(ts|tsx|js|mjs|cjs|rs|py|go)$/i.test(f);
}

export interface AuthorRuntimeOptions {
  dimId: string;
  cwd: string;
  ladderBar: string;
  targetModule: string;
  wired: Set<string>;
  hasLadder: boolean;
  /** Dispatch the examiner agent to write the test at `testFilePath` (ClaudeCodeAdapter, write-scoped).
   *  The live-agent step — provided by the conductor run loop (reuses the proven dispatchAgentEdit path). */
  dispatchExaminer: (objective: string, testFilePath: string) => Promise<{ ranOk: boolean; reason?: string }>;
  /** Files changed in the working tree. Defaults to `git status --porcelain`. */
  gitChanged?: (cwd: string) => Promise<string[]>;
  /** Persist the accepted capability_test command into the dim's matrix.json. Defaults to matrix I/O. */
  installCommand?: (dimId: string, command: string) => Promise<void>;
  timeoutMs?: number;
  // fs seams (tests)
  _exists?: (p: string) => Promise<boolean>;
  _removeFile?: (p: string) => Promise<void>;
  _run?: AuthorContext['run'];
}

const defaultExists = async (p: string): Promise<boolean> => { try { await fs.access(p); return true; } catch { return false; } };

/**
 * Author a real, RED, ladder-grounded yardstick for one dim by dispatching the examiner agent, with the
 * full honesty chain enforced (integrity + grounded + red + examiner≠builder isolation). Installs on
 * acceptance, reverts (deletes the examiner's test file) otherwise. The conductor's real `authorFn`.
 */
export async function authorYardstickForDim(opts: AuthorRuntimeOptions): Promise<AuthorResult> {
  const scaffold = chooseTestScaffold(opts.targetModule, opts.dimId);
  if (!scaffold) {
    return { dimId: opts.dimId, installed: false, reason: `auto-authoring not yet supported for "${path.extname(opts.targetModule) || 'unknown'}" modules — only JS/TS today.` };
  }
  const exists = opts._exists ?? defaultExists;
  const removeFile = opts._removeFile ?? ((p: string) => fs.rm(p, { force: true }));
  const gitChanged = opts.gitChanged ?? defaultGitChanged;
  const installCommand = opts.installCommand ?? ((d: string, c: string) => defaultInstallCommand(opts.cwd, d, c));
  const absTest = path.join(opts.cwd, scaffold.testFilePath);

  const ctx: AuthorContext = {
    cwd: opts.cwd, wired: opts.wired, hasLadder: opts.hasLadder,
    ladderBar: opts.ladderBar, targetModule: opts.targetModule,
    timeoutMs: opts.timeoutMs, run: opts._run,
    dispatch: (objective) => opts.dispatchExaminer(`${objective}\n\nWrite your test at EXACTLY this path: ${scaffold.testFilePath}`, scaffold.testFilePath),
    productionChanged: async () => (await gitChanged(opts.cwd)).filter(isProductionSrc),
    readCandidate: async () => {
      if (!(await exists(absTest))) return null; // the examiner never produced the test
      return { dimId: opts.dimId, command: scaffold.command, callsite: opts.targetModule };
    },
    revert: async () => { await removeFile(absTest).catch(() => { /* best-effort */ }); },
  };

  const result = await authorYardstick(opts.dimId, ctx);
  if (result.installed) await installCommand(opts.dimId, scaffold.command);
  return result;
}
