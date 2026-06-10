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
});
