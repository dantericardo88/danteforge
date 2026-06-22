// repo-signal-grounding.ts — the per-project grounding harness seed (council pivot, 2026-06-22).
//
// THE PROBLEM it resolves: a cold repo (and an ungrounded fleet matrix) reads currentScore 0 because no real
// evidence has been run — current-state-scorer.ts:66 hardcodes `score = 0` in local mode. The council's verdict
// (Grok+Claude+Codex unanimous): the universal blocker to autonomous dev is NOT the solver, it is the missing
// per-project oracle — runnable, env-matched signals that ground a score against reality instead of LLM opinion.
//
// THE HONEST CONTRACT (guards against the CH-044/CH-048 fabrication trap the council flagged):
//   • A dimension is grounded ONLY from a signal that was actually gathered (a test that ran, a build that
//     compiled). Presence ≠ grounding; an LLM's opinion ≠ grounding.
//   • Test-suite / build evidence caps at 7.0 (T4 — proves the code runs in isolation, not production behaviour),
//     matching the derived-score doctrine that demotes test-suite outcomes to T4/7.0.
//   • A dimension with NO automatable signal returns score=null (explicitly UNSCORED), never a fabricated number.
//     Unscored is honest; a confident 7.0 with no evidence is the fiction this whole project exists to refuse.

/** Real, gathered signals about a repo. `null` = not gathered / not applicable (never silently treated as a pass). */
export interface RepoSignals {
  stack: 'node' | 'python' | 'rust' | 'go' | 'unknown';
  buildPasses: boolean | null;
  typecheckPasses: boolean | null;
  lintPasses: boolean | null;
  testsPresent: boolean;
  testsPass: boolean | null;
  hasCI: boolean;
  hasReadme: boolean;
}

/** The honest grounding of one dimension: a capped score from a named real basis, or null (unscored). */
export interface DimGrounding {
  score: number | null;
  /** Human-readable provenance — what real signal grounded (or failed to ground) this dim. */
  basis: string;
  /** Tier of the evidence: 'test'/'build'/'static' cap at 7.0; null when unscored. */
  evidence: 'test' | 'build' | 'static' | null;
}

const T4_CAP = 7.0; // test-suite / build evidence ceiling (derived-score doctrine)

/** Detect the repo's stack from marker files (pure — caller injects an existence check). */
export function detectStack(exists: (rel: string) => boolean): RepoSignals['stack'] {
  if (exists('package.json')) return 'node';
  if (exists('pyproject.toml') || exists('setup.py') || exists('requirements.txt')) return 'python';
  if (exists('Cargo.toml')) return 'rust';
  if (exists('go.mod')) return 'go';
  return 'unknown';
}

/**
 * Ground ONE dimension from gathered signals. Pure + deterministic. Returns score=null (UNSCORED) whenever no
 * real signal applies — the load-bearing honesty rule. Caps every grounded score at 7.0 because runnable
 * isolation evidence cannot honestly certify production-grade (>7 needs the external-grounding gate / ratify).
 */
export function groundDimFromSignals(category: string, id: string, s: RepoSignals): DimGrounding {
  const c = `${category} ${id}`.toLowerCase();

  if (/\btest|coverage|qa\b/.test(c)) {
    if (s.testsPass === true) return { score: T4_CAP, basis: 'test suite runs green', evidence: 'test' };
    if (s.testsPass === false) return { score: 3.0, basis: 'test suite present but FAILS', evidence: 'test' };
    if (s.testsPresent) return { score: 5.0, basis: 'tests present, not executed', evidence: 'static' };
    return { score: null, basis: 'no tests — unscored', evidence: null };
  }
  if (/\bfunctional|core|reliab|correct|build|compil/.test(c)) {
    if (s.buildPasses === true) return { score: T4_CAP, basis: 'builds/compiles clean', evidence: 'build' };
    if (s.buildPasses === false) return { score: 3.0, basis: 'build FAILS', evidence: 'build' };
    return { score: null, basis: 'no build signal — unscored', evidence: null };
  }
  if (/\bmaintain|quality|type|lint|clean/.test(c)) {
    if (s.typecheckPasses === true && s.lintPasses === true) return { score: T4_CAP, basis: 'typecheck + lint clean', evidence: 'build' };
    if (s.typecheckPasses === false || s.lintPasses === false) return { score: 4.0, basis: 'typecheck/lint reports issues', evidence: 'build' };
    if (s.typecheckPasses === true || s.lintPasses === true) return { score: 6.0, basis: 'one of typecheck/lint clean', evidence: 'build' };
    return { score: null, basis: 'no type/lint signal — unscored', evidence: null };
  }
  if (/\bdoc|readme|onboard\b/.test(c)) {
    return s.hasReadme ? { score: 5.0, basis: 'README present', evidence: 'static' } : { score: null, basis: 'no docs — unscored', evidence: null };
  }
  if (/\bci|devops|pipeline|release|deploy/.test(c)) {
    return s.hasCI ? { score: 6.0, basis: 'CI workflow configured', evidence: 'static' } : { score: null, basis: 'no CI — unscored', evidence: null };
  }
  return { score: null, basis: 'no automatable signal — needs LLM assess or human ratify', evidence: null };
}

