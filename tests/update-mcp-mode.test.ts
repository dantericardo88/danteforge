import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveUpdateMcpMode } from '../src/cli/commands/update-mcp.js';

describe('resolveUpdateMcpMode', () => {
  it('defaults to "check" when no flags provided', () => {
    assert.equal(resolveUpdateMcpMode({}), 'check');
  });

  it('returns "prompt" when prompt flag set', () => {
    assert.equal(resolveUpdateMcpMode({ prompt: true }), 'prompt');
  });

  it('returns "apply" when apply flag set', () => {
    assert.equal(resolveUpdateMcpMode({ apply: true }), 'apply');
  });

  it('returns "check" when check flag set', () => {
    assert.equal(resolveUpdateMcpMode({ check: true }), 'check');
  });

  it('returns "check" when all flags are false', () => {
    assert.equal(resolveUpdateMcpMode({ prompt: false, apply: false, check: false }), 'check');
  });

  it('throws when multiple mutually exclusive flags set', () => {
    assert.throws(() => resolveUpdateMcpMode({ prompt: true, apply: true }), /mutually exclusive/);
    assert.throws(() => resolveUpdateMcpMode({ prompt: true, check: true }), /mutually exclusive/);
    assert.throws(() => resolveUpdateMcpMode({ apply: true, check: true }), /mutually exclusive/);
  });

  it('throws for all three flags set', () => {
    assert.throws(() => resolveUpdateMcpMode({ prompt: true, apply: true, check: true }), /mutually exclusive/);
  });
});
