// autoresearch-integrity.ts — guards that stop the autoresearch loop from reward-hacking.
//
// The single most damaging autoresearch failure mode is reward-hacking: an experiment "improves" the
// metric by GUTTING the capability_test it is supposed to be optimizing (DanteAgents observed a
// 468-line proof script overwritten with a broken stub, committed as a win — the test went from
// failing to not even parsing). These pure helpers make the yardstick off-limits and refuse to
// measure a syntactically broken edit, so a destroyed test can never masquerade as an improvement.

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { splitCommand } from '../../core/autoresearch-engine.js';
import { MATRIX_SCORE_SURFACE_PATTERNS } from '../../matrix/types/agent-evidence.js';
import { matchesAnyGlob } from '../../matrix/util/glob.js';

const execFileAsync = promisify(execFile);

/**
 * Files the experiment loop must NEVER edit: the scripts the measurement command itself runs (the
 * yardstick), plus the kernel-owned score surfaces. Any path-like token in the measurement command
 * is treated as the yardstick and protected.
 */
export function collectForbiddenTargets(measurementCommand: string, cwd: string): string[] {
  const forbidden = new Set<string>();
  for (const tok of splitCommand(measurementCommand)) {
    if (!tok || tok.startsWith('-')) continue;
    if (/[\\/]/.test(tok) || /\.(mjs|cjs|js|ts|mts|cts|py|sh|rb|go|json|yaml|yml)$/i.test(tok)) {
      forbidden.add(path.resolve(cwd, tok));
    }
  }
  return [...forbidden];
}

/**
 * Returns a human-readable reason if `fileToChange` is off-limits, or null if the edit is allowed.
 * Blocks: path-escape outside the project, the measurement command's own scripts, and score surfaces.
 */
export function forbiddenTargetReason(fileToChange: string, cwd: string, forbidden: string[]): string | null {
  const target = path.resolve(cwd, fileToChange);
  const rel = path.relative(cwd, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return 'a path outside the project tree';
  }
  if (forbidden.includes(target)) {
    return "the measurement command's own script (editing the yardstick is reward-hacking)";
  }
  if (matchesAnyGlob(rel, [...MATRIX_SCORE_SURFACE_PATTERNS])) {
    return 'a kernel-owned score surface';
  }
  return null;
}

/**
 * After an edit is applied, confirm the file still parses. A broken edit (e.g. a shell command pasted
 * into a `.mjs`) must not be measured — a test that crashes differently can still print a "better"
 * number. Uses `node --check` for JS/MJS/CJS and `JSON.parse` for JSON; other types are passed through
 * (no cheap, reliable parser). Returns an error string if the edit is broken, or null if it parses.
 */
export async function checkEditParses(
  fileToChange: string,
  cwd: string,
  readFileFn: (p: string) => Promise<string> = (p) => fs.readFile(p, 'utf8'),
  execFn: (file: string, args: string[], opts: { cwd: string }) => Promise<unknown> = (f, a, o) => execFileAsync(f, a, o),
): Promise<string | null> {
  const ext = path.extname(fileToChange).toLowerCase();
  const target = path.resolve(cwd, fileToChange);
  if (ext === '.json') {
    try { JSON.parse(await readFileFn(target)); return null; }
    catch (e) { return `invalid JSON: ${e instanceof Error ? e.message : String(e)}`; }
  }
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    try { await execFn(process.execPath, ['--check', target], { cwd }); return null; }
    catch (e) { return `syntax error: ${(e as { stderr?: string }).stderr?.split('\n')[0] ?? (e instanceof Error ? e.message : String(e))}`; }
  }
  return null; // Unknown type — no reliable cheap parse; allow.
}
