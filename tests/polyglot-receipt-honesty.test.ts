// polyglot-receipt-honesty.test.ts — gap-map rank 9: the evidence-quality machinery
// must see Python/Rust/Go receipts and seams, not just JS.
//
// Before this, extractPrimaryTestFiles matched ONLY *.test.[jt]sx? — so the T7
// distinct-receipt veto and cross-dim shared-receipt detection were blind to pytest /
// cargo / go-test receipts, and the seam scan recognized only JS idioms: a Python test
// importing unittest.mock or a Go test importing testify/mock read as EXTRACTED-quality
// evidence. Fail-closed addition: a test file in a language with NO seam scanner is
// UNSCANNABLE (WARN) and its evidence is INFERRED — silence must not read as cleanliness.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  checkOutcomeIntegrity,
  commandHasSeams,
  integrityCapFor,
} from '../src/matrix/engines/outcome-integrity.js';
import {
  extractTestFiles,
  extractUnscannableTestFiles,
  detectTestFileLanguage,
  seamPatternsForFile,
  SEAM_PATTERNS_BY_LANG,
} from '../src/matrix/engines/test-file-patterns.js';
import { runOneOutcome } from '../src/matrix/engines/outcome-runner.js';
import type { Outcome, OutcomeEvidenceEntry } from '../src/matrix/types/outcome.js';

// Real temp project on the X: drive (never C:/os.tmpdir for persistent artifacts).
const R = path.join(os.tmpdir(), `polyglot-honesty-${process.pid}`);

before(async () => {
  await fs.mkdir(path.join(R, 'tests'), { recursive: true });
  await fs.mkdir(path.join(R, 'src'), { recursive: true });
  await fs.mkdir(path.join(R, 'pkg', 'scan'), { recursive: true });
  // Python: a seamed test (unittest.mock + MagicMock) and a clean one.
  await fs.writeFile(path.join(R, 'tests', 'test_seamy.py'),
    'from unittest import mock\nfrom unittest.mock import MagicMock\n\n' +
    'def test_scan():\n    m = MagicMock()\n    assert m is not None\n', 'utf8');
  await fs.writeFile(path.join(R, 'tests', 'test_clean.py'),
    'from app.scanner import scan\n\ndef test_scan():\n    assert scan("x") == []\n', 'utf8');
  // Go: a test importing testify/mock (a seam) lives next to its package.
  await fs.writeFile(path.join(R, 'pkg', 'scan', 'scan_test.go'),
    'package scan\n\nimport (\n\t"testing"\n\n\t"github.com/stretchr/testify/mock"\n)\n\n' +
    'func TestScan(t *testing.T) { _ = mock.Mock{} }\n', 'utf8');
  // Rust: a CALLSITE file with INLINE #[cfg(test)] mod tests — the language's idiomatic
  // honest unit-test layout (inherent coupling), which must NEVER read as a seam.
  await fs.writeFile(path.join(R, 'src', 'scanner.rs'),
    'pub fn scan(input: &str) -> usize { input.len() }\n\n' +
    '#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n' +
    '    fn scans() { assert_eq!(scan("ab"), 2); }\n}\n', 'utf8');
  // Production wiring for the rust callsite (so the orphan check stays quiet).
  await fs.writeFile(path.join(R, 'src', 'main.rs'),
    'mod scanner;\n\nfn main() { let _ = scanner::scan("input"); }\n', 'utf8');
  // Rust integration tests: one seamed (mockall import), one clean that ALSO carries
  // an inline #[cfg(test)] block — only the mockall one may flag.
  await fs.writeFile(path.join(R, 'tests', 'scanner_seamed_test.rs'),
    'use mockall::predicate::*;\n\n#[test]\nfn scans() { assert!(true); }\n', 'utf8');
  await fs.writeFile(path.join(R, 'tests', 'scanner_clean_test.rs'),
    '#[cfg(test)]\nmod tests {\n    #[test]\n    fn scans() { assert_eq!(2 + 2, 4); }\n}\n', 'utf8');
});

after(async () => { await fs.rm(R, { recursive: true, force: true }).catch(() => {}); });

// ── Unit: canonical extraction ────────────────────────────────────────────────

