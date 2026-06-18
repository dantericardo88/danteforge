// evidence-rescore-drift.test.ts — lockstep guard for the rescore port.
//
// scripts/evidence-rescore.mjs is a plain-JS MIRROR of the canonical TypeScript
// scoring path (Codex flagged it as a port that can DRIFT; project memory records
// the contract "evidence-rescore.mjs + derived-score.ts must stay lockstep").
// crusade.ts runs it every frontier cycle to write matrix.json scores, so if its
// tier caps / market caps / T7 threshold drift from the canonical TS, the crusade
// loop silently writes scores that disagree with validate + loadMatrix.
//
// This test fails CI the moment any of those constants diverge, so the mirror can
// never quietly go stale. It does NOT re-implement scoring — it pins the shared
// numeric contract.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIER_SCORE_CAPS } from '../src/matrix/types/capability-test.js';
import { extractTestFiles } from '../src/matrix/engines/test-file-patterns.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

function parseTierCaps(src: string): Record<string, number> {
  const m = src.match(/TIER_SCORE_CAPS\s*[:=]\s*(?:Record<[^>]+>\s*=\s*)?\{([^}]+)\}/);
  assert.ok(m, 'could not locate TIER_SCORE_CAPS literal');
  const caps: Record<string, number> = {};
  for (const pair of m![1]!.split(',')) {
    const kv = pair.match(/(T\d)\s*:\s*([\d.]+)/);
    if (kv) caps[kv[1]!] = Number(kv[2]);
  }
  return caps;
}

function parseNumber(src: string, name: string): number {
  const m = src.match(new RegExp(`${name}\\s*=\\s*([\\d.]+)`));
  assert.ok(m, `could not locate ${name}`);
  return Number(m![1]);
}

function parseMarketDims(src: string, name = 'MARKET_DIMS'): string[] {
  const m = src.match(new RegExp(`${name}[^=]*=\\s*new Set\\(\\[([^\\]]+)\\]\\)`));
  assert.ok(m, `could not locate ${name}`);
  return [...m![1]!.matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]!).sort();
}

/** Parse a `new Set([...])` or `new Set<Generic>([...])` literal (handles the canonical TS generic + comments). */
function parseSet(src: string, name: string): string[] {
  const m = src.match(new RegExp(`${name}[^=]*=\\s*new Set(?:<[^>]+>)?\\(\\[([^\\]]+)\\]\\)`));
  assert.ok(m, `could not locate ${name}`);
  return [...m![1]!.matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]!).sort();
}

describe('evidence-rescore.mjs stays in lockstep with the canonical TS scoring', () => {
  const mjs = read('scripts/evidence-rescore.mjs');
  const derivedScore = read('src/core/derived-score.ts');
  // The market-cap contract moved to one canonical module (market-dims.ts); derived-score.ts
  // now imports it, so the mirror is pinned to the canonical source instead.
  const marketDims = read('src/core/market-dims.ts');

  it('TIER_SCORE_CAPS match the canonical capability-test.ts caps', () => {
    const fromMjs = parseTierCaps(mjs);
    assert.deepEqual(fromMjs, TIER_SCORE_CAPS as unknown as Record<string, number>,
      'evidence-rescore.mjs TIER_SCORE_CAPS drifted from canonical TIER_SCORE_CAPS (capability-test.ts)');
  });

  it('MARKET dims + cap match the canonical market-dims.ts contract', () => {
    assert.deepEqual(parseMarketDims(mjs), parseMarketDims(marketDims, 'MARKET_CAPPED_DIMS'),
      'evidence-rescore.mjs MARKET_DIMS drifted from market-dims.ts MARKET_CAPPED_DIMS');
    assert.equal(parseNumber(mjs, 'MARKET_DIM_CAP'), parseNumber(marketDims, 'MARKET_DIM_MAX_SCORE'),
      'evidence-rescore.mjs MARKET_DIM_CAP drifted from market-dims.ts MARKET_DIM_MAX_SCORE');
    // The cap-leak regression: token_economy is part of the documented three-dim contract.
    assert.ok(parseMarketDims(marketDims, 'MARKET_CAPPED_DIMS').includes('token_economy'),
      'token_economy must be market-capped (CLAUDE.md: three meta-dimensions permanently capped at 5.0)');
  });

  it('MIN_T7_HIGH_TIER_OUTCOMES threshold matches derived-score.ts', () => {
    assert.equal(parseNumber(mjs, 'MIN_T7_HIGH_TIER_OUTCOMES'), parseNumber(derivedScore, 'MIN_T7_HIGH_TIER_OUTCOMES'),
      'evidence-rescore.mjs MIN_T7_HIGH_TIER_OUTCOMES drifted from derived-score.ts');
  });

  // Codex P1: this mirror drifted — it omitted swe-bench-live, so a passing contamination-resistant receipt
  // would NOT lift the derived score (isRegisteredExternalSuite returned false). Pin it so it can't recur.
  it('REGISTERED_EXTERNAL_SUITES match the canonical external-suite-registry.ts', () => {
    const registry = read('src/matrix/engines/external-suite-registry.ts');
    assert.deepEqual(parseSet(mjs, 'REGISTERED_EXTERNAL_SUITES'), parseSet(registry, 'REGISTERED_EXTERNAL_SUITES'),
      'evidence-rescore.mjs REGISTERED_EXTERNAL_SUITES drifted from external-suite-registry.ts — a passing receipt for the missing suite would not lift derived score');
    assert.ok(parseSet(mjs, 'REGISTERED_EXTERNAL_SUITES').includes('swe-bench-live'),
      'swe-bench-live (contamination-resistant) must be registered so its receipt grounds code_generation');
  });

  it('derived-score.ts delegates extraction to the canonical test-file-patterns.ts', () => {
    assert.ok(/export \{ extractTestFiles as extractPrimaryTestFiles \}/.test(derivedScore),
      'derived-score.ts must re-export the canonical extractTestFiles (one recognizer, no fork)');
  });
});

