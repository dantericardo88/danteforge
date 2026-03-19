import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { ReflectionVerdict } from '../src/core/reflection-engine.js';

function makeVerdict(overrides: Partial<ReflectionVerdict> = {}): ReflectionVerdict {
  return {
    sessionId: 'test',
    taskName: 'test-task',
    status: 'complete',
    confidence: 0.95,
    evidence: {
      tests: { ran: true, passed: true, ranAfterChanges: true },
      build: { ran: true, passed: true, ranAfterChanges: true },
      lint: { ran: true, passed: true, ranAfterChanges: true },
    },
    remainingWork: [],
    nextSteps: [],
    needsHumanAction: [],
    stuck: false,
    severity: 'NONE',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('FixPacket', () => {
  it('generates empty packet for passing verdict', async () => {
    const { generateFixPacket } = await import('../src/core/fix-packet.js');
    const verdict = makeVerdict();
    const packet = generateFixPacket(verdict);

    assert.strictEqual(packet.violations.length, 0);
    assert.strictEqual(packet.score, 100);
    assert.strictEqual(packet.remediation.length, 0);
  });

  it('generates violations for failed tests', async () => {
    const { generateFixPacket } = await import('../src/core/fix-packet.js');
    const verdict = makeVerdict({
      status: 'blocked',
      evidence: {
        tests: { ran: true, passed: false, ranAfterChanges: true },
        build: { ran: true, passed: true, ranAfterChanges: true },
        lint: { ran: true, passed: true, ranAfterChanges: true },
      },
    });

    const packet = generateFixPacket(verdict);
    assert.ok(packet.violations.length > 0);
    assert.ok(packet.violations.some(v => v.type === 'test-missing'));
    assert.ok(packet.score < 100);
  });

  it('sorts violations by severity (BLOCKER first)', async () => {
    const { generateFixPacket } = await import('../src/core/fix-packet.js');
    const verdict = makeVerdict({
      status: 'blocked',
      stuck: true,
      evidence: {
        tests: { ran: true, passed: false, ranAfterChanges: true },
        build: { ran: true, passed: false, ranAfterChanges: true },
        lint: { ran: true, passed: false, ranAfterChanges: true },
      },
    });

    const packet = generateFixPacket(verdict);
    assert.ok(packet.violations.length >= 2);
    // First violations should be BLOCKER severity
    const severities = packet.violations.map(v => v.severity);
    const blockerIdx = severities.indexOf('BLOCKER');
    const lowIdx = severities.indexOf('LOW');
    if (blockerIdx !== -1 && lowIdx !== -1) {
      assert.ok(blockerIdx < lowIdx);
    }
  });

  it('includes loop violation when loop detected', async () => {
    const { generateFixPacket } = await import('../src/core/fix-packet.js');
    const verdict = makeVerdict();
    const loopResult = {
      detected: true,
      type: 'planning' as const,
      evidence: '10 reads, 0 writes',
      severity: 'HIGH' as const,
    };

    const packet = generateFixPacket(verdict, loopResult);
    assert.ok(packet.violations.some(v => v.type === 'loop-detected'));
    assert.ok(packet.score < 100);
  });
});
