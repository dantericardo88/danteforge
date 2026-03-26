// MCP Adapter Extended tests — injection seam coverage for testMCPConnection, saveFigmaConfig, getProjectCharacteristicsFor
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  testMCPConnection,
  saveFigmaConfig,
  getProjectCharacteristicsFor,
  resolveTier,
  selectFigmaMode,
} from '../src/core/mcp-adapter.js';

// --- Helpers ---

function makeFetch(status: number): typeof globalThis.fetch {
  return async () => new Response('', { status });
}

function makeErrorFetch(msg: string): typeof globalThis.fetch {
  return async () => {
    throw new Error(msg);
  };
}

function makeConfigOps(initial: Record<string, any> = {}) {
  let savedConfig: Record<string, any> | null = null;
  return {
    load: async () => ({ ...initial }),
    save: async (c: Record<string, any>) => {
      savedConfig = c;
    },
    getSaved: () => savedConfig,
  };
}

function makeDeps(
  overrides: {
    isUI?: boolean;
    tier?: string;
    designExists?: boolean;
  } = {},
) {
  return {
    isUIProject: async () => overrides.isUI ?? false,
    initMCPAdapter: async () => ({
      host: 'claude-code' as const,
      tier: (overrides.tier ?? 'prompt-only') as any,
      capabilities: { hasFigmaMCP: overrides.tier !== 'prompt-only' },
      mcpEndpoint: 'https://mcp.figma.com/mcp',
    }),
    fsAccess: overrides.designExists
      ? async () => {}
      : async () => {
          throw new Error('ENOENT');
        },
  };
}

// --- testMCPConnection ---

describe('testMCPConnection with _fetch injection', () => {
  it('returns ok:true when server responds 200', async () => {
    const result = await testMCPConnection(makeFetch(200));
    assert.strictEqual(result.ok, true);
    assert.ok(result.message.toLowerCase().includes('reachable'));
  });

  it('returns ok:true when server responds 405 (method not allowed)', async () => {
    const result = await testMCPConnection(makeFetch(405));
    assert.strictEqual(result.ok, true);
    assert.ok(result.message.toLowerCase().includes('reachable'));
  });

  it('returns ok:false when server responds 500', async () => {
    const result = await testMCPConnection(makeFetch(500));
    assert.strictEqual(result.ok, false);
    assert.ok(result.message.includes('500'));
  });

  it('returns ok:false with "Cannot reach" on network error', async () => {
    const result = await testMCPConnection(makeErrorFetch('ECONNREFUSED'));
    assert.strictEqual(result.ok, false);
    assert.ok(result.message.includes('Cannot reach'));
    assert.ok(result.message.includes('ECONNREFUSED'));
  });

  it('returns ok:true with options-object style { _fetch }', async () => {
    const result = await testMCPConnection({ _fetch: makeFetch(200) });
    assert.strictEqual(result.ok, true);
    assert.ok(result.message.toLowerCase().includes('reachable'));
  });
});

// --- saveFigmaConfig ---

describe('saveFigmaConfig with _configOps injection', () => {
  it('saves figmaUrl to config as figma.defaultFileUrl', async () => {
    const ops = makeConfigOps({ defaultProvider: 'ollama', ollamaModel: 'llama3', providers: {} });
    await saveFigmaConfig('https://figma.com/file/abc', undefined, undefined, ops as any);
    const saved = ops.getSaved();
    assert.ok(saved, 'config should have been saved');
    assert.strictEqual(saved!.figma?.defaultFileUrl, 'https://figma.com/file/abc');
  });

  it('saves tokenPath to config as figma.designTokensPath', async () => {
    const ops = makeConfigOps({ defaultProvider: 'ollama', ollamaModel: 'llama3', providers: {} });
    await saveFigmaConfig(undefined, 'tokens.json', undefined, ops as any);
    const saved = ops.getSaved();
    assert.ok(saved, 'config should have been saved');
    assert.strictEqual(saved!.figma?.designTokensPath, 'tokens.json');
  });

  it('partial update preserves existing figma fields', async () => {
    const ops = makeConfigOps({
      defaultProvider: 'ollama',
      ollamaModel: 'llama3',
      providers: {},
      figma: { defaultFileUrl: 'https://figma.com/file/existing' },
    });
    await saveFigmaConfig(undefined, 'tokens.json', undefined, ops as any);
    const saved = ops.getSaved();
    assert.ok(saved, 'config should have been saved');
    assert.strictEqual(saved!.figma?.defaultFileUrl, 'https://figma.com/file/existing');
    assert.strictEqual(saved!.figma?.designTokensPath, 'tokens.json');
  });
});

// --- getProjectCharacteristicsFor ---

describe('getProjectCharacteristicsFor with _deps injection', () => {
  it('detects UI project with Figma and design file', async () => {
    const deps = makeDeps({ isUI: true, tier: 'full', designExists: true });
    const result = await getProjectCharacteristicsFor('/tmp/test-project', deps);
    assert.strictEqual(result.hasUI, true);
    assert.strictEqual(result.hasFigma, true);
    assert.strictEqual(result.hasDesign, true);
  });

  it('detects non-UI project without Figma or design', async () => {
    const deps = makeDeps({ isUI: false, tier: 'prompt-only', designExists: false });
    const result = await getProjectCharacteristicsFor('/tmp/test-project', deps);
    assert.strictEqual(result.hasUI, false);
    assert.strictEqual(result.hasFigma, false);
    assert.strictEqual(result.hasDesign, false);
  });

  it('gracefully falls back when design file access throws', async () => {
    const deps = makeDeps({ isUI: true, tier: 'full', designExists: false });
    const result = await getProjectCharacteristicsFor('/tmp/test-project', deps);
    assert.strictEqual(result.hasUI, true);
    assert.strictEqual(result.hasFigma, true);
    assert.strictEqual(result.hasDesign, false);
  });
});
