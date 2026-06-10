// test-file-patterns.ts — canonical polyglot test-receipt recognition + language-aware
// seam patterns.
//
// ONE home for "what counts as the same test receipt" and "what counts as a seam".
// Consumers (all must agree, or the honesty gates disagree with the score engine):
//   - src/core/derived-score.ts                (T7 distinct-receipt veto — re-exports extractTestFiles)
//   - src/matrix/engines/outcome-integrity.ts  (cross-dim SHARED_RECEIPT, seam scan, UNSCANNABLE)
//   - src/matrix/engines/outcome-runner.ts     (tagEvidenceQuality file-content seam inspection)
//   - scripts/evidence-rescore.mjs             (plain-JS mirror between lockstep markers;
//     tests/evidence-rescore-drift.test.ts pins its behavior to this module over a shared
//     command table — extend BOTH together)
//
// The pre-polyglot version recognized ONLY JS (`*.test.ts[x]` / `*.test.js[x]`), so three
// Python outcomes pointing at one pytest file read as three distinct receipts, and a Go
// test importing testify/mock passed as EXTRACTED-quality evidence. Polyglot fleet repos
// (Rust + Python + Go) then rested on prompt discipline instead of structure.

export type TestFileLanguage = 'js' | 'python' | 'rust' | 'go';

// ── Receipt extraction regexes ────────────────────────────────────────────────
// JS recognition is byte-for-byte the historical extractPrimaryTestFiles regex —
// includes `/` so tests/a/x.test.ts ≠ tests/b/x.test.ts.
const JS_TEST_FILE_RE = /[\w./-]+\.test\.[jt]sx?/g;
// Python: any .py token; filtered by isPythonTestPath (test_*.py, *_test.py, tests/**.py).
const PY_FILE_RE = /[\w./-]+\.py\b/g;
// Rust: any .rs token; filtered by isRustTestPath (tests/*.rs, *_test.rs).
const RS_FILE_RE = /[\w./-]+\.rs\b/g;
// Go: only *_test.go files are tests, by language convention.
const GO_TEST_FILE_RE = /[\w./-]+_test\.go\b/g;

function baseName(p: string): string {
  const norm = p.replace(/\\/g, '/');
  return norm.split('/').pop() ?? norm;
}

function isPythonTestPath(p: string): boolean {
  const norm = p.replace(/\\/g, '/');
  const base = baseName(norm);
  return /^test_[\w.-]*\.py$/.test(base) || /_test\.py$/.test(base) || /(^|\/)tests?\//.test(norm);
}

function isRustTestPath(p: string): boolean {
  const norm = p.replace(/\\/g, '/');
  return /_test\.rs$/.test(baseName(norm)) || /(^|\/)tests\//.test(norm);
}

// ── Cargo / Go target pseudo-identifiers ──────────────────────────────────────
// `cargo test -p member --lib scanner` names NO file, yet it IS one receipt: two dims
// declaring the same cargo target are sharing one test suite. Same for `go test ./pkg/x`.
// We canonicalize the target into a pseudo-identifier so the distinct-receipt veto and
// the cross-dim shared-receipt detector can see the collision. A preceding `cd <dir>` is
// baked into the identity so monorepo members run from different directories never
// falsely collide.

const CARGO_VALUE_FLAGS = new Set([
  '-p', '--package', '--features', '--manifest-path', '--target', '--target-dir',
  '--profile', '-j', '--jobs', '--exclude', '--color', '--message-format', '--config', '-Z',
]);
const CARGO_TARGET_FLAGS = new Set(['--bin', '--test', '--example', '--bench']);
const GO_VALUE_FLAGS = new Set([
  '-run', '-bench', '-count', '-timeout', '-tags', '-ldflags', '-coverprofile',
  '-covermode', '-cpuprofile', '-memprofile', '-p', '-parallel', '-o', '-exec',
]);

function cdPrefix(command: string): string {
  const m = command.match(/(?:^|[&|;]\s*)cd\s+([^\s&|;]+)/);
  return m?.[1] ?? '';
}

