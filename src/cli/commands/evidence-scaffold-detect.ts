// evidence-scaffold-detect.ts — capability-driven product-probe detection for evidence-scaffold.
//
// On a generic/cold repo (Python CLI, Rust tool, Go service) the dim-keyed scaffold maps in
// evidence-scaffold.ts find nothing, so every receipt-eligible dim used to get a failing
// `exit 1` outcome scaffold that the build loop churns on until a generator ceiling — wasted
// budget, no honest signal. This module inspects the TARGET repo for genuine runnable product
// entrypoints (package.json bin/scripts, pyproject [project.scripts] / setup.py console_scripts,
// Cargo [[bin]] / src/main.rs, go cmd/<name>/main.go) and returns honest probes:
//
//   - runnable (needsInput: false): a real product invocation whose arguments come from the
//     repo's own metadata or README usage block — NEVER invented by this module.
//   - candidate (needsInput: true): a real entrypoint exists but no realistic argument is
//     derivable; the caller keeps the failing scaffold and routes the dim to the yardstick
//     author (via scaffold_note) instead of churning.
//
// Honesty bar (mirrors frontier-spec.ts:looksLikeProductRun): a help/version screen renders for
// ANY install regardless of capability, so `<tool> --help` style derivations are rejected and
// can never become runnable probes.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProductProbe {
  /** The invocation. For needsInput candidates this is the bare entrypoint WITHOUT arguments. */
  command: string;
  language: 'node' | 'python' | 'rust' | 'go';
  source: 'bin' | 'scripts' | 'pyproject' | 'cargo' | 'go';
  /** Best-effort detection confidence (0..1). */
  confidence: number;
  /** True → a real entrypoint with no derivable realistic argument. Do not run as-is. */
  needsInput: boolean;
  /** When needsInput: what realistic input is missing (feeds the scaffold_note marker). */
  missingInput?: string;
}

type ReadFn = (p: string) => string | null;
type ReadDirFn = (p: string) => string[];

export interface DetectProbeSeams {
  /** Read a file's text; null when unreadable/absent. */
  _readFile?: ReadFn;
  /** List a directory; [] when unreadable/absent. */
  _readDir?: ReadDirFn;
}

// ── fs defaults ───────────────────────────────────────────────────────────────

