// Matrix Kernel — Verify-Court Test Config
//
// Loads `.danteforge/test-config.json` and returns a VerifyTestConfig the
// verification-court consults when running `npm test` for a lease. The
// config controls three knobs:
//
//   - knownFlaky: regex patterns of test names to skip during verify-court
//     (set via TEST_SKIP_PATTERNS env var picked up by the test runner).
//   - alwaysRun: glob/path patterns of test files that ALWAYS run regardless
//     of diff-aware scoping (Phase 3 of the Battle Station plan).
//   - scopeToDiff: default whether to scope `npm test` to the lease's diff
//     blast radius (false today; flipped after Phase 5 validation).
//
// Missing config file is fine — defaults are conservative (no skips, two
// load-bearing always-run tests, full-suite mode).

import fs from 'node:fs/promises';
import path from 'node:path';

const CONFIG_PATH = path.join('.danteforge', 'test-config.json');

export interface VerifyTestConfig {
  /** Regex patterns for test names that should be skipped during verify-court. */
  knownFlaky: string[];
  /** Test file patterns that ALWAYS run regardless of diff-scoping. */
  alwaysRun: string[];
  /** Default whether to scope tests to lease diff (Phase 3). */
  scopeToDiff: boolean;
}

const DEFAULT_CONFIG: VerifyTestConfig = {
  knownFlaky: [],
  alwaysRun: [
    'tests/matrix-golden-flow.test.ts',
    'tests/command-skill-coverage.test.ts',
  ],
  scopeToDiff: false,
};

export interface LoadVerifyTestConfigOptions {
  cwd?: string;
  /** Injection seam for tests — overrides fs.readFile. */
  _readFile?: (p: string, enc: BufferEncoding) => Promise<string>;
}

/**
 * Load the verify-court test config from `<cwd>/.danteforge/test-config.json`.
 * Returns merged-with-defaults shape; missing keys fall back to the default.
 * Missing file is non-fatal — defaults are returned.
 */
export async function loadVerifyTestConfig(
  options: LoadVerifyTestConfigOptions = {},
): Promise<VerifyTestConfig> {
  const cwd = options.cwd ?? process.cwd();
  const read = options._readFile ?? ((p: string, enc: BufferEncoding) => fs.readFile(p, enc) as Promise<string>);
  const fullPath = path.join(cwd, CONFIG_PATH);

  let raw: string;
  try {
    raw = await read(fullPath, 'utf8');
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  let parsed: Partial<VerifyTestConfig>;
  try {
    parsed = JSON.parse(raw) as Partial<VerifyTestConfig>;
  } catch (err) {
    throw new Error(
      `loadVerifyTestConfig: ${fullPath} is not valid JSON. ` +
      `Either fix the file or delete it to fall back to defaults. ` +
      `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    knownFlaky: Array.isArray(parsed.knownFlaky) ? parsed.knownFlaky : DEFAULT_CONFIG.knownFlaky,
    alwaysRun: Array.isArray(parsed.alwaysRun) ? parsed.alwaysRun : DEFAULT_CONFIG.alwaysRun,
    scopeToDiff: typeof parsed.scopeToDiff === 'boolean' ? parsed.scopeToDiff : DEFAULT_CONFIG.scopeToDiff,
  };
}

/**
 * Build a regex pipe-pattern from the config's knownFlaky array, suitable for
 * the `TEST_SKIP_PATTERNS` env var consumed by `scripts/run-test-suite.mjs`.
 * Returns an empty string when no skips are configured (caller should NOT
 * set the env var in that case — empty regex matches everything).
 */
export function buildSkipPatternEnv(config: VerifyTestConfig): string {
  if (config.knownFlaky.length === 0) return '';
  return config.knownFlaky.join('|');
}

/** Exposed for tests so they don't have to know the default shape verbatim. */
export function getDefaultVerifyTestConfig(): VerifyTestConfig {
  return { ...DEFAULT_CONFIG, alwaysRun: [...DEFAULT_CONFIG.alwaysRun], knownFlaky: [...DEFAULT_CONFIG.knownFlaky] };
}
