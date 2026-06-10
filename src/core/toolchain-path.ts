// toolchain-path.ts — gate subprocesses must resolve the SAME toolchains the operator's shell does.
//
// On Windows, cargo/go (and friends) live in PER-USER directories that installers append to the
// USER environment; a cmd.exe child spawned from a long-lived process can miss them, so a bare
// `cargo test` exits 1 with "not recognized". On DanteSecurity that capped EVERY Rust dim at 0
// until absolute paths were hand-declared into matrix.json — a non-portable declaration that breaks
// on the next machine. The honest fix is environmental: prepend the well-known per-user toolchain
// directories that actually EXIST on this machine to PATH for every gate subprocess, so declared
// outcome commands stay portable (`cargo test -p member --lib mod`) and still run.
//
// This augments only — it never removes or reorders the operator's existing PATH entries, and it
// adds nothing that is not present on disk.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Candidate per-user/toolchain dirs, checked for existence before being added. */
function candidateDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.cargo', 'bin'),                 // rustup default
    path.join(home, 'go', 'bin'),                     // go install target
    'C:\\Program Files\\Go\\bin',                     // go toolchain (system installer)
    path.join(home, '.local', 'bin'),                 // pipx / user-local installs
  ];
}

let cachedSuffix: string | null = null;

/** The PATH suffix of existing toolchain dirs (computed once per process). */
function toolchainPathSuffix(): string {
  if (cachedSuffix === null) {
    cachedSuffix = candidateDirs()
      .filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } })
      .join(path.delimiter);
  }
  return cachedSuffix;
}

/**
 * A copy of `base` (default: process.env) whose PATH additionally resolves the machine's real
 * toolchain dirs. Existing entries win (the dirs are APPENDED), the platform's PATH key casing is
 * preserved (Windows commonly uses `Path`), and dirs already on PATH are not duplicated.
 */
export function toolchainEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const suffix = toolchainPathSuffix();
  if (!suffix) return base;
  const env: NodeJS.ProcessEnv = { ...base };
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH';
  const current = env[pathKey] ?? '';
  const have = new Set(current.split(path.delimiter).map(p => p.trim().toLowerCase()).filter(Boolean));
  const additions = suffix.split(path.delimiter).filter(d => !have.has(d.toLowerCase()));
  if (additions.length === 0) return base;
  env[pathKey] = current ? `${current}${path.delimiter}${additions.join(path.delimiter)}` : additions.join(path.delimiter);
  return env;
}

/** Test seam: reset the per-process cache so existence checks re-run. */
export function _resetToolchainPathCache(): void { cachedSuffix = null; }