describe('extractTestFiles — polyglot receipt recognition', () => {
  test('JS recognition is unchanged (historical regex)', () => {
    assert.deepEqual(extractTestFiles('npx tsx --test tests/a/x.test.ts tests/b/x.test.ts'),
      ['tests/a/x.test.ts', 'tests/b/x.test.ts']);
  });

  test('pytest files are receipts; non-test .py files are not', () => {
    assert.deepEqual(extractTestFiles('python -m pytest tests/test_pipeline.py -q'), ['tests/test_pipeline.py']);
    assert.deepEqual(extractTestFiles('pytest src/pkg/scanner_test.py::TestScanner'), ['src/pkg/scanner_test.py']);
    assert.deepEqual(extractTestFiles('python scripts/sample.py'), [], 'a plain script is not a test receipt');
  });

  test('a file-less cargo target is a pseudo-identifier — same target collides, different stays distinct', () => {
    const a = extractTestFiles('cargo test -p member --lib scanner');
    const b = extractTestFiles('cargo test -p member --lib scanner -- --nocapture');
    const c = extractTestFiles('cargo test -p member --lib other_mod');
    assert.equal(a.length, 1);
    assert.ok(a[0]!.startsWith('cargo-test:'), 'cargo target gets a pseudo-identifier');
    assert.deepEqual(a, b, 'binary passthrough flags do not change the receipt identity');
    assert.notDeepEqual(a, c, 'a different module filter is a different receipt');
  });

  test('go test package paths are pseudo-identifiers; *_test.go file args keep their file identity', () => {
    assert.deepEqual(extractTestFiles('go test ./pkg/scan -run TestScan'), ['go-test::./pkg/scan']);
    assert.deepEqual(extractTestFiles('go test ./internal/scan/scan_test.go'), ['./internal/scan/scan_test.go']);
    assert.deepEqual(extractTestFiles('cd services/api && go test ./handlers'), ['go-test:services/api:./handlers']);
  });

  test('unknown-language test files extract nothing but ARE detected as unscannable', () => {
    assert.deepEqual(extractTestFiles('mix test test/foo_test.exs'), []);
    assert.deepEqual(extractUnscannableTestFiles('mix test test/foo_test.exs'), ['test/foo_test.exs']);
    assert.deepEqual(extractUnscannableTestFiles('npx tsx --test tests/x.test.ts'), [], 'JS is scannable');
    assert.deepEqual(extractUnscannableTestFiles('node dist/index.js validate --config tests/test_data.json'), [],
      'data fixtures are not test suites');
  });

  test('language detection: pseudo-identifiers and unknown extensions are null', () => {
    assert.equal(detectTestFileLanguage('tests/x.test.ts'), 'js');
    assert.equal(detectTestFileLanguage('tests/test_a.py'), 'python');
    assert.equal(detectTestFileLanguage('tests/a_test.rs'), 'rust');
    assert.equal(detectTestFileLanguage('pkg/a_test.go'), 'go');
    assert.equal(detectTestFileLanguage('cargo-test::member:lib:mod'), null);
    assert.equal(detectTestFileLanguage('test/foo_test.exs'), null);
    assert.equal(seamPatternsForFile('cargo-test::member:lib:mod'), null);
  });
});

// ── Cross-dim SHARED_RECEIPT (polyglot) ───────────────────────────────────────

