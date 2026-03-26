// Complexity feedback loop integration tests — end-to-end chain:
// loadComplexityWeights → adjustWeightsFromOutcome → persistComplexityWeights → loadComplexityWeights
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let tmpDir: string;
before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-complexity-loop-'));
});
after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Preset order: spark(0) ember(1) magic(2) blaze(3) inferno(4)
// adjustWeightsFromOutcome returns null when drift < 2 ("close enough")
// Use pairs with drift >= 2 to trigger actual adjustments

describe('complexity feedback loop — end-to-end', () => {
  it('adjustWeightsFromOutcome returns non-null when presets differ by ≥2 steps', async () => {
    const { loadComplexityWeights, adjustWeightsFromOutcome } = await import('../src/core/complexity-classifier.js');
    const initial = await loadComplexityWeights(tmpDir);
    // spark(0) vs blaze(3): drift=3 → adjustment produced
    const adjusted = adjustWeightsFromOutcome(initial, 'spark', 'blaze');
    assert.ok(adjusted !== null, 'should produce adjusted weights when presets differ by ≥2');
  });

  it('adjustWeightsFromOutcome returns null when presets are within 1 step (close enough)', async () => {
    const { loadComplexityWeights, adjustWeightsFromOutcome } = await import('../src/core/complexity-classifier.js');
    const initial = await loadComplexityWeights(tmpDir);
    // magic(2) vs blaze(3): drift=1 → no adjustment
    const result = adjustWeightsFromOutcome(initial, 'magic', 'blaze');
    assert.strictEqual(result, null, 'drift=1 is close enough — no calibration needed');
  });

  it('persistComplexityWeights writes YAML file that loadComplexityWeights can read back', async () => {
    const loopDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-clx-persist-'));
    try {
      const { loadComplexityWeights, adjustWeightsFromOutcome, persistComplexityWeights } = await import('../src/core/complexity-classifier.js');
      const initial = await loadComplexityWeights(loopDir);
      // spark(0) vs blaze(3): drift=3
      const adjusted = adjustWeightsFromOutcome(initial, 'spark', 'blaze');
      assert.ok(adjusted !== null, 'should produce adjustments');
      await persistComplexityWeights(adjusted!, loopDir);

      // Verify the YAML file was written to disk
      const yamlPath = path.join(loopDir, '.danteforge', 'complexity-weights.yaml');
      const stat = await fs.stat(yamlPath);
      assert.ok(stat.isFile(), 'complexity-weights.yaml should be written to .danteforge/');

      // Verify the data is readable and has valid structure
      const persisted = await loadComplexityWeights(loopDir);
      assert.ok(typeof persisted.fileCount === 'number' && persisted.fileCount > 0, 'fileCount should be a positive number');
      assert.ok(typeof persisted.linesOfCode === 'number' && persisted.linesOfCode > 0, 'linesOfCode should be a positive number');
      // Verify calibration actually changed at least one weight (no-op rounding fix)
      assert.notDeepStrictEqual(persisted, initial, 'persisted weights should differ from initial after calibration');
    } finally {
      await fs.rm(loopDir, { recursive: true, force: true });
    }
  });

  it('full loop: persist → reload → adjust again produces further deltas', async () => {
    const loopDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-clx-full-'));
    try {
      const { loadComplexityWeights, adjustWeightsFromOutcome, persistComplexityWeights } = await import('../src/core/complexity-classifier.js');
      // Round 1 — spark(0) vs inferno(4): drift=4, guaranteed adjustment
      const w1 = await loadComplexityWeights(loopDir);
      const a1 = adjustWeightsFromOutcome(w1, 'spark', 'inferno');
      assert.ok(a1 !== null, 'round 1 should produce adjustment');
      await persistComplexityWeights(a1!, loopDir);

      // Round 2 — same signal; feedback loop should not be exhausted
      const w2 = await loadComplexityWeights(loopDir);
      const a2 = adjustWeightsFromOutcome(w2, 'spark', 'inferno');
      assert.ok(a2 !== null, 'round 2 should still produce adjustment — loop is not stuck');
    } finally {
      await fs.rm(loopDir, { recursive: true, force: true });
    }
  });
});