/** Canonical receipt identity for a `cargo test` / `cargo nextest` invocation, or null. */
export function cargoTestIdentifier(command: string): string | null {
  const m = command.match(/\bcargo\s+(?:\+\S+\s+)?(?:test|nextest(?:\s+run)?)\b([^|&;]*)/);
  if (!m) return null;
  const tokens = (m[1] ?? '').trim().split(/\s+/).filter(Boolean);
  let pkg = '';
  let target = '';
  const filters: string[] = [];
  let passthrough = false; // after `--`, args go to the test binary itself
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === '--') { passthrough = true; continue; }
    if (passthrough) { if (!t.startsWith('-')) filters.push(t); continue; }
    if (t === '-p' || t === '--package') { pkg = tokens[++i] ?? ''; continue; }
    if (t.startsWith('--package=')) { pkg = t.slice('--package='.length); continue; }
    if (t === '--lib') { target = 'lib'; continue; }
    if (t === '--doc') { target = 'doc'; continue; }
    if (t === '--bins') { target = 'bins'; continue; }
    if (CARGO_TARGET_FLAGS.has(t)) { target = `${t.slice(2)}=${tokens[++i] ?? ''}`; continue; }
    if (CARGO_VALUE_FLAGS.has(t)) { i++; continue; }
    if (t.startsWith('-')) continue;
    filters.push(t); // positional test-name filter (e.g. a module path)
  }
  return `cargo-test:${cdPrefix(command)}:${pkg}:${target}:${filters.join(',')}`;
}

/** Canonical receipt identities for a `go test` invocation (one per package path). */
export function goTestIdentifiers(command: string): string[] {
  const m = command.match(/\bgo\s+test\b([^|&;]*)/);
  if (!m) return [];
  const cd = cdPrefix(command);
  const tokens = (m[1] ?? '').trim().split(/\s+/).filter(Boolean);
  const ids: string[] = [];
  let sawFileArg = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.startsWith('-')) {
      const name = t.includes('=') ? t.slice(0, t.indexOf('=')) : t;
      if (!t.includes('=') && GO_VALUE_FLAGS.has(name)) i++;
      continue;
    }
    // Explicit *.go file args carry their own identity via GO_TEST_FILE_RE.
    if (t.endsWith('.go')) { sawFileArg = true; continue; }
    ids.push(`go-test:${cd}:${t}`);
  }
  // Bare `go test` runs the current package — that IS the receipt identity.
  if (ids.length === 0 && !sawFileArg) ids.push(`go-test:${cd}:.`);
  return ids;
}

/** True when an extracted identifier is a cargo/go target identity, not a readable file. */
export function isPseudoReceiptId(id: string): boolean {
  return id.startsWith('cargo-test:') || id.startsWith('go-test:');
}

// ── Main extraction ───────────────────────────────────────────────────────────

/**
 * Extract test-receipt identifiers from a shell command. Returns a mix of:
 *   - JS test files     (tests/x.test.ts — historical recognition, unchanged)
 *   - Python test files (test_*.py, *_test.py, tests/**.py)
 *   - Rust test files   (tests/*.rs, *_test.rs)
 *   - Go test files     (*_test.go)
 *   - cargo/go target pseudo-identifiers (`cargo-test:…`, `go-test:…`) for file-less
 *     invocations, so two dims sharing one `cargo test -p m --lib mod` target are
 *     still detected as ONE receipt.
 */
export function extractTestFiles(command: string): string[] {
  const cmd = command ?? '';
  const found: string[] = [...(cmd.match(JS_TEST_FILE_RE) ?? [])];
  for (const f of cmd.match(PY_FILE_RE) ?? []) if (isPythonTestPath(f)) found.push(f);
  for (const f of cmd.match(RS_FILE_RE) ?? []) if (isRustTestPath(f)) found.push(f);
  found.push(...(cmd.match(GO_TEST_FILE_RE) ?? []));
  const cargoId = cargoTestIdentifier(cmd);
  if (cargoId) found.push(cargoId);
  found.push(...goTestIdentifiers(cmd));
  return [...new Set(found)];
}

// ── Language detection ────────────────────────────────────────────────────────

/** Language of a test-file path by extension. Null for pseudo-identifiers and unknowns. */
export function detectTestFileLanguage(file: string): TestFileLanguage | null {
  if (isPseudoReceiptId(file)) return null;
  if (/\.[cm]?[jt]sx?$/.test(file)) return 'js';
  if (/\.py$/.test(file)) return 'python';
  if (/\.rs$/.test(file)) return 'rust';
  if (/\.go$/.test(file)) return 'go';
  return null;
}

