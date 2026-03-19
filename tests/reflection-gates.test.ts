import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Reflection Gates', () => {
  it('requireNoLoops throws on HIGH severity planning loop', async () => {
    const { requireNoLoops, GateError } = await import('../src/core/gates.js');
    const { createTelemetry, recordToolCall } = await import('../src/core/execution-telemetry.js');

    const t = createTelemetry();
    for (let i = 0; i < 12; i++) recordToolCall(t, 'read', false);

    await assert.rejects(
      () => requireNoLoops(t),
      (err: unknown) => {
        assert.ok(err instanceof GateError);
        assert.strictEqual(err.gate, 'requireNoLoops');
        assert.ok(err.message.includes('loop detected'));
        return true;
      },
    );
  });

  it('requireNoLoops passes with light=true', async () => {
    const { requireNoLoops } = await import('../src/core/gates.js');
    const { createTelemetry, recordToolCall } = await import('../src/core/execution-telemetry.js');

    const t = createTelemetry();
    for (let i = 0; i < 12; i++) recordToolCall(t, 'read', false);

    // Should not throw with light=true
    await requireNoLoops(t, true);
  });

  it('requireNoLoops passes with healthy telemetry', async () => {
    const { requireNoLoops } = await import('../src/core/gates.js');
    const { createTelemetry, recordToolCall } = await import('../src/core/execution-telemetry.js');

    const t = createTelemetry();
    for (let i = 0; i < 5; i++) recordToolCall(t, 'read', false);
    for (let i = 0; i < 5; i++) recordToolCall(t, 'edit', true);

    // Should not throw
    await requireNoLoops(t);
  });
});
