import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveUpdateMcpMode } from '../src/cli/commands/update-mcp.js';

describe('update-mcp mode resolution', () => {
  it('defaults to check mode', () => {
    assert.strictEqual(resolveUpdateMcpMode({}), 'check');
  });

  it('uses prompt mode when requested', () => {
    assert.strictEqual(resolveUpdateMcpMode({ prompt: true }), 'prompt');
  });

  it('uses apply mode when requested', () => {
    assert.strictEqual(resolveUpdateMcpMode({ apply: true }), 'apply');
  });

  it('supports explicit check mode', () => {
    assert.strictEqual(resolveUpdateMcpMode({ check: true }), 'check');
  });

  it('rejects conflicting flags', () => {
    assert.throws(
      () => resolveUpdateMcpMode({ apply: true, prompt: true }),
      /mutually exclusive/,
    );
    assert.throws(
      () => resolveUpdateMcpMode({ apply: true, check: true }),
      /mutually exclusive/,
    );
    assert.throws(
      () => resolveUpdateMcpMode({ check: true, prompt: true }),
      /mutually exclusive/,
    );
  });
});
