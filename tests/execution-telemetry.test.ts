import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTelemetry,
  recordToolCall,
  recordBashCommand,
  recordFileModified,
  summarizeTelemetry,
  createExtendedTelemetry,
  createBudgetFence,
  checkBudgetFence,
  updateBudgetFence,
  recordTokenUsage,
  recordLocalTransformSavings,
  recordCompressionSavings,
  recordGateBlock,
  generateTokenReport,
} from '../src/core/execution-telemetry.js';

describe('createTelemetry', () => {
  it('returns empty telemetry', () => {
    const t = createTelemetry();
    assert.equal(t.toolCalls.length, 0);
    assert.equal(t.bashCommands.length, 0);
    assert.equal(t.filesModified.length, 0);
    assert.equal(t.duration, 0);
    assert.equal(t.tokenEstimate, 0);
  });
});

describe('recordToolCall', () => {
  it('adds a tool call entry', () => {
    const t = createTelemetry();
    recordToolCall(t, 'Read');
    assert.equal(t.toolCalls.length, 1);
    assert.equal(t.toolCalls[0].name, 'Read');
  });

  it('classifies write tools as write', () => {
    const t = createTelemetry();
    recordToolCall(t, 'edit');
    assert.ok(t.toolCalls[0].isWrite);
  });

  it('classifies read tools as non-write', () => {
    const t = createTelemetry();
    recordToolCall(t, 'Read');
    assert.ok(!t.toolCalls[0].isWrite);
  });

  it('respects explicit isWrite override', () => {
    const t = createTelemetry();
    recordToolCall(t, 'Read', true);
    assert.ok(t.toolCalls[0].isWrite);
  });
});

describe('recordBashCommand', () => {
  it('adds command to bashCommands', () => {
    const t = createTelemetry();
    recordBashCommand(t, 'ls -la');
    assert.ok(t.bashCommands.includes('ls -la'));
  });

  it('records write bash commands as tool calls too', () => {
    const t = createTelemetry();
    recordBashCommand(t, 'git commit -m "test"');
    assert.ok(t.toolCalls.some(tc => tc.isWrite));
  });

  it('does not add tool call for read-only commands', () => {
    const t = createTelemetry();
    recordBashCommand(t, 'ls -la');
    assert.equal(t.toolCalls.length, 0);
  });
});

describe('recordFileModified', () => {
  it('adds file to filesModified', () => {
    const t = createTelemetry();
    recordFileModified(t, 'src/index.ts');
    assert.ok(t.filesModified.includes('src/index.ts'));
  });

  it('deduplicates files', () => {
    const t = createTelemetry();
    recordFileModified(t, 'src/index.ts');
    recordFileModified(t, 'src/index.ts');
    assert.equal(t.filesModified.length, 1);
  });
});

describe('summarizeTelemetry', () => {
  it('includes duration', () => {
    const t = createTelemetry();
    t.duration = 5000;
    const summary = summarizeTelemetry(t);
    assert.ok(summary.includes('5.0s'));
  });

  it('includes tool call count', () => {
    const t = createTelemetry();
    recordToolCall(t, 'Read');
    recordToolCall(t, 'edit');
    const summary = summarizeTelemetry(t);
    assert.ok(summary.includes('2'));
  });

  it('includes files modified count', () => {
    const t = createTelemetry();
    recordFileModified(t, 'a.ts');
    const summary = summarizeTelemetry(t);
    assert.ok(summary.includes('1'));
  });

  it('includes token estimate when nonzero', () => {
    const t = createTelemetry();
    t.tokenEstimate = 1000;
    const summary = summarizeTelemetry(t);
    assert.ok(summary.includes('1,000') || summary.includes('1000'));
  });
});

describe('createBudgetFence', () => {
  it('creates fence with given role and budget', () => {
    const fence = createBudgetFence('orchestrator', 0.5);
    assert.equal(fence.agentRole, 'orchestrator');
    assert.equal(fence.maxBudgetUsd, 0.5);
    assert.equal(fence.currentSpendUsd, 0);
    assert.ok(!fence.isExceeded);
  });

  it('uses default warning threshold of 80', () => {
    const fence = createBudgetFence('agent', 1.0);
    assert.equal(fence.warningThresholdPercent, 80);
  });

  it('accepts custom warning threshold', () => {
    const fence = createBudgetFence('agent', 1.0, 90);
    assert.equal(fence.warningThresholdPercent, 90);
  });
});

