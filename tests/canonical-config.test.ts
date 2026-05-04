// canonical config command — injection-seam tests
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { canonicalConfig } from '../src/cli/commands/canonical.js';

function noopFns() {
  return {
    setup: async () => {},
    mcp: async () => {},
    skills: async () => {},
    premium: async () => {},
    workspace: async () => {},
  };
}

describe('canonicalConfig', () => {
  it('setup action dispatches setup', async () => {
    let called = false;
    await canonicalConfig({
      action: 'setup',
      _fns: { ...noopFns(), setup: async () => { called = true; } },
    });
    assert.strictEqual(called, true);
  });

  it('llm action routes to setup', async () => {
    let called = false;
    await canonicalConfig({
      action: 'llm',
      _fns: { ...noopFns(), setup: async () => { called = true; } },
    });
    assert.strictEqual(called, true);
  });

  it('mcp action dispatches mcp', async () => {
    let called = false;
    await canonicalConfig({
      action: 'mcp',
      _fns: { ...noopFns(), mcp: async () => { called = true; } },
    });
    assert.strictEqual(called, true);
  });

  it('skills action dispatches skills', async () => {
    let called = false;
    await canonicalConfig({
      action: 'skills',
      _fns: { ...noopFns(), skills: async () => { called = true; } },
    });
    assert.strictEqual(called, true);
  });

  it('skills action with scan flag passes scan=true', async () => {
    let receivedScan: boolean | undefined = undefined;
    await canonicalConfig({
      action: 'skills',
      scan: true,
      _fns: { ...noopFns(), skills: async (scan?: boolean) => { receivedScan = scan; } },
    });
    assert.strictEqual(receivedScan, true);
  });

  it('premium action dispatches premium', async () => {
    let called = false;
    await canonicalConfig({
      action: 'premium',
      _fns: { ...noopFns(), premium: async () => { called = true; } },
    });
    assert.strictEqual(called, true);
  });

  it('workspace action dispatches workspace', async () => {
    let called = false;
    await canonicalConfig({
      action: 'workspace',
      _fns: { ...noopFns(), workspace: async () => { called = true; } },
    });
    assert.strictEqual(called, true);
  });

  it('no-op default when no action provided', async () => {
    await assert.doesNotReject(() => canonicalConfig({ _fns: noopFns() }));
  });
});
