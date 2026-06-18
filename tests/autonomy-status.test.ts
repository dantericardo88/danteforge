import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDimAutonomy, autonomyReport } from '../src/core/autonomy-status.ts';

test('classifyDimAutonomy: grounded → machine; market dim → capped; else self-attested', () => {
  assert.equal(classifyDimAutonomy({ id: 'code_generation', derived: 7 }, true), 'machine-grounded');
  assert.equal(classifyDimAutonomy({ id: 'community_adoption', derived: 5 }, false), 'ontologically-capped');
  assert.equal(classifyDimAutonomy({ id: 'token_economy', derived: 5 }, false), 'ontologically-capped');
  assert.equal(classifyDimAutonomy({ id: 'testing', derived: 8 }, false), 'self-attested');
  // a market dim that somehow IS grounded still reads as machine-grounded (grounding wins)
  assert.equal(classifyDimAutonomy({ id: 'enterprise_readiness', derived: 5 }, true), 'machine-grounded');
});

test('autonomyReport decomposes coverage honestly (the real DanteForge shape: 1/25 grounded, 3 capped)', () => {
  const dims = [
    { id: 'code_generation', derived: 0 },
    { id: 'community_adoption', derived: 5 }, { id: 'enterprise_readiness', derived: 5 }, { id: 'token_economy', derived: 5 },
    ...Array.from({ length: 21 }, (_, i) => ({ id: `dim_${i}`, derived: 8 })),
  ];
  const r = autonomyReport(dims, new Set(['code_generation']));
  assert.equal(r.total, 25);
  assert.equal(r.machineGrounded, 1);
  assert.equal(r.ontologicallyCapped, 3);
  assert.equal(r.selfAttested, 21);
  assert.equal(Math.round(r.machineAutonomousCoverage * 100), 4);   // 1/25 = 4% coverage
  assert.equal(Math.round(r.groundableCoverage * 100), 5);          // 1/22 groundable = ~5%
});

test('autonomyReport: a fully-grounded matrix reads near-total coverage (the ceiling for groundable dims)', () => {
  const dims = [{ id: 'a', derived: 9 }, { id: 'b', derived: 9 }, { id: 'community_adoption', derived: 5 }];
  const r = autonomyReport(dims, new Set(['a', 'b']));
  assert.equal(r.groundableCoverage, 1);                 // both non-capped dims grounded
  assert.ok(r.machineAutonomousCoverage < 1);            // the capped dim is never machine-autonomous
});