// ── Language-aware seam patterns ──────────────────────────────────────────────
// A "seam" is an injection/mocking idiom that lets a test prove a code path exists
// without exercising real behavior. Patterns are deliberately conservative: they match
// mocking IMPORTS/idioms, never general test infrastructure.
//
// Rust nuance (deliberate): inline `#[cfg(test)] mod tests` INSIDE the callsite file is
// INHERENT Rust unit-test coupling — the language's idiomatic honest test layout, NOT a
// seam. Never add `#\[cfg\(test\)\]` to the rust list.
// Go nuance (deliberate): `httptest` is NOT flagged — it spins up a real local HTTP
// server and is routinely legitimate; statically we cannot tell bypass from exercise.
export const SEAM_PATTERNS_BY_LANG: Record<TestFileLanguage, readonly RegExp[]> = {
  js: [
    /_cipCheck/,
    /_runPass/,
    /_runAutoforge/,
    /_runVerify/,
    /_now\b/,
    /_discover/,
    /_loadMatrix/,
    /_runAdapter/,
    /jest\.mock\(/,
    /vi\.mock\(/,
    /sinon\.stub\(/,
    /sinon\.mock\(/,
  ],
  python: [
    /\bunittest\.mock\b/,
    /\bfrom\s+unittest\s+import\s+mock\b/,
    /\bMagicMock\b/,
    /\bmock\.patch\b/,
    /\bmocker\.(?:patch|spy|stub|Mock|MagicMock|PropertyMock|AsyncMock)\b/, // pytest-mock fixture
    /\bmonkeypatch\.setattr\b/,
    /\bpytest_mock\b/,
    /\brequests_mock\b/,
    /^\s*import\s+responses\b/m,
    /\bresponses\.activate\b/,
  ],
  rust: [
    /\buse\s+mockall\b/,
    /\bmockall::/,
    /#\[automock\]/,
    /\bmock!\s*\{/,
    /\buse\s+mockito\b/,
    /\bmockito::/,
    /\buse\s+double\b/,
    /\bmock_trait!/,
    /\bmock_method!/,
  ],
  go: [
    /stretchr\/testify\/mock/,
    /mock\/gomock/, // covers github.com/golang/mock/gomock + go.uber.org/mock/gomock
  ],
};

/**
 * Seam patterns to apply to a test file's CONTENT, by its language.
 * Null for pseudo-identifiers (no file to read) and unrecognized languages —
 * callers must treat null as "cannot verify seam-freedom" (fail-closed via
 * UNSCANNABLE / INFERRED), never as clean.
 */
export function seamPatternsForFile(fileOrId: string): readonly RegExp[] | null {
  const lang = detectTestFileLanguage(fileOrId);
  return lang === null ? null : SEAM_PATTERNS_BY_LANG[lang];
}

// ── Unscannable (fail-closed) detection ───────────────────────────────────────
// A command that references a test file in a language with NO seam scanner (none of
// JS/Python/Rust/Go) cannot be verified seam-free. Silence must not read as
// cleanliness: outcome-integrity records an UNSCANNABLE warning and outcome-runner
// tags the evidence INFERRED, never EXTRACTED.

const FILE_TOKEN_RE = /[\w./-]+\.[A-Za-z][A-Za-z0-9]*/g;
// Data/asset extensions that are never test CODE — excluded so a fixture like
// tests/test_data.json is not mistaken for an unscannable test suite.
const NON_CODE_EXTENSIONS = new Set([
  'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'txt', 'md', 'csv', 'tsv',
  'xml', 'html', 'htm', 'css', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'lock', 'log', 'map', 'snap',
]);

function looksLikeTestFileName(token: string): boolean {
  const base = baseName(token);
  const stem = base.replace(/\.[A-Za-z][A-Za-z0-9]*$/, '');
  const segments = stem.toLowerCase().split(/[._-]+/);
  return segments.some(s => s === 'test' || s === 'tests' || s === 'spec' || s === 'specs');
}

/**
 * Test-file-looking tokens whose language has no seam scanner (e.g. foo_test.exs,
 * bar_spec.rb, run-tests.sh). These cannot be inspected for seams — fail closed.
 */
export function extractUnscannableTestFiles(command: string): string[] {
  const out: string[] = [];
  for (const token of (command ?? '').match(FILE_TOKEN_RE) ?? []) {
    if (detectTestFileLanguage(token) !== null) continue; // scannable language
    const ext = token.slice(token.lastIndexOf('.') + 1).toLowerCase();
    if (NON_CODE_EXTENSIONS.has(ext)) continue; // data/asset, not a test suite
    if (looksLikeTestFileName(token)) out.push(token);
  }
  return [...new Set(out)];
}
