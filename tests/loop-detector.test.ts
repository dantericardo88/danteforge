import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('LoopDetector', () => {
  it('detects planning loop (many reads, no writes)', async () => {
    const { detectPlanningLoop } = await import('../src/core/loop-detector.js');
    const { createTelemetry, recordToolCall } = await import('../src/core/execution-telemetry.js');

    const t = createTelemetry();
    for (let i = 0; i < 10; i++) {
      recordToolCall(t, 'read', false);
    }

    const result = detectPlanningLoop(t);
    assert.strictEqual(result.detected, true);
    assert.strictEqual(result.type, 'planning');
    assert.strictEqual(result.severity, 'HIGH');
  });

  it('does NOT detect planning loop with healthy read/write mix', async () => {
    const { detectPlanningLoop } = await import('../src/core/loop-detector.js');
    const { createTelemetry, recordToolCall } = await import('../src/core/execution-telemetry.js');

    const t = createTelemetry();
    for (let i = 0; i < 5; i++) recordToolCall(t, 'read', false);
    for (let i = 0; i < 5; i++) recordToolCall(t, 'edit', true);

    const result = detectPlanningLoop(t);
    assert.strictEqual(result.detected, false);
  });

  it('detects action loop (repeated commands)', async () => {
    const { detectActionLoop } = await import('../src/core/loop-detector.js');
    const { createTelemetry, recordBashCommand } = await import('../src/core/execution-telemetry.js');

    const t = createTelemetry();
    for (let i = 0; i < 5; i++) {
      recordBashCommand(t, 'npm test');
    }

    const result = detectActionLoop(t);
    assert.strictEqual(result.detected, true);
    assert.strictEqual(result.type, 'action');
  });

  it('does NOT detect action loop with diverse commands', async () => {
    const { detectActionLoop } = await import('../src/core/loop-detector.js');
    const { createTelemetry, recordBashCommand } = await import('../src/core/execution-telemetry.js');

    const t = createTelemetry();
    recordBashCommand(t, 'npm test');
    recordBashCommand(t, 'npm run build');
    recordBashCommand(t, 'npm run lint');
    recordBashCommand(t, 'git status');
    recordBashCommand(t, 'cat package.json');

    const result = detectActionLoop(t);
    assert.strictEqual(result.detected, false);
  });

  it('combined detector returns most severe result', async () => {
    const { detectLoop } = await import('../src/core/loop-detector.js');
    const { createTelemetry, recordToolCall, recordBashCommand } = await import('../src/core/execution-telemetry.js');

    const t = createTelemetry();
    // Create both planning loop AND action loop conditions
    for (let i = 0; i < 10; i++) recordToolCall(t, 'read', false);
    for (let i = 0; i < 5; i++) recordBashCommand(t, 'npm test');

    const result = detectLoop(t);
    assert.strictEqual(result.detected, true);
    assert.strictEqual(result.severity, 'HIGH');
  });
});
