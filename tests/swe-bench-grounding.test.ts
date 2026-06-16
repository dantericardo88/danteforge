// Phase 2 regression: the external-grounding harness honestly measures a solver's code generation.
// Verifies the plumbing end-to-end with fake solvers — the gold patch is withheld, a correct solver
// scores 1.0, a wrong solver scores 0, and the output line is consumable by parsePassRate.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  runSweBenchGrounding, formatPassRateLine, type SweBenchInstance, type SweBenchProblem,
} from '../src/matrix/engines/swe-bench-grounding.js';
import { parsePassRate } from '../src/matrix/engines/external-benchmark-runner.js';

const INSTANCES: SweBenchInstance[] = [
  { instance_id: 'a', patch: 'GOLD_A', test_patch: 'TEST_A' },
  { instance_id: 'b', patch: 'GOLD_B', test_patch: 'TEST_B' },
  { instance_id: 'c', patch: 'GOLD_C', test_patch: 'TEST_C' },
  { instance_id: 'd', patch: 'GOLD_D', test_patch: 'TEST_D' },
];

// A fake sandbox: a candidate "resolves" iff it equals that instance's gold patch.
const fakeRunTest = async (candidate: string, _testPatch: string, instanceId: string) => {
  const gold = INSTANCES.find(i => i.instance_id === instanceId)!.patch;
  return { passed: candidate === gold, durationMs: 1 };
};

const goldFor = (p: SweBenchProblem) => INSTANCES.find(i => i.instance_id === p.instance_id)!.patch;

describe('swe-bench grounding harness — Phase 2', () => {
  test('the solver NEVER receives the gold patch (only the spec is exposed)', async () => {
    let leaked = false;
    await runSweBenchGrounding(INSTANCES, async (p) => {
      if ('patch' in (p as Record<string, unknown>)) leaked = true;
      return goldFor(p);
    }, fakeRunTest);
    assert.equal(leaked, false, 'the gold patch must be withheld from the solver');
  });

  test('a perfect solver scores pass_rate 1.0', async () => {
    const report = await runSweBenchGrounding(INSTANCES, async (p) => goldFor(p), fakeRunTest);
    assert.equal(report.resolved, 4);
    assert.equal(report.pass_rate, 1);
  });

  test('a wrong solver scores pass_rate 0', async () => {
    const report = await runSweBenchGrounding(INSTANCES, async () => 'WRONG', fakeRunTest);
    assert.equal(report.resolved, 0);
    assert.equal(report.pass_rate, 0);
  });

  test('a partial solver scores the honest fraction (a modest score is a success)', async () => {
    // Solves only a and b.
    const report = await runSweBenchGrounding(INSTANCES, async (p) =>
      (p.instance_id === 'a' || p.instance_id === 'b') ? goldFor(p) : 'WRONG', fakeRunTest);
    assert.equal(report.resolved, 2);
    assert.equal(report.pass_rate, 0.5);
  });

  test('a throwing solver scores that instance unresolved (never crashes, never silently passes)', async () => {
    const report = await runSweBenchGrounding(INSTANCES, async (p) => {
      if (p.instance_id === 'a') throw new Error('agent timeout');
      return 'WRONG';
    }, fakeRunTest);
    assert.equal(report.resolved, 0);
    assert.equal(report.results[0]!.error, 'solver error: agent timeout');
  });

  test('the output line is consumable by external-benchmark-runner.parsePassRate (round-trip)', async () => {
    const report = await runSweBenchGrounding(INSTANCES, async (p) =>
      p.instance_id === 'a' ? goldFor(p) : 'WRONG', fakeRunTest);
    const line = formatPassRateLine(report);
    assert.equal(parsePassRate(line), 0.25, 'the grounding runner reads back the same pass_rate');
  });
});
