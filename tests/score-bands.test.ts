import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreBand, scoreBandHeadline, BUILD_CEILING } from '../src/core/score-bands.js';

test('8.0 is a terminal BUILD-COMPLETE success on the build axis — not a failure', () => {
  const b = scoreBand(8.0);
  assert.equal(b.axis, 'build');
  assert.equal(b.label, 'BUILD-COMPLETE');
  assert.equal(b.isBuildTerminal, true);
  assert.equal(BUILD_CEILING, 8.0);
  // the headline must communicate success, not shortfall
  assert.match(scoreBandHeadline(8.0), /BUILD-COMPLETE/);
  assert.match(scoreBandHeadline(8.0), /SUCCEEDED/);
});

test('8.5–9.0 is the ENGINEERING frontier (demand); 9.5+ is the COMPETITIVE frontier — never the build axis', () => {
  // ENGINEERING frontier = the best version, validated by real external DEMAND (autonomously reachable)
  for (const s of [8.5, 9.0]) {
    assert.equal(scoreBand(s).axis, 'engineering', `score ${s} must be on the engineering frontier`);
    assert.equal(scoreBand(s).isBuildTerminal, false);
  }
  // COMPETITIVE frontier = beating named competitors (funded, not autonomous)
  assert.equal(scoreBand(9.5).axis, 'competitive');
  assert.equal(scoreBand(10).axis, 'competitive');
  // the engineering band is anchored on DEMAND, not on a competitor benchmark
  assert.match(scoreBand(8.5).meaning, /demand/i);
  assert.match(scoreBand(9.0).meaning, /satisfies.*demand/i);
  assert.match(scoreBand(9.5).meaning, /competit/i);
});

test('thresholds mirror TIER_SCORE_CAPS exactly (relabel, never renumber)', () => {
  assert.equal(scoreBand(7.0).label, 'WIRED');
  assert.equal(scoreBand(7.9).axis, 'build');       // still build axis below the ceiling
  assert.equal(scoreBand(7.9).isBuildTerminal, false);
  assert.equal(scoreBand(5.0).label, 'MODULE');
  assert.equal(scoreBand(2.0).label, 'SKETCH');
  assert.equal(scoreBand(0).label, 'UNSCORED');
});

test('every band carries an honest next-step anchor (except the unscored floor and the very top)', () => {
  for (const s of [3, 6, 7.2, 8.0, 8.6, 9.1]) {
    assert.ok(scoreBand(s).nextAnchor, `score ${s} should name what unlocks the next band`);
  }
  // the build ceiling's next step is the autonomously-reachable ENGINEERING frontier (harvested demand)
  assert.match(scoreBand(8.0).nextAnchor!, /demand|ENGINEERING/i);
});