function defaultReadFile(p: string): string | null {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function defaultReadDir(p: string): string[] {
  try { return readdirSync(p); } catch { return []; }
}

// ── README usage-block derivation ─────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Any help/version token turns the invocation into a help screen — rejected (proves nothing). */
function isHelpScreenArgs(args: string): boolean {
  const toks = args.split(/\s+/).filter(Boolean);
  if (toks.length === 0) return true;
  if (/^(?:help|version)$/i.test(toks[0]!)) return true;
  return toks.some(t => /^(?:--help|-h|--version)$/i.test(t));
}

/** Usage notation (`<file>`, `[options]`, `...`) documents WHERE an input goes, not WHAT it is —
 *  deriving from it would be inventing arguments, which this module never does. */
function containsUsageNotation(args: string): boolean {
  return /[<[][^<>[\]]*[>\]]/.test(args) || /\.{3}/.test(args);
}

function readReadme(cwd: string, read: ReadFn): string | null {
  for (const name of ['README.md', 'readme.md', 'Readme.md', 'README.markdown', 'README']) {
    const text = read(path.join(cwd, name));
    if (text !== null) return text;
  }
  return null;
}

/** Only lines from fenced/indented code blocks or `$ `-prompted lines qualify — matching prose
 *  ("mytool is a great tool") would derive fictional arguments. */
function readmeCommandLines(readme: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of readme.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(?:```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) out.push(line);
    else if (/^[$>]\s/.test(line)) out.push(line);
    else if (/^ {4,}\S/.test(raw)) out.push(line);
  }
  return out;
}

/** First README code-block line invoking `toolName` with real (non-help, non-notation) args. */
function deriveReadmeArgs(readme: string | null, toolName: string): string | null {
  if (!readme) return null;
  const re = new RegExp(`^(?:[$>]\\s+)?(?:\\S*[/\\\\])?${escapeRegExp(toolName)}\\s+(\\S.*)$`);
  for (const line of readmeCommandLines(readme)) {
    const m = re.exec(line);
    if (!m) continue;
    // Only the direct invocation's args are trustworthy — cut at pipes/chains/comments.
    const args = m[1]!.split(/\s*(?:\|\||&&|[|;#])\s*/)[0]!.trim();
    if (!args || isHelpScreenArgs(args) || containsUsageNotation(args)) continue;
    return args;
  }
  return null;
}

// ── Node route (package.json) ─────────────────────────────────────────────────

const PRODUCT_SCRIPT_NAME_RE = /^(?:start|serve|cli)(?:[:._-].*)?$/i;
const NON_PRODUCT_SCRIPT_RE = /\b(?:test|jest|vitest|mocha|tsc|eslint|lint|prettier|tsup|rollup|webpack|build)\b/i;
const HELP_FLAG_RE = /(?:^|\s)(?:--help|-h|--version)(?:\s|$)/i;

function detectNodeProbes(cwd: string, read: ReadFn): ProductProbe[] {
  const raw = read(path.join(cwd, 'package.json'));
  if (raw === null) return [];
  let pkg: Record<string, unknown>;
  try { pkg = JSON.parse(raw) as Record<string, unknown>; } catch { return []; }
  const probes: ProductProbe[] = [];

  // 1. scripts entries that run the product (start/serve/cli patterns). A script whose value
  //    is a test runner / bundler / help screen is not a product run and contributes nothing.
  const scripts = (pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}) as Record<string, unknown>;
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== 'string' || !PRODUCT_SCRIPT_NAME_RE.test(name)) continue;
    if (NON_PRODUCT_SCRIPT_RE.test(value) || HELP_FLAG_RE.test(value)) continue;
    probes.push({ command: `npm run ${name}`, language: 'node', source: 'scripts', confidence: 0.7, needsInput: false });
  }

  // 2. "bin" entries. `node <binpath> --help` is FORBIDDEN as a probe (help screens prove
  //    nothing — same bar as frontier-spec.ts:looksLikeProductRun). Only a REAL subcommand
  //    derived from the README usage block qualifies; when nothing real is derivable this
  //    route returns nothing (it never falls back to a help screen).
  const readme = readReadme(cwd, read);
  const bins: Array<[string, string]> = [];
  if (typeof pkg.bin === 'string') {
    bins.push([String(pkg.name ?? path.basename(cwd)), pkg.bin]);
  } else if (pkg.bin && typeof pkg.bin === 'object') {
    for (const [n, p2] of Object.entries(pkg.bin as Record<string, unknown>)) {
      if (typeof p2 === 'string') bins.push([n, p2]);
    }
  }
  for (const [name, binRel] of bins) {
    if (read(path.join(cwd, binRel)) === null) continue; // entry not built → not runnable
    const args = deriveReadmeArgs(readme, name);
    if (!args) continue;
    probes.push({
      command: `node ${binRel.replace(/\\/g, '/')} ${args}`,
      language: 'node', source: 'bin', confidence: 0.8, needsInput: false,
    });
  }
  return probes;
}

// ── Python route (pyproject.toml [project.scripts] / setup.py console_scripts) ─

function parsePyprojectScripts(text: string): Array<{ name: string; module: string }> {
  const out: Array<{ name: string; module: string }> = [];
  const section = /\[project\.scripts\]([\s\S]*?)(?=\n\s*\[|$)/.exec(text);
  if (!section) return out;
  for (const line of section[1]!.split(/\r?\n/)) {
    const m = /^\s*([\w.-]+)\s*=\s*["']([^"':]+)(?::[^"']*)?["']/.exec(line);
    if (m) out.push({ name: m[1]!, module: m[2]! });
  }
  return out;
}

function parseSetupPyConsoleScripts(text: string): Array<{ name: string; module: string }> {
  const out: Array<{ name: string; module: string }> = [];
  if (!text.includes('console_scripts')) return out;
  for (const m of text.matchAll(/["']([\w.-]+)\s*=\s*([\w.]+):[\w.]+["']/g)) {
    out.push({ name: m[1]!, module: m[2]! });
  }
  return out;
}

function detectPythonProbes(cwd: string, read: ReadFn): ProductProbe[] {
  const entries: Array<{ name: string; module: string }> = [];
  const pyproject = read(path.join(cwd, 'pyproject.toml'));
  if (pyproject !== null) entries.push(...parsePyprojectScripts(pyproject));
  const setupPy = read(path.join(cwd, 'setup.py'));
  if (setupPy !== null) entries.push(...parseSetupPyConsoleScripts(setupPy));
  if (entries.length === 0) return [];
  const readme = readReadme(cwd, read);
  return entries.map(({ name, module }) => {
    const args = deriveReadmeArgs(readme, name);
    return args
      ? { command: `python -m ${module} ${args}`, language: 'python' as const, source: 'pyproject' as const, confidence: 0.75, needsInput: false }
      : {
          command: `python -m ${module}`, language: 'python' as const, source: 'pyproject' as const, confidence: 0.4, needsInput: true,
          missingInput: `no realistic subcommand/argument for "${name}" is derivable from the README usage block`,
        };
  });
}

// ── Rust route (Cargo.toml [[bin]] / src/main.rs) ─────────────────────────────

function detectRustProbes(cwd: string, read: ReadFn): ProductProbe[] {
  const cargo = read(path.join(cwd, 'Cargo.toml'));
  if (cargo === null) return [];
  const names: string[] = [];
  for (const m of cargo.matchAll(/\[\[bin\]\][^[]*?name\s*=\s*["']([^"']+)["']/g)) names.push(m[1]!);
  if (names.length === 0 && read(path.join(cwd, 'src', 'main.rs')) !== null) {
    const pkg = /\[package\][^[]*?name\s*=\s*["']([^"']+)["']/.exec(cargo);
    if (pkg) names.push(pkg[1]!);
  }
  if (names.length === 0) return [];
  const readme = readReadme(cwd, read);
  return names.map(name => {
    const args = deriveReadmeArgs(readme, name);
    return args
      ? { command: `cargo run --quiet --bin ${name} -- ${args}`, language: 'rust' as const, source: 'cargo' as const, confidence: 0.7, needsInput: false }
      : {
          command: `cargo run --quiet --bin ${name}`, language: 'rust' as const, source: 'cargo' as const, confidence: 0.4, needsInput: true,
          missingInput: `no realistic argument for the "${name}" binary is derivable from the README usage block`,
        };
  });
}

// ── Go route (cmd/<name>/main.go) ─────────────────────────────────────────────

function detectGoProbes(cwd: string, read: ReadFn, readDir: ReadDirFn): ProductProbe[] {
  const cmdDir = path.join(cwd, 'cmd');
  const probes: ProductProbe[] = [];
  let readme: string | null | undefined;
  for (const entry of readDir(cmdDir)) {
    if (read(path.join(cmdDir, entry, 'main.go')) === null) continue;
    if (readme === undefined) readme = readReadme(cwd, read);
    const args = deriveReadmeArgs(readme, entry);
    probes.push(args
      ? { command: `go run ./cmd/${entry} ${args}`, language: 'go', source: 'go', confidence: 0.7, needsInput: false }
      : {
          command: `go run ./cmd/${entry}`, language: 'go', source: 'go', confidence: 0.4, needsInput: true,
          missingInput: `no realistic argument for "cmd/${entry}" is derivable from the README usage block`,
        });
  }
  return probes;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Inspect a TARGET repo for genuine runnable product entrypoints. Best-effort and honest:
 * runnable probes carry only arguments derived from the repo itself (scripts values, README
 * usage blocks); entrypoints with no derivable realistic argument come back as needsInput
 * candidates so the caller can route them to the yardstick author instead of churning.
 * Returned sorted: runnable probes first (confidence desc), then candidates.
 */
export function detectProductProbes(cwd: string, seams: DetectProbeSeams = {}): ProductProbe[] {
  const read = seams._readFile ?? defaultReadFile;
  const readDir = seams._readDir ?? defaultReadDir;
  const probes = [
    ...detectNodeProbes(cwd, read),
    ...detectPythonProbes(cwd, read),
    ...detectRustProbes(cwd, read),
    ...detectGoProbes(cwd, read, readDir),
  ];
  const seen = new Set<string>();
  return probes
    .filter(p => (seen.has(p.command) ? false : (seen.add(p.command), true)))
    .sort((a, b) => (Number(a.needsInput) - Number(b.needsInput)) || (b.confidence - a.confidence));
}
