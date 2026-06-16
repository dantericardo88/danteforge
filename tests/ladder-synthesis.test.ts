import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeLadderFromSignals, rungToMarkdownRow, renderGroundedLadderSection } from '../src/core/ladder-synthesis.ts';
import { checkLadderGroundedness } from '../src/core/ladder-groundedness.ts';
import type { HarvestedSignal } from '../src/core/harvested-bar.ts';

const cap = (claim: string, source: string): HarvestedSignal => ({ kind: 'capability', source, fetched_at: '2026-06-16T00:00:00Z', claim });
const bench = (numeric: number): HarvestedSignal => ({ kind: 'benchmark', source: 'https://swebench.com/leaderboard', fetched_at: '2026-06-16T00:00:00Z', claim: 'top agent', suite: 'swe-bench-lite', numeric, verified_live: true });
const demand = (claim: string, source: string): HarvestedSignal => ({ kind: 'demand', source, fetched_at: '2026-06-16T00:00:00Z', claim });

test('capability signals become differentiator (score 8) rungs, cited', () => {
  const rungs = synthesizeLadderFromSignals([cap('repo-aware multi-file edits', 'https://aider.chat/docs')]);
  assert.equal(rungs.length, 1);
  assert.equal(rungs[0]!.score, 8);
  assert.match(rungs[0]!.descriptor, /Leader-parity.*repo-aware.*EXTRACTED: https:\/\/aider\.chat\/docs/);
});

test('a benchmark signal becomes a frontier (score 9) rung with the normalized number', () => {
  const rungs = synthesizeLadderFromSignals([bench(0.46)]);
  assert.equal(rungs[0]!.score, 9);
  assert.match(rungs[0]!.descriptor, /swe-bench-lite \(4\.6\/10\).*EXTRACTED: https:\/\/swebench\.com/);
});

test('a demand signal becomes a frontier (score 9) unmet-demand rung, cited', () => {
  const rungs = synthesizeLadderFromSignals([demand('iterate until tests pass unattended', 'https://gh/issue/1')]);
  assert.equal(rungs[0]!.score, 9);
  assert.match(rungs[0]!.descriptor, /unmet demand.*EXTRACTED: https:\/\/gh\/issue\/1/);
});

test('no signals → no synthesized rungs (honest: no invented bar)', () => {
  assert.deepEqual(synthesizeLadderFromSignals([]), []);
});

test('END-TO-END: synthesized rungs PASS checkLadderGroundedness by construction', () => {
  const rungs = synthesizeLadderFromSignals([
    cap('multi-file repo-aware edits', 'https://aider.chat/docs'),
    bench(0.46),
    demand('auto-repair on failing tests', 'https://gh/issue/1'),
  ]);
  assert.ok(rungs.length >= 3);
  const ground = checkLadderGroundedness(rungs.map(r => ({ score: r.score, descriptor: r.descriptor })), { threshold: 7 });
  assert.ok(ground.ok, `synthesis must produce grounded rungs; issues: ${ground.issues.join('; ')}`);
});

test('rungToMarkdownRow renders a universe Score Ladder table row', () => {
  assert.equal(rungToMarkdownRow({ score: 8, descriptor: 'X [EXTRACTED: https://u]', source: 'https://u' }), '| 8 | X [EXTRACTED: https://u] |');
});

test('renderGroundedLadderSection emits a Score Ladder section (empty string when no rungs)', () => {
  assert.equal(renderGroundedLadderSection([]), '');
  const md = renderGroundedLadderSection(synthesizeLadderFromSignals([cap('repo-aware edits', 'https://u'), bench(0.46)]));
  assert.match(md, /## Score Ladder/);
  assert.match(md, /\| 8 \|.*repo-aware/);
  assert.match(md, /\| 9 \|.*swe-bench-lite/);
});