/**
 * Gather real signals from a repo. Runs ONLY safe, bounded checks (no full arbitrary test suite by default — the
 * council's flagged hardware risk); the caller injects `run` (a bounded shell runner returning exit code) and
 * `exists`. Any check that errors/times out yields `null` for that signal — honest, never an assumed pass.
 * `runTests` is opt-in (off by default) because an arbitrary repo's suite is the unsafe/slow part.
 */
export async function gatherRepoSignals(
  deps: {
    exists: (rel: string) => boolean;
    run: (cmd: string) => Promise<number>; // resolves to exit code; rejects/throws → null signal
    runTests?: boolean;
  },
): Promise<RepoSignals> {
  const { exists, run } = deps;
  const stack = detectStack(exists);
  const tryRun = async (cmd: string | null): Promise<boolean | null> => {
    if (!cmd) return null;
    try { return (await run(cmd)) === 0; } catch { return null; }
  };

  // Stack-appropriate, SAFE commands (build/typecheck/lint). Tests are gated behind runTests.
  // HONESTY GUARD: a command is only run when its config actually exists — else null (unscored), never a
  // false pass. (A Node typecheck without tsconfig.json, or a `--if-present` no-op, would otherwise report a
  // fabricated "clean" — the CH-044 trap one layer down.)
  const cmds = COMMANDS_BY_STACK[stack];
  const hasTsconfig = exists('tsconfig.json');
  const buildPasses = await tryRun(cmds.build);
  const typecheckPasses = stack === 'node' && !hasTsconfig ? null : await tryRun(cmds.typecheck);
  const lintPasses = await tryRun(cmds.lint);
  const testsPresent = exists('tests') || exists('test') || exists('__tests__') || exists('spec');
  const testsPass = deps.runTests ? await tryRun(cmds.test) : null;

  return {
    stack,
    buildPasses,
    typecheckPasses,
    lintPasses,
    testsPresent,
    testsPass,
    hasCI: exists('.github/workflows') || exists('.gitlab-ci.yml') || exists('.circleci'),
    hasReadme: exists('README.md') || exists('README') || exists('readme.md'),
  };
}

/** Safe, bounded check commands per stack. `null` = no safe universal command for that stack. */
const COMMANDS_BY_STACK: Record<RepoSignals['stack'], { build: string | null; typecheck: string | null; lint: string | null; test: string | null }> = {
  // Node: `--if-present` is a false-pass (no script → exit 0 → fabricated "clean"), so build/lint are dropped;
  // the honest Node signal is a real typecheck, and it only runs when tsconfig.json exists (gated in gather).
  node:   { build: null, typecheck: 'npx -y tsc --noEmit', lint: null, test: 'npm test' },
  python: { build: 'python -m compileall -q .', typecheck: null, lint: null, test: 'python -m pytest -q' },
  rust:   { build: 'cargo build -q', typecheck: 'cargo check -q', lint: 'cargo clippy -q', test: 'cargo test -q' },
  go:     { build: 'go build ./...', typecheck: 'go vet ./...', lint: null, test: 'go test ./...' },
  unknown:{ build: null, typecheck: null, lint: null, test: null },
};
