// cold-start.test.ts — The integration-truth gate DanteForge was missing.
//
// Root cause of the recurring "every real use hits a wall" pattern (council 2026-05-29):
// the tool was validated through seams/fakes/self-score invariants, never from a cold
// start on a real project — so every first-run / boundary-crossing path failed on first
// contact. This file asserts the DECISION-PATH TRUTHS that the 11 field bugs violated,
// using real exported APIs (no LLM, <1s), and is wired into the smoke gate so they can
// never silently regress again.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  effectiveDimScore,
  decisionDimScore,
  UNVERIFIED_DECISION_CAP,
  getNextSprintDimension,
  type CompeteMatrix,
  type MatrixDimension,
} from '../src/core/compete-matrix.js';
import { resolveEffectiveProvider } from '../src/core/llm.js';
import { compete } from '../src/cli/commands/compete.js';

function dim(id: string, self: number, derived?: number, extra: Partial<MatrixDimension> = {}): MatrixDimension {
  return {
    id, label: id, weight: 1, category: 'quality', frequency: 'medium',
    scores: derived === undefined ? { self } : { self, derived },
    gap_to_leader: 0, leader: '', gap_to_closed_source_leader: 0, closed_source_leader: '',
    gap_to_oss_leader: 0, oss_leader: '', status: 'in-progress', sprint_history: [],
    next_sprint_target: 9, ...extra,
  } as MatrixDimension;
}

function matrix(dims: MatrixDimension[], opts: Partial<CompeteMatrix> = {}): CompeteMatrix {
  return {
    project: 'fixture', competitors: ['Cursor'], competitors_closed_source: ['Cursor'],
    competitors_oss: [], lastUpdated: '2026-01-01T00:00:00Z', overallSelfScore: 6,
    dimensions: dims, ...opts,
  } as CompeteMatrix;
}

// ── Truth 1: the honest score is min(self, derived), not raw self (anti-inflation) ──
describe('cold-start: effective score caps inflated self-claims', () => {
  it('a dim claiming self=8 with derived=4 is honestly 4', () => {
    assert.equal(effectiveDimScore(dim('x', 8, 4)), 4);
  });
  it('with no derived evidence, effective falls back to self', () => {
    assert.equal(effectiveDimScore(dim('x', 7)), 7);
  });
});

// ── Truth 2: a dim with inflated self but low evidence is STILL eligible for work ──
// (the crusade/ascend/sprint "target already met, nothing to do" bug)
describe('cold-start: sprint selection uses effective score, not inflated self', () => {
  it('picks a dim whose self=8 but derived=4 when target=7', () => {
    const m = matrix([dim('inflated', 8, 4)]);
    const next = getNextSprintDimension(m, 7);
    assert.equal(next?.id, 'inflated', 'inflated-but-unproven dim must remain eligible, not skipped');
  });
  it('does NOT pick a genuinely-proven dim (self=8, derived=8) below target 7', () => {
    const m = matrix([dim('proven', 8, 8)]);
    assert.equal(getNextSprintDimension(m, 7), null, 'a dim with real evidence >= target is done');
  });
});

// ── Truth 2b: the DEEP first-run hole — a dim that DECLARES outcomes but has NO derived
// evidence (loadMatrix leaves derived unset when evidence is stale/absent) must NOT be
// trusted at its raw self for WORK decisions, or crusade skips inflated-but-unproven dims.
describe('cold-start: unproven dims are capped for decisions (decisionDimScore)', () => {
  it('a dim declaring outcomes with no derived evidence is capped, not trusted at self=9', () => {
    const d = { ...dim('unproven', 9), outcomes: [{ id: 'o1' }] } as unknown as MatrixDimension;
    assert.equal(decisionDimScore(d), UNVERIFIED_DECISION_CAP, 'unproven-but-declared dim is capped for decisions');
    const m = matrix([d]);
    assert.equal(getNextSprintDimension(m, 7)?.id, 'unproven', 'so it STAYS eligible for work, not skipped');
  });
  it('a dim with NO outcome mechanism falls back to self (legacy/market, other caps apply)', () => {
    assert.equal(decisionDimScore(dim('legacy', 6)), 6);
  });
  it('a dim with fresh derived evidence uses the honest min(self, derived)', () => {
    const d = { ...dim('proven', 9, 4), outcomes: [{ id: 'o1' }] } as unknown as MatrixDimension;
    assert.equal(decisionDimScore(d), 4, 'fresh evidence wins — no extra cap applied');
  });
  it('display score (effectiveDimScore) is unchanged — stays lenient, no decision cap', () => {
    const d = { ...dim('unproven', 9), outcomes: [{ id: 'o1' }] } as unknown as MatrixDimension;
    assert.equal(effectiveDimScore(d), 9, 'display headline stays stable; only WORK decisions cap');
  });
});

// ── Truth 3: the fleet router keeps high-frequency traffic off the shared CLI bucket ──
describe('cold-start: fleet LLM router', () => {
  it('claude-code + loop traffic downgrades to a fleet-safe local backend', () => {
    assert.equal(resolveEffectiveProvider('claude-code'), 'ollama');
  });
  it('claude-code + setup-oneshot uses the CLI (rare heavy call)', () => {
    assert.equal(resolveEffectiveProvider('claude-code', 'setup-oneshot'), 'claude-code');
  });
  it('non-CLI providers pass through unchanged', () => {
    assert.equal(resolveEffectiveProvider('ollama'), 'ollama');
    assert.equal(resolveEffectiveProvider('claude'), 'claude');
  });
});

// ── Truth 4: `compete --init` never clobbers an existing real matrix ──
describe('cold-start: compete --init clobber guard', () => {
  it('refuses to overwrite an existing substantial matrix (no --force) and never saves', async () => {
    let saved = false;
    const existing = matrix([dim('a', 8), dim('b', 7)], { competitors: ['Cursor', 'Aider'] });
    const result = await compete({
      init: true,
      _loadMatrix: async () => existing,
      _saveMatrix: async () => { saved = true; },
      _scanCompetitors: async () => { throw new Error('scan must not run when the guard refuses'); },
      cwd: '/fixture/no-write',
    });
    assert.equal(saved, false, 'guard must NOT overwrite the existing matrix');
    assert.equal(result.action, 'init');
    assert.equal(result.overallScore, existing.overallSelfScore, 'existing matrix preserved');
  });
});

// ── Truth 5: decision paths must not read raw scores.self for target comparisons ──
// (the split-brain class that recurred in ascend-engine, gap-report, AND crusade)
describe('cold-start: no decision path compares raw scores.self to target', () => {
  const decisionFiles = [
    'src/cli/commands/crusade.ts',
    'src/cli/commands/harden-crusade.ts',
    'src/cli/commands/council-crusade.ts',
    'src/cli/commands/compete-reports.ts',
    'src/core/ascend-engine.ts',
    'src/core/compete-matrix-score.ts',
    'src/core/gap-report.ts',
    'src/core/goal-loop-engine.ts',
  ];
  // The exact antipattern the 11-bug session kept finding: comparing the inflatable
  // self-score directly against a target/ceiling instead of effectiveDimScore.
  const antipattern = /scores\[['"]self['"]\]\s*\?\?\s*0\)\s*(?:<|>=|>|<=)\s*(?:target|d\.ceiling|ceiling)/;
  for (const rel of decisionFiles) {
    it(`${rel} routes target/ceiling decisions through effectiveDimScore`, () => {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      assert.ok(!antipattern.test(src),
        `${rel} compares raw scores.self to a target/ceiling — use effectiveDimScore (split-brain risk)`);
    });
  }
});
