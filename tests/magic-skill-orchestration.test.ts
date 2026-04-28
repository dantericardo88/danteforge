import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAGIC_LEVEL_MAP,
  getLevelConfig,
  assertHardwareCeiling,
  HardwareCeilingError,
  ascendSelectLevel,
  type MagicLevel,
  type DanteSkill
} from '../src/spine/magic_skill_orchestration/index.js';

const ALL_LEVELS: MagicLevel[] = ['spark', 'ember', 'canvas', 'magic', 'blaze', 'nova', 'inferno', 'ascend'];

test('MAGIC_LEVEL_MAP contains all 8 levels per PRD-MASTER §8.1', () => {
  for (const level of ALL_LEVELS) {
    assert.ok(MAGIC_LEVEL_MAP[level], `missing config for ${level}`);
  }
});

test('hardware ceiling: max parallelism never exceeds 3 for any level', () => {
  for (const level of ALL_LEVELS) {
    const cfg = MAGIC_LEVEL_MAP[level];
    assert.ok(cfg.maxParallelism <= 3, `${level} ceiling ${cfg.maxParallelism} > 3`);
  }
});

test('hardware ceiling: spark/ember are single-instance', () => {
  assert.equal(MAGIC_LEVEL_MAP.spark.maxParallelism, 1);
  assert.equal(MAGIC_LEVEL_MAP.ember.maxParallelism, 1);
});

test('hardware ceiling: assertHardwareCeiling throws when requested exceeds', () => {
  assert.throws(
    () => assertHardwareCeiling('blaze', 5),
    HardwareCeilingError
  );
});

test('hardware ceiling: assertHardwareCeiling allows ≤ ceiling', () => {
  assert.doesNotThrow(() => assertHardwareCeiling('inferno', 3));
  assert.doesNotThrow(() => assertHardwareCeiling('inferno', 1));
});

test('inferno requires budget envelope and enables OSS mining', () => {
  const cfg = getLevelConfig('inferno');
  assert.equal(cfg.budgetEnvelopeRequired, true);
  assert.equal(cfg.ossMiningEnabled, true);
});

test('canvas uses human_checkpoint between every step', () => {
  const cfg = getLevelConfig('canvas');
  for (const step of cfg.defaultWorkflow) {
    assert.equal(step.gate, 'human_checkpoint', `canvas step ${step.skill} should be human_checkpoint`);
  }
});

test('inferno uses fail_closed gates per PRD-MASTER §8.1', () => {
  const cfg = getLevelConfig('inferno');
  for (const step of cfg.defaultWorkflow) {
    assert.equal(step.gate, 'fail_closed', `inferno step ${step.skill} should fail_closed`);
  }
});

test('nova has convergence loops on every step', () => {
  const cfg = getLevelConfig('nova');
  for (const step of cfg.defaultWorkflow) {
    assert.ok(step.convergeOnDimension, `nova step ${step.skill} missing convergence loop`);
    assert.ok(step.convergeOnDimension!.threshold >= 9.0);
  }
});

test('every orchestrating level invokes only the 5 Dante-native skills', () => {
  const allowed: DanteSkill[] = [
    'dante-to-prd',
    'dante-grill-me',
    'dante-tdd',
    'dante-triage-issue',
    'dante-design-an-interface'
  ];
  for (const level of ALL_LEVELS) {
    const cfg = MAGIC_LEVEL_MAP[level];
    if (!cfg.orchestrates) continue;
    for (const step of cfg.defaultWorkflow) {
      assert.ok(allowed.includes(step.skill), `${level} invokes unknown skill ${step.skill}`);
    }
  }
});

test('ascend selects spark for trivial', () => {
  const dec = ascendSelectLevel({ complexity: 'trivial', hasBudget: true, ossMiningWanted: false, parallelExplorationWanted: false });
  assert.equal(dec.recommendedLevel, 'spark');
});

test('ascend selects inferno for huge + OSS mining', () => {
  const dec = ascendSelectLevel({ complexity: 'huge', hasBudget: true, ossMiningWanted: true, parallelExplorationWanted: true });
  assert.equal(dec.recommendedLevel, 'inferno');
});

test('ascend falls back to canvas without budget', () => {
  const dec = ascendSelectLevel({ complexity: 'large', hasBudget: false, ossMiningWanted: false, parallelExplorationWanted: false });
  assert.equal(dec.recommendedLevel, 'canvas');
});

test('ascend selects blaze for parallel exploration with budget', () => {
  const dec = ascendSelectLevel({ complexity: 'medium', hasBudget: true, ossMiningWanted: false, parallelExplorationWanted: true });
  assert.equal(dec.recommendedLevel, 'blaze');
});
