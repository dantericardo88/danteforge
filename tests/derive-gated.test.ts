import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMatrix } from '../src/core/compete-matrix.js';
import { deriveDimScoreGated } from '../src/core/derive-gated.js';
import { loadOutcomeEvidence } from '../src/matrix/engines/outcome-runner.js';
import { checkOutcomeIntegrity } from '../src/matrix/engines/outcome-integrity.js';

// The council's pin (2026-06-22): there must be ONE canonical "score this dim now" function, and every
// surface (loadMatrix headline, gap, validate) must return an identical number for the same dim+evidence.
// This asserts deriveDimScoreGated reproduces loadMatrix's headline derived for every dim in the live matrix —
// the drift guard that catches the "14 dims at 8.0 in gap vs 9 at 7.0 in the headline" regression class.
test('deriveDimScoreGated reproduces loadMatrix headline derived for every dim (no gap-vs-headline drift)', async () => {
  const cwd = process.cwd();
  const m = await loadMatrix(cwd);
  if (!m) return; // no matrix in this environment — nothing to pin
  const evidence = await loadOutcomeEvidence(cwd);
  let integrity = null;
  try {
    integrity = await checkOutcomeIntegrity(m.dimensions as unknown as Parameters<typeof checkOutcomeIntegrity>[0], cwd);
  } catch { integrity = null; }
  const now = new Date();

  let checked = 0;
  for (const dim of m.dimensions) {
    const outcomes = (dim as unknown as Record<string, unknown>)['outcomes'];
    if (!Array.isArray(outcomes) || outcomes.length === 0) continue; // only dims with outcomes get a derived
    const headline = (dim as unknown as { scores?: Record<string, number> }).scores?.derived;
    const { score } = await deriveDimScoreGated(
      dim as unknown as Parameters<typeof deriveDimScoreGated>[0], evidence, now, integrity,
    );
    checked++;
    if (headline === undefined) {
      // loadMatrix dropped derived (unverified) → the canonical fn must also report null (no derivable evidence)
      assert.equal(score, null, `${dim.id}: headline is unverified but canonical fn returned ${score}`);
    } else {
      assert.notEqual(score, null, `${dim.id}: headline ${headline} but canonical fn returned null`);
      assert.ok(
        Math.abs((score as number) - headline) < 0.01,
        `${dim.id}: canonical fn ${score} != headline ${headline} — gap/loadMatrix have DRIFTED`,
      );
    }
  }
  assert.ok(checked > 0, 'expected at least one outcome-bearing dim to pin');
});