describe('checkBudgetFence', () => {
  it('returns proceed true when budget not exceeded', () => {
    const fence = createBudgetFence('agent', 1.0);
    const result = checkBudgetFence(fence);
    assert.ok(result.proceed);
  });

  it('returns proceed false when budget exceeded', () => {
    const fence = { ...createBudgetFence('agent', 0.1), isExceeded: true, currentSpendUsd: 0.2 };
    const result = checkBudgetFence(fence);
    assert.ok(!result.proceed);
    assert.ok(result.warning?.includes('agent'));
  });

  it('returns warning when approaching threshold', () => {
    const fence = createBudgetFence('agent', 1.0, 80);
    const nearFence = { ...fence, currentSpendUsd: 0.85 };
    const result = checkBudgetFence(nearFence);
    assert.ok(result.warning !== undefined);
  });
});

describe('updateBudgetFence', () => {
  it('accumulates spend', () => {
    const fence = createBudgetFence('agent', 1.0);
    const updated = updateBudgetFence(fence, 0.3);
    assert.equal(updated.currentSpendUsd, 0.3);
  });

  it('marks exceeded when spend reaches max', () => {
    const fence = createBudgetFence('agent', 0.5);
    const updated = updateBudgetFence(fence, 0.5);
    assert.ok(updated.isExceeded);
  });

  it('does not mutate original fence', () => {
    const fence = createBudgetFence('agent', 1.0);
    updateBudgetFence(fence, 0.3);
    assert.equal(fence.currentSpendUsd, 0);
  });
});

describe('recordTokenUsage', () => {
  it('adds record and increments tokenEstimate', () => {
    const t = createExtendedTelemetry();
    recordTokenUsage(t, 100, 50, 0.001, 'forge', 'heavy', 'claude');
    assert.equal(t.tokenUsageRecords.length, 1);
    assert.equal(t.tokenEstimate, 150);
  });

  it('records agentRole, tier, model', () => {
    const t = createExtendedTelemetry();
    recordTokenUsage(t, 100, 50, 0.001, 'forge', 'heavy', 'claude-opus');
    assert.equal(t.tokenUsageRecords[0].agentRole, 'forge');
    assert.equal(t.tokenUsageRecords[0].model, 'claude-opus');
  });
});

describe('recordLocalTransformSavings', () => {
  it('increments callCount and savings', () => {
    const t = createExtendedTelemetry();
    recordLocalTransformSavings(t, 500, 0.005);
    assert.equal(t.localTransformSavings.callCount, 1);
    assert.equal(t.localTransformSavings.estimatedSavedTokens, 500);
  });
});

describe('recordCompressionSavings', () => {
  it('accumulates original and compressed tokens', () => {
    const t = createExtendedTelemetry();
    recordCompressionSavings(t, 1000, 400);
    assert.equal(t.compressionSavings.originalTokens, 1000);
    assert.equal(t.compressionSavings.compressedTokens, 400);
  });
});

describe('recordGateBlock', () => {
  it('increments blockedCallCount and estimated savings', () => {
    const t = createExtendedTelemetry();
    recordGateBlock(t, 2000);
    assert.equal(t.gateBlockSavings.blockedCallCount, 1);
    assert.equal(t.gateBlockSavings.estimatedSavedTokens, 2000);
  });
});

describe('generateTokenReport', () => {
  it('returns report with sessionId', () => {
    const t = createExtendedTelemetry();
    const report = generateTokenReport(t, 'session-123');
    assert.equal(report.sessionId, 'session-123');
  });

  it('sums total tokens from records', () => {
    const t = createExtendedTelemetry();
    recordTokenUsage(t, 100, 50, 0.001);
    recordTokenUsage(t, 200, 100, 0.002);
    const report = generateTokenReport(t, 's');
    assert.equal(report.totalInputTokens, 300);
    assert.equal(report.totalOutputTokens, 150);
  });

  it('groups by agent role', () => {
    const t = createExtendedTelemetry();
    recordTokenUsage(t, 100, 50, 0.001, 'forge');
    const report = generateTokenReport(t, 's');
    assert.ok('forge' in report.byAgent);
    assert.equal(report.byAgent['forge'].callCount, 1);
  });

  it('has timestamp string', () => {
    const t = createExtendedTelemetry();
    const report = generateTokenReport(t, 's');
    assert.ok(typeof report.timestamp === 'string' && report.timestamp.length > 0);
  });
});