// ── Polyglot test-receipt extraction lockstep ─────────────────────────────────
// The mjs mirror carries a SELF-CONTAINED copy of extractTestFiles between markers.
// We eval exactly that block (no import — the script has top-level side effects) and
// pin its BEHAVIOR to the canonical TS over a polyglot command table. The moment the
// mirror and the canonical recognizer disagree on any receipt identity, this fails.

describe('evidence-rescore.mjs test-file extraction stays in lockstep (polyglot)', () => {
  const mjs = read('scripts/evidence-rescore.mjs');

  it('the marked mirror block behaves identically to the canonical extractTestFiles', () => {
    const block = mjs.match(/\/\/ >>> test-file-extraction[\s\S]*?\/\/ <<< test-file-extraction/);
    assert.ok(block, 'lockstep markers (>>> test-file-extraction / <<<) missing from evidence-rescore.mjs');
    const mirror = new Function(`${block![0]}\nreturn extractPrimaryTestFiles;`)() as (c: string) => string[];

    const samples = [
      // JS — historical behavior, must stay byte-identical
      'npx tsx --test tests/a/x.test.ts tests/b/x.test.ts',
      'node dist/index.js run tests/shared.test.ts',
      'node dist/index.js validate --all',
      // Python
      'python -m pytest tests/test_pipeline.py -q',
      'pytest src/pkg/scanner_test.py::TestScanner -k integration',
      'pytest tests/integration/api.py',
      'python scripts/sample.py', // NOT a test file — must extract nothing
      // Rust
      'cargo test -p danteguard --lib scanner',
      'cargo test -p danteguard --lib scanner -- --nocapture',
      'cargo test --package danteguard --test integration_scan',
      'cd crates/core && cargo nextest run -p danteguard --lib scanner',
      'cargo test',
      // Go
      'go test ./pkg/scan -run TestScan',
      'go test -count=1 ./...',
      'go test ./internal/scan/scan_test.go',
      'cd services/api && go test ./handlers',
      // Unknown language — extraction sees nothing (UNSCANNABLE handles it elsewhere)
      'mix test test/foo_test.exs',
    ];
    for (const cmd of samples) {
      assert.deepEqual(mirror(cmd), extractTestFiles(cmd),
        `evidence-rescore.mjs extraction drifted from test-file-patterns.ts for: ${cmd}`);
    }
  });

  it('two dims sharing one cargo target produce ONE receipt identity (the polyglot T7 veto input)', () => {
    const a = extractTestFiles('cargo test -p member --lib scanner');
    const b = extractTestFiles('cargo test -p member --lib scanner');
    const c = extractTestFiles('cargo test -p member --lib other_mod');
    assert.equal(a.length, 1);
    assert.deepEqual(a, b, 'identical cargo targets must collide');
    assert.notDeepEqual(a, c, 'different cargo targets must stay distinct');
  });
});