describe('checkOutcomeIntegrity — polyglot SHARED_RECEIPT', () => {
  test('(a) 3 dims declaring the same pytest file are flagged + capped at 7.0', async () => {
    const cmd = 'python -m pytest tests/test_clean.py';
    const dims = [
      { id: 'dimA', outcomes: [{ id: 'oa', tier: 'T5', command: cmd }] },
      { id: 'dimB', outcomes: [{ id: 'ob', tier: 'T5', command: cmd }] },
      { id: 'dimC', outcomes: [{ id: 'oc', tier: 'T5', command: cmd }] },
    ];
    const report = await checkOutcomeIntegrity(dims, R);
    for (const d of ['dimA', 'dimB', 'dimC']) {
      assert.ok(report.sharedReceiptDims.includes(d), `${d} must be flagged for sharing one pytest receipt`);
    }
    assert.ok(report.violations.some(v => v.kind === 'SHARED_RECEIPT' && v.detail.includes('tests/test_clean.py')));
    assert.deepEqual(integrityCapFor(8.0, 'dimA', report), { cappedScore: 7.0, integrityCap: 'SHARED_RECEIPT' });
  });

  test('2 dims sharing one pytest file are NOT flagged (existing 3+ policy holds for all languages)', async () => {
    const cmd = 'python -m pytest tests/test_clean.py';
    const dims = [
      { id: 'dimA', outcomes: [{ id: 'oa', tier: 'T5', command: cmd }] },
      { id: 'dimB', outcomes: [{ id: 'ob', tier: 'T5', command: cmd }] },
    ];
    const report = await checkOutcomeIntegrity(dims, R);
    assert.deepEqual(report.sharedReceiptDims, []);
  });

  test('(b) 3 dims declaring the same `cargo test -p member --lib mod` target share ONE receipt', async () => {
    const cmd = 'cargo test -p member --lib scanner';
    const dims = [
      { id: 'rustA', outcomes: [{ id: 'oa', tier: 'T5', command: cmd }] },
      { id: 'rustB', outcomes: [{ id: 'ob', tier: 'T5', command: cmd }] },
      { id: 'rustC', outcomes: [{ id: 'oc', tier: 'T5', command: cmd }] },
      // Different target — a genuinely distinct receipt, must NOT be flagged.
      { id: 'rustOther', outcomes: [{ id: 'od', tier: 'T5', command: 'cargo test -p member --lib other_mod' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, R);
    for (const d of ['rustA', 'rustB', 'rustC']) {
      assert.ok(report.sharedReceiptDims.includes(d), `${d} must be flagged — same cargo target is one receipt`);
    }
    assert.ok(!report.sharedReceiptDims.includes('rustOther'), 'a different cargo target stays distinct');
    assert.ok(report.violations.some(v => v.kind === 'SHARED_RECEIPT' && v.detail.includes('cargo-test:')));
  });
});

// ── Language-aware seam scan ──────────────────────────────────────────────────

describe('checkOutcomeIntegrity — language-aware seam scan', () => {
  test('(c) a Python test importing unittest.mock is a SEAM_USAGE violation (capped 6.0)', async () => {
    const dims = [
      { id: 'pySeamed', outcomes: [{ id: 'o', tier: 'T5', command: 'python -m pytest tests/test_seamy.py' }] },
      { id: 'pyClean', outcomes: [{ id: 'o2', tier: 'T5', command: 'python -m pytest tests/test_clean.py' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, R);
    assert.ok(report.seamedDims.includes('pySeamed'), 'unittest.mock/MagicMock is a seam');
    assert.ok(!report.seamedDims.includes('pyClean'), 'a clean pytest file is not flagged');
    assert.ok(report.violations.some(v => v.kind === 'SEAM_USAGE' && v.dimId === 'pySeamed'));
    assert.deepEqual(integrityCapFor(8.0, 'pySeamed', report), { cappedScore: 6.0, integrityCap: 'SEAM_USAGE' });
  });

  test('(e) a Go test importing testify/mock is flagged', async () => {
    const dims = [
      { id: 'goSeamed', outcomes: [{ id: 'o', tier: 'T5', command: 'go test ./pkg/scan/scan_test.go' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, R);
    assert.ok(report.seamedDims.includes('goSeamed'), 'testify/mock import is a seam');
    assert.equal(await commandHasSeams('go test ./pkg/scan/scan_test.go', R), true);
  });

  test('(d) a Rust callsite with inline #[cfg(test)] mod tests is INHERENT coupling — NOT a seam', async () => {
    const dims = [
      { id: 'rustInline', outcomes: [{ id: 'o', tier: 'T5', command: 'cargo test -p member --lib', required_callsite: 'src/scanner.rs' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, R);
    assert.ok(!report.seamedDims.includes('rustInline'), 'inline #[cfg(test)] must never read as a seam');
    assert.ok(!report.orphanDims.includes('rustInline'), 'mod-declared rust callsite is production-wired');
    assert.ok(!report.violations.some(v => v.dimId === 'rustInline'), 'the idiomatic rust layout is fully clean');
    // Structural guarantee: no rust seam pattern matches the #[cfg(test)] layout itself.
    const callsite = await fs.readFile(path.join(R, 'src', 'scanner.rs'), 'utf8');
    assert.ok(SEAM_PATTERNS_BY_LANG.rust.every(p => !p.test(callsite)),
      'no rust seam pattern may match an inline #[cfg(test)] module');
  });

  test('rust file-content scan: mockall import flags, inline #[cfg(test)] alone does not', async () => {
    assert.equal(await commandHasSeams('run tests/scanner_seamed_test.rs', R), true, 'mockall is a seam');
    assert.equal(await commandHasSeams('run tests/scanner_clean_test.rs', R), false, '#[cfg(test)] alone is clean');
  });

  test('a recognized-language test file that cannot be read keeps current behavior (not flagged)', async () => {
    const dims = [
      { id: 'pyMissing', outcomes: [{ id: 'o', tier: 'T5', command: 'python -m pytest tests/test_absent.py' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, R);
    assert.ok(!report.seamedDims.includes('pyMissing'));
    assert.ok(!report.unscannableDims.includes('pyMissing'), 'python HAS a scanner — not UNSCANNABLE');
  });
});

// ── UNSCANNABLE fail-closed ───────────────────────────────────────────────────

describe('checkOutcomeIntegrity — UNSCANNABLE (no seam scanner for the language)', () => {
  test('(f) an .exs test file on a T4+ outcome records a WARN and surfaces the dim', async () => {
    const dims = [
      { id: 'elixirDim', outcomes: [{ id: 'o', tier: 'T5', command: 'mix test test/foo_test.exs' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, R);
    assert.ok(report.unscannableDims.includes('elixirDim'));
    const v = report.violations.find(x => x.kind === 'UNSCANNABLE');
    assert.ok(v, 'UNSCANNABLE violation must be recorded');
    assert.equal(v!.severity, 'WARN');
    assert.ok(v!.detail.includes('test/foo_test.exs'));
    assert.equal(report.clean, false, 'silence must not read as cleanliness');
    // WARN, not a numeric clamp — the bite is INFERRED quality (blocks T7 consensus).
    assert.equal(integrityCapFor(8.0, 'elixirDim', report).integrityCap, undefined);
  });

  test('a T2 .exs outcome is NOT flagged (only T4+ claims production-grade evidence)', async () => {
    const dims = [
      { id: 'elixirLow', outcomes: [{ id: 'o', tier: 'T2', command: 'mix test test/foo_test.exs' }] },
    ];
    const report = await checkOutcomeIntegrity(dims, R);
    assert.ok(!report.unscannableDims.includes('elixirLow'));
  });
});

// ── Runtime evidence tagging (outcome-runner) ─────────────────────────────────

async function runTagged(command: string): Promise<OutcomeEvidenceEntry> {
  return runOneOutcome({
    dimensionId: 'polyglot_probe',
    outcome: {
      id: `o-${Math.random().toString(36).slice(2, 10)}`,
      tier: 'T5',
      description: 'polyglot receipt probe',
      command,
      kind: 'shell',
      timeout_ms: 10_000,
    } as Outcome,
    cwd: R,
    forceCold: true,
    _spawn: () => ({ status: 0, stdout: 'suite ok: 3 passed', stderr: '' }),
    _readGitSha: async () => 'cafebabe',
    _writeFile: async () => {}, // capture-free: the returned entry is the written entry
    _exists: async () => false,
    _createTimeMachineCommit: null,
  });
}

describe('tagEvidenceQuality (via runOneOutcome) — polyglot quality tagging', () => {
  test('(c) a pytest run whose test imports unittest.mock is INFERRED', async () => {
    const entry = await runTagged('python -m pytest tests/test_seamy.py');
    assert.equal(entry.evidenceQuality, 'INFERRED');
    assert.equal(entry.confidenceScore, 0.65);
  });

  test('a clean pytest run stays EXTRACTED', async () => {
    const entry = await runTagged('python -m pytest tests/test_clean.py');
    assert.equal(entry.evidenceQuality, 'EXTRACTED');
    assert.equal(entry.confidenceScore, 1.0);
  });

  test('(e) a go test importing testify/mock is INFERRED', async () => {
    const entry = await runTagged('go test ./pkg/scan/scan_test.go');
    assert.equal(entry.evidenceQuality, 'INFERRED');
  });

  test('(f) an unscannable-language test file (.exs) is INFERRED, never EXTRACTED', async () => {
    const entry = await runTagged('mix test test/foo_test.exs');
    assert.equal(entry.evidenceQuality, 'INFERRED');
    assert.equal(entry.confidenceScore, 0.7);
  });

  test('a recognized-language test file that cannot be read keeps current behavior (EXTRACTED)', async () => {
    const entry = await runTagged('npx tsx --test tests/absent.test.ts');
    assert.equal(entry.evidenceQuality, 'EXTRACTED');
  });
});
