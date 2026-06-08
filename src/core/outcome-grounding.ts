// outcome-grounding.ts — make any project's outcome suite HONEST, automatically.
//
// The universe-definer scaffolds dimensions with un-grounded outcomes: a
// required_callsite pointing at a sentinel string, a test file, or a module that is
// not wired into the product. This engine grounds them: for every outcome the
// integrity gate flags, it either
//   (a) GROUNDS it — repoints required_callsite to a real, production-wired module
//       that the outcome's SEAM-FREE test genuinely imports (recovers an honest
//       score, e.g. the decoupled-but-real case), or
//   (b) DOWNGRADES it to T2 (orphan-pending) — when the test is seamed, or no wired
//       module is exercised, or the outcome is un-grounded.
//
// It never invents evidence: it only ever points a callsite at a module the test actually
// imports AND that production code imports. Everything else is honestly downgraded.
// This is what makes "properly define all dimensions" repeatable + safe on any
// project (run, then validate — the score can't lie). The result is re-checked by
// the same gate that scores it.

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { extractPrimaryTestFiles } from './derived-score.js';
import { checkOutcomeIntegrity, buildWiredBasenames, commandHasSeams } from '../matrix/engines/outcome-integrity.js';
import { isTestSuiteCommand } from '../matrix/engines/outcome-quality.js';
import type { CompeteMatrix } from './compete-matrix.js';

const HIGH = new Set(['T5', 'T6', 'T7', 'T8']);

export type GroundingStatus = 'already-honest' | 'grounded' | 'downgraded' | 'partial';

export interface GroundingResult {
  dimId: string;
  status: GroundingStatus;
  /** Human-readable per-outcome changes applied. */
  changes: string[];
  /** Candidate wired modules a downgraded outcome could reach T5 against (after de-seaming). */
  suggestions: string[];
}

export interface GroundingSummary {
  results: GroundingResult[];
  counts: Record<GroundingStatus, number>;
}

interface LooseOutcome {
  id: string; tier: string; kind?: string; command?: string; required_callsite?: string; description?: string;
  cli_args?: string[]; expected_output_pattern?: string; expected_stdout_patterns?: string[];
}
interface LooseDim { id: string; outcomes?: LooseOutcome[] }

/**
 * Mutates `matrix` in place: grounds or honestly downgrades every gate-flagged
 * T5+ outcome. Caller decides whether to persist. Re-run the gate afterward to
 * confirm CLEAN.
 */
export async function groundOutcomes(opts: { matrix: CompeteMatrix; projectPath: string }): Promise<GroundingSummary> {
  const { matrix, projectPath } = opts;
  const dims = matrix.dimensions as unknown as LooseDim[];

  // Self-heal a known-broken flag before anything else: an outcome that runs Node's test runner
  // (`tsx --test` / `node --test`) but filters with `--grep` CRASHES with exit 9 (invalid argument) —
  // Node uses `--test-name-pattern`. Authors copy mocha's `--grep`; the command then always "fails"
  // even though the real tests pass. Correct it so the outcome actually runs. Scoped to node:test
  // commands (mocha legitimately uses --grep), so it never breaks a vitest/mocha command.
  for (const dim of dims) {
    for (const o of dim.outcomes ?? []) {
      if (o.command && /(?:^|\s)(?:tsx|node)\b[^|&;]*\s--test\b/.test(o.command) && o.command.includes('--grep ')) {
        o.command = o.command.replace(/--grep /g, '--test-name-pattern ');
      }
    }
  }

  // Self-heal a cli-smoke SCHEMA mismatch: an outcome labeled kind:'cli-smoke' but authored with the
  // SHELL schema (`command` + `expected_output_pattern`, no `cli_args`) silently FAILS. The cli-smoke
  // runner spawns `node dist/index.js <cli_args>` and ignores `command`, so an absent/null cli_args runs
  // the wrong thing (or throws on the spread). Two honest repairs: a test-runner command was never a CLI
  // smoke → relabel to 'runtime-exec'; a real product-CLI command → derive cli_args (+ move the pattern).
  for (const dim of dims) {
    for (const o of dim.outcomes ?? []) {
      if (o.kind === 'cli-smoke' && (!o.cli_args || o.cli_args.length === 0) && o.command) {
        if (isTestSuiteCommand(o.command)) {
          o.kind = 'runtime-exec'; // a test suite is runtime-exec evidence, not a real product CLI smoke
        } else {
          o.cli_args = toCliArgs(o.command);
          if (o.expected_output_pattern && !o.expected_stdout_patterns) o.expected_stdout_patterns = [o.expected_output_pattern];
          delete o.command;
          delete o.expected_output_pattern;
        }
      }
    }
  }

  const wired = await buildWiredBasenames(projectPath);
  const report = await checkOutcomeIntegrity(dims, projectPath);
  const dirty = new Set([...report.seamedDims, ...report.decoupledDims, ...report.orphanDims]);
  const results: GroundingResult[] = [];

  for (const dim of dims) {
    if (!dirty.has(dim.id)) { results.push({ dimId: dim.id, status: 'already-honest', changes: [], suggestions: [] }); continue; }
    const changes: string[] = [];
    const suggestions: string[] = [];
    let grounded = false, downgraded = false;

    for (const o of dim.outcomes ?? []) {
      if (!HIGH.has(o.tier)) continue;
      const flagged = report.violations.some(v => v.dimId === dim.id && v.outcomeId === o.id);
      if (!flagged) continue;

      const seamed = await commandHasSeams(o.command ?? '', projectPath);
      const cand = await findWiredCallsite(o.command ?? '', projectPath, wired);

      if (cand && !seamed) {
        if (o.required_callsite !== cand) {
          changes.push(`${o.id}: callsite ${o.required_callsite ?? '(none)'} -> ${cand} (real wired module the test exercises)`);
        }
        o.required_callsite = cand;
        grounded = true;
      } else {
        const reason = seamed ? 'seamed test (proves code paths, not real behavior)'
          : 'no production-wired module is exercised (orphan / un-grounded)';
        changes.push(`${o.id}: ${o.tier} -> T2 — ${reason} [honest orphan-pending]`);
        o.tier = 'T2';
        delete o.required_callsite;
        if (!/orphan-pending|downgraded to T2/i.test(o.description ?? '')) {
          o.description = `[grounded: downgraded to T2 — ${reason}] ${o.description ?? ''}`.trim();
        }
        downgraded = true;
        if (cand && seamed) suggestions.push(`${o.id}: de-seam its test to reach T5 against ${cand}`);
      }
    }

    const status: GroundingStatus = grounded && downgraded ? 'partial' : grounded ? 'grounded' : 'downgraded';
    results.push({ dimId: dim.id, status, changes, suggestions });
  }

  const counts: Record<GroundingStatus, number> = { 'already-honest': 0, grounded: 0, downgraded: 0, partial: 0 };
  for (const r of results) counts[r.status] += 1;
  return { results, counts };
}

