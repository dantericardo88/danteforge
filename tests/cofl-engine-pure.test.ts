import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePatternId,
  renderPartitionTable,
  renderLeverageTable,
  renderAntiFailureReport,
  renderReframe,
} from '../src/core/cofl-engine.js';
import type {
  UniversePartition,
  OperatorLeverageEntry,
  AntiFailureCheck,
  ReframeAssessment,
} from '../src/core/cofl-engine.js';

describe('generatePatternId', () => {
  it('starts with "cofl-"', () => {
    const id = generatePatternId('gpt-engineer', 'wave execution');
    assert.ok(id.startsWith('cofl-'));
  });

  it('slugifies the source+description', () => {
    const id = generatePatternId('gpt-engineer', 'wave execution');
    assert.ok(id.includes('gpt-engineer'));
    assert.ok(id.includes('wave'));
  });

  it('generates unique ids on repeated calls', () => {
    const a = generatePatternId('tool', 'desc');
    const b = generatePatternId('tool', 'desc');
    assert.notEqual(a, b);
  });

  it('handles special characters in inputs', () => {
    const id = generatePatternId('Tool Name!', 'My Feature (v2)');
    assert.ok(/^cofl-[a-z0-9-]+-[0-9a-f]+$/.test(id));
  });
});

describe('renderPartitionTable', () => {
  it('renders section header', () => {
    const partition: UniversePartition = {
      directPeers: ['alpha', 'beta'],
      specialistTeachers: ['gamma'],
      referenceTeachers: [],
    };
    const output = renderPartitionTable(partition);
    assert.ok(output.includes('## Universe Partition'));
  });

  it('shows direct peers', () => {
    const partition: UniversePartition = {
      directPeers: ['alpha', 'beta'],
      specialistTeachers: [],
      referenceTeachers: [],
    };
    const output = renderPartitionTable(partition);
    assert.ok(output.includes('alpha, beta'));
  });

  it('shows "none" for empty arrays', () => {
    const partition: UniversePartition = {
      directPeers: [],
      specialistTeachers: [],
      referenceTeachers: [],
    };
    const output = renderPartitionTable(partition);
    assert.ok(output.includes('none'));
  });
});

describe('renderLeverageTable', () => {
  it('returns no-data message for empty entries', () => {
    const output = renderLeverageTable([]);
    assert.ok(output.includes('No leverage entries'));
  });

  it('renders table headers for non-empty entries', () => {
    const entry: OperatorLeverageEntry = {
      dimensionId: 'dim-1',
      dimensionLabel: 'Test Quality',
      gapToClosedSourceLeader: 3.5,
      gapToOSSLeader: 1.2,
      borrowableFromOSS: true,
      operatorVisibleLift: 8,
      implementationCost: 3,
      proofable: true,
      leverageScore: 7.4,
    };
    const output = renderLeverageTable([entry]);
    assert.ok(output.includes('## Operator Leverage Rankings'));
    assert.ok(output.includes('Test Quality'));
    assert.ok(output.includes('✓'));
  });

  it('sorts entries by leverageScore descending', () => {
    const entries: OperatorLeverageEntry[] = [
      { dimensionId: 'd1', dimensionLabel: 'Low', gapToClosedSourceLeader: 1, gapToOSSLeader: 1, borrowableFromOSS: false, operatorVisibleLift: 1, implementationCost: 5, proofable: false, leverageScore: 2 },
      { dimensionId: 'd2', dimensionLabel: 'High', gapToClosedSourceLeader: 5, gapToOSSLeader: 3, borrowableFromOSS: true, operatorVisibleLift: 9, implementationCost: 2, proofable: true, leverageScore: 9 },
    ];
    const output = renderLeverageTable(entries);
    const highIdx = output.indexOf('High');
    const lowIdx = output.indexOf('Low');
    assert.ok(highIdx < lowIdx, 'High score entry should appear before Low score entry');
  });
});

describe('renderAntiFailureReport', () => {
  it('shows all passed message when no failures', () => {
    const checks: AntiFailureCheck[] = [
      { failureMode: 'Mode A', guardrail: 'Check A', passed: true },
    ];
    const output = renderAntiFailureReport(checks);
    assert.ok(output.includes('All 7 guardrails passed'));
  });

  it('lists failed guardrails', () => {
    const checks: AntiFailureCheck[] = [
      { failureMode: 'Mode A', guardrail: 'Check A', passed: false, violation: 'Too slow' },
      { failureMode: 'Mode B', guardrail: 'Check B', passed: true },
    ];
    const output = renderAntiFailureReport(checks);
    assert.ok(output.includes('1 guardrail(s) violated'));
    assert.ok(output.includes('Mode A'));
    assert.ok(output.includes('Too slow'));
  });
});

describe('renderReframe', () => {
  it('renders reframe header', () => {
    const reframe: ReframeAssessment = {
      becomeMorePreferred: true,
      becomeMoreCoherent: true,
      onlyInflatingRows: false,
      preferenceGainDelta: 5,
      coherenceDelta: 3,
      objectiveFunctionValue: 8.5,
      recommendation: 'Proceed with harvest',
    };
    const output = renderReframe(reframe);
    assert.ok(output.includes('## Reframe'));
    assert.ok(output.includes('Proceed with harvest'));
  });

  it('marks preferred yes/no correctly', () => {
    const reframe: ReframeAssessment = {
      becomeMorePreferred: false,
      becomeMoreCoherent: false,
      onlyInflatingRows: true,
      preferenceGainDelta: -1,
      coherenceDelta: -1,
      objectiveFunctionValue: -2.0,
      recommendation: 'Stop',
    };
    const output = renderReframe(reframe);
    assert.ok(output.includes('✗ No'));
    assert.ok(output.includes('⚠ Yes (warning)'));
    assert.ok(output.includes('-2.00'));
  });
});
