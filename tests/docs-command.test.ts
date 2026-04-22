import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCommandReference } from '../src/cli/commands/docs.js';

describe('formatCommandReference', () => {
  it('returns a non-empty string', () => {
    const result = formatCommandReference();
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  it('includes the DanteForge Command Reference header', () => {
    const result = formatCommandReference();
    assert.ok(result.includes('DanteForge Command Reference'));
  });

  it('includes all major groups', () => {
    const result = formatCommandReference();
    assert.ok(result.includes('Pipeline'));
    assert.ok(result.includes('Automation'));
    assert.ok(result.includes('Intelligence'));
    assert.ok(result.includes('Tools'));
  });

  it('includes core pipeline commands', () => {
    const result = formatCommandReference();
    assert.ok(result.includes('forge'));
    assert.ok(result.includes('verify'));
    assert.ok(result.includes('specify'));
  });

  it('includes automation presets', () => {
    const result = formatCommandReference();
    assert.ok(result.includes('magic'));
    assert.ok(result.includes('spark'));
    assert.ok(result.includes('inferno'));
  });

  it('is deterministic across multiple calls', () => {
    const a = formatCommandReference();
    const b = formatCommandReference();
    assert.equal(a, b);
  });

  it('includes danteforge prefix in usage examples', () => {
    const result = formatCommandReference();
    assert.ok(result.includes('danteforge '));
  });

  it('includes table of contents section', () => {
    const result = formatCommandReference();
    assert.ok(result.includes('Table of Contents'));
  });
});
