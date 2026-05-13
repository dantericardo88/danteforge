// DanteSanitize — Wave-time auto-sanitize hook (Sprint 10)
//
// Called from autoforge-loop, ascend-engine, magic presets after each successful
// forge wave. Scans ONLY the files that changed in the last wave (git diff),
// filters to oversized files, runs sanitize on owned (non-frozen) files,
// and defers frozen-file violations to the platform-kernel workstream.
import path from 'node:path';
import fs from 'node:fs/promises';
import { countMaintainableLoc } from './file-size-hygiene.js';
import { loadFrozenFiles, writePlatformKernelNeeded } from './sanitize-locks.js';
import { logger } from './logger.js';
import type { SanitizeEngineResult } from './sanitize-types.js';

export interface PostWaveOptions {
  cwd: string;
  threshold?: number;          // default 750
  /** Skip the entire hook (e.g., for testing or opt-out). */
  disabled?: boolean;
  /** Sanitize at most this many violators per wave. */
  maxFilesPerWave?: number;    // default 3
  // Injection seams for testing
  _gitChangedFiles?: (cwd: string) => Promise<string[]>;
  _readFile?: (filePath: string) => Promise<string>;
  _runSanitize?: (opts: { cwd: string; pattern: string; yes: true; maxCycles: number }) => Promise<SanitizeEngineResult>;
}

export interface PostWaveResult {
  ran: boolean;
  reason?: string;
  ownedViolators: string[];
  frozenViolators: string[];
  sanitizeResult?: SanitizeEngineResult;
}

/**
 * Called after every successful forge wave (autoforge, ascend, magic).
 * Returns immediately when nothing crossed threshold or when disabled.
 */
export async function postWaveSanitize(options: PostWaveOptions): Promise<PostWaveResult> {
  if (options.disabled) {
    return { ran: false, reason: 'disabled', ownedViolators: [], frozenViolators: [] };
  }

  const cwd = options.cwd;
  const threshold = options.threshold ?? 750;
  const maxFiles = options.maxFilesPerWave ?? 3;

  const changedFiles = await (options._gitChangedFiles ?? getGitChangedFiles)(cwd);
  if (changedFiles.length === 0) {
    return { ran: false, reason: 'no-changed-files', ownedViolators: [], frozenViolators: [] };
  }

  const readFile = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

  // Filter to oversized changed files only
  const oversized: string[] = [];
  for (const relPath of changedFiles) {
    if (!relPath.endsWith('.ts') || relPath.endsWith('.test.ts') || relPath.endsWith('.d.ts')) continue;
    try {
      const content = await readFile(path.join(cwd, relPath));
      const loc = countMaintainableLoc(content);
      if (loc > threshold) oversized.push(relPath);
    } catch { /* file may be deleted; ignore */ }
  }

  if (oversized.length === 0) {
    return { ran: false, reason: 'no-violations', ownedViolators: [], frozenViolators: [] };
  }

  // Split into owned vs frozen
  const frozen = await loadFrozenFiles({ cwd });
  const ownedViolators = oversized.filter(f => !frozen.includes(f));
  const frozenViolators = oversized.filter(f => frozen.includes(f));

  if (frozenViolators.length > 0) {
    const filesWithLoc = await Promise.all(frozenViolators.map(async (f) => {
      try {
        const c = await readFile(path.join(cwd, f));
        return { path: f, loc: countMaintainableLoc(c) };
      } catch { return { path: f, loc: -1 }; }
    }));
    await writePlatformKernelNeeded({ cwd, files: filesWithLoc });
    logger.warn(`[auto-sanitize] ${frozenViolators.length} frozen file(s) over threshold — deferred to platform-kernel`);
  }

  if (ownedViolators.length === 0) {
    return { ran: false, reason: 'all-frozen', ownedViolators: [], frozenViolators };
  }

  // Run sanitize on owned files (cap at maxFilesPerWave)
  const toProcess = ownedViolators.slice(0, maxFiles);
  logger.info(`[auto-sanitize] Running sanitize on ${toProcess.length} changed-and-oversized file(s)`);

  const runSanitize = options._runSanitize ?? (async (opts) => {
    const { runSanitize: real } = await import('./sanitize-engine.js');
    return real(opts);
  });

  const result = await runSanitize({
    cwd,
    pattern: toProcess.join('|'),
    yes: true,
    maxCycles: toProcess.length * 2,
  });

  return {
    ran: true,
    ownedViolators: toProcess,
    frozenViolators,
    sanitizeResult: result,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getGitChangedFiles(cwd: string): Promise<string[]> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    // Files changed in working tree vs HEAD (or initial state if no commit)
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', 'HEAD'], { cwd });
    const tracked = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    // Plus untracked .ts files (newly created in this wave)
    const { stdout: untrackedOut } = await execFileAsync(
      'git', ['ls-files', '--others', '--exclude-standard'], { cwd },
    );
    const untracked = untrackedOut.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    return [...new Set([...tracked, ...untracked])];
  } catch {
    return [];  // not a git repo or git not available — silent no-op
  }
}
