// Phase-1 #12: every dimension must carry a competitor-grounded Score Ladder, and a >8.0 frontier
// target on a ladderless dim must fail LOUD (not be graded the same as a laddered dim by omission).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadDimRubric, parseScoreLadder } from '../src/core/rubric-ladder.js';
import { checkFrontierSpec, FRONTIER_GATE_THRESHOLD, type FrontierSpec } from '../src/core/frontier-spec.js';
import type { DimensionRubricLevel } from '../src/matrix/types/dimension-graph.js';

const REPO = process.cwd();

describe('Score-Ladder coverage — every shipped dimension has a competitor-grounded rubric (#12)', () => {
  it('ux_polish has a committed ladder, and every PRESENT universe ladder parses non-empty', async () => {
    const matrixPath = path.join(REPO, '.danteforge', 'compete', 'matrix.json');
    if (!fs.existsSync(matrixPath)) return; // no matrix in this checkout — nothing to assert
    const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8')) as { dimensions: Array<{ id: string }> };
    const noFile: string[] = [];
    for (const d of matrix.dimensions) {
      const uni = path.join(REPO, '.danteforge', 'compete', 'universe', `${d.id}.md`);
      if (!fs.existsSync(uni)) { noFile.push(d.id); continue; }
      // A committed/present universe file MUST carry a parseable, non-empty Score Ladder (no broken ladders).
      const rubric = await loadDimRubric(REPO, d.id);
      assert.ok(rubric.length > 0, `${d.id} has a universe file but an empty/unparseable Score Ladder`);
    }
    // ux_polish was THE ladderless dim (#12) — it must now have a committed (CI-safe) ladder.
    assert.ok(!noFile.includes('ux_polish'), 'ux_polish must now have a committed Score Ladder');
    // Other dims whose universe research isn't committed yet are surfaced, not hard-failed (some ladders
    // are local-only until the operator commits them; the loop reads them at runtime).
    if (noFile.length > 0) console.log(`[ladder-coverage] ${noFile.length} dim(s) have no committed universe ladder yet: ${noFile.join(', ')}`);
  });

  it('ux_polish (the formerly-ladderless dim) now has integer rungs 5–10', async () => {
    const rubric = await loadDimRubric(REPO, 'ux_polish');
    const scores = rubric.map(l => l.score);
    assert.ok(rubric.length >= 5, 'ux_polish has a real ladder');
    assert.ok(scores.includes(7) && scores.includes(8) && scores.includes(9) && scores.includes(10), 'covers the 7→10 rungs');
    assert.equal(new Set(scores).size, scores.length, 'no duplicate rungs (integer scores only)');
  });
});

describe('checkFrontierSpec — missing-ladder gate (#12): no >8.0 target without a ladder', () => {
  const spec = (target: number): FrontierSpec => ({
    version: 1, target_score: target, status: 'draft',
    leader_target: { competitor: 'Cursor', score: 9, observed_capability: 'real capability' },
    real_user_path: { required_callsite: 'src/x.ts', run_command: 'node dist/index.js x', observable_artifacts: [{ kind: 'json', path: 'o.json' }] },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
  } as FrontierSpec);
  const LADDER: DimensionRubricLevel[] = [{ score: 8, descriptor: 'x' }, { score: 9, descriptor: 'real capability frontier' }];

  it('a >8.0 target with an EMPTY rubric is rejected with an actionable ladder error', () => {
    const r = checkFrontierSpec(spec(9.0), ['Cursor'], []);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => /no Score Ladder/i.test(e)), `expected a missing-ladder error, got: ${r.errors.join(' | ')}`);
  });

  it('a >8.0 target WITH a ladder does not trip the missing-ladder gate', () => {
    const r = checkFrontierSpec(spec(9.0), ['Cursor'], LADDER);
    assert.ok(!r.errors.some(e => /no Score Ladder/i.test(e)), 'a laddered dim must not hit the missing-ladder gate');
  });

  it('an at-threshold target (≤8.0) needs no ladder — the gate only guards >8.0', () => {
    const r = checkFrontierSpec(spec(FRONTIER_GATE_THRESHOLD), ['Cursor'], []);
    assert.ok(!r.errors.some(e => /no Score Ladder/i.test(e)), '≤8.0 targets are not laddered-gated');
  });
});

// sanity: the parser keeps integer rungs distinct (guards the 9.5→9 duplicate bug fixed in ux_polish.md)
describe('parseScoreLadder', () => {
  it('parses a simple table into sorted integer rungs', () => {
    const md = '## Score Ladder\n| Score | Evidence |\n|--|--|\n| 7 | seven |\n| 8 | eight |\n';
    const rows = parseScoreLadder(md);
    assert.deepEqual(rows.map(r => r.score), [7, 8]);
  });
});