/** Convert a shell-schema cli-smoke `command` into the `cli_args[]` the cli-smoke runner expects. The
 *  runner already supplies the `node dist/index.js` binary, so strip that (or a `danteforge`) prefix,
 *  then tokenize honoring single/double quotes (so `--name 'a b'` stays one arg). */
function toCliArgs(command: string): string[] {
  const stripped = command.replace(/^\s*(?:node\s+dist\/index\.js|(?:npx\s+)?danteforge)\s*/i, '').trim();
  const args: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) args.push(m[1] ?? m[2] ?? m[3] ?? '');
  return args;
}

// Find a real, production-wired module that the outcome's test file genuinely imports.
async function findWiredCallsite(command: string, projectPath: string, wired: Set<string>): Promise<string | null> {
  for (const abs of locateTestFiles(command, projectPath)) {
    let content: string;
    try { content = await fs.readFile(abs, 'utf8'); } catch { continue; }
    for (const spec of extractLocalImports(content)) {
      const base = path.basename(spec).replace(/\.[cm]?[jt]sx?$/, '');
      if (!wired.has(base)) continue;
      const resolved = resolveToProject(abs, spec, projectPath);
      if (resolved) return resolved;
    }
  }
  return null;
}

// Candidate absolute paths for the command's test file(s) — handles `cd <dir> && ...`
// (monorepo) plus the standard tests/ src/ project-root locations.
function locateTestFiles(command: string, projectPath: string): string[] {
  const cd = command.match(/cd\s+([^\s&|;]+)/);
  const baseDir = cd ? path.join(projectPath, cd[1]!) : projectPath;
  const out: string[] = [];
  for (const tf of extractPrimaryTestFiles(command)) {
    for (const root of [baseDir, projectPath, path.join(projectPath, 'tests'), path.join(projectPath, 'src')]) {
      out.push(path.join(root, tf));
    }
  }
  return out;
}

function extractLocalImports(content: string): string[] {
  const out: string[] = [];
  // JS/TS + Go (quoted specifiers).
  for (const m of content.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const s = m[1]!;
    if (s.startsWith('.') || s.includes('/src/')) out.push(s);
  }
  // Python: `from a.b.c import X` / `import a.b.c` (unquoted) — dotted module → path spec.
  for (const m of content.matchAll(/^[ \t]*from[ \t]+([.\w]+)[ \t]+import\b/gm)) out.push(m[1]!.replace(/\./g, '/'));
  for (const m of content.matchAll(/^[ \t]*import[ \t]+([.\w]+)/gm)) out.push(m[1]!.replace(/\./g, '/'));
  return out;
}

// Resolve a test's import specifier to a project-relative module path that exists. Language-aware:
// resolves JS/TS, Python (.py), Rust (.rs), and Go (.go) so non-JS callsites can be grounded.
function resolveToProject(testAbs: string, spec: string, projectPath: string): string | null {
  const baseAbs = (spec.startsWith('.') ? path.resolve(path.dirname(testAbs), spec) : path.join(projectPath, spec))
    .replace(/\.([cm]?[jt]sx?|py|rs|go)$/, '');
  for (const ext of ['.ts', '.tsx', '.mts', '.js', '.py', '.rs', '.go']) {
    if (existsSync(baseAbs + ext)) {
      return path.relative(projectPath, baseAbs + ext).split(path.sep).join('/');
    }
  }
  return null;
}
