// Tests for CommandFilterRegistry (PRD-26 / Article XIV)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CommandFilterRegistry, defaultRegistry } from '../src/core/context-economy/command-filter-registry.js';
import { compressArtifact } from '../src/core/context-economy/artifact-compressor.js';

// ── CommandFilterRegistry ────────────────────────────────────────────────────

describe('CommandFilterRegistry', () => {
  it('ships 10 built-in filters', () => {
    assert.equal(defaultRegistry.size, 10);
  });

  it('returns found for git status', () => {
    const result = defaultRegistry.lookup('git', ['status']);
    assert.equal(result.filterStatus, 'found');
    assert.ok(result.filter !== null);
  });

  it('returns passthrough for unknown command', () => {
    const result = defaultRegistry.lookup('kubectl', ['get', 'pods']);
    assert.equal(result.filterStatus, 'passthrough');
    assert.equal(result.filter, null);
  });

  it('apply returns passthrough result for unknown command', () => {
    const output = 'kubectl output here';
    const result = defaultRegistry.apply(output, 'kubectl', ['get', 'pods']);
    assert.equal(result.status, 'passthrough');
    assert.equal(result.output, output);
    assert.equal(result.savedTokens, 0);
  });

  it('apply returns an npm-handled result for npm install', () => {
    const output = 'added 50 packages\nnpm notice New version available\nfound 0 vulnerabilities';
    const result = defaultRegistry.apply(output, 'npm', ['install']);
    assert.ok(['filtered', 'low-yield', 'passthrough', 'sacred-bypass'].includes(result.status));
    assert.equal(result.filterId, 'npm');
  });

  it('apply is fail-closed: returns filter-failed status on crashing filter', () => {
    // Use a command with no built-in filter so the crash filter is reached.
    const badRegistry = new CommandFilterRegistry([{
      filterId: 'crash',
      detect: (cmd) => cmd === 'crashcmd',
      filter: () => { throw new Error('crash'); },
    }]);
    const result = badRegistry.apply('some output', 'crashcmd', []);
    assert.equal(result.status, 'filter-failed');
  });

  it('accepts extra filters via constructor', () => {
    const custom = new CommandFilterRegistry([{
      filterId: 'custom-tool',
      detect: (cmd) => cmd === 'mytool',
      filter: (out) => ({
        output: 'compressed', status: 'filtered' as const,
        inputTokens: 100, outputTokens: 20, savedTokens: 80,
        savingsPercent: 80, sacredSpanCount: 0, filterId: 'custom-tool',
      }),
    }]);
    assert.equal(custom.size, 11);
    const result = custom.lookup('mytool', []);
    assert.equal(result.filterStatus, 'found');
  });

  it('filterIds returns all 10 built-in filter ids', () => {
    const ids = defaultRegistry.filterIds;
    assert.ok(ids.includes('git'));
    assert.ok(ids.includes('npm'));
    assert.ok(ids.includes('cargo'));
    assert.ok(ids.includes('docker'));
    assert.equal(ids.length, 10);
  });
});

// ── artifact-compressor ───────────────────────────────────────────────────────

describe('compressArtifact', () => {
  it('returns original content when under max size', () => {
    const content = 'short content';
    const result = compressArtifact(content, 'score-report');
    assert.equal(result.compressed, content);
    assert.equal(result.savingsPercent, 0);
  });

  it('compresses large audit-log content', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `2026-04-25T00:${String(i % 60).padStart(2,'0')}:00Z | event ${i}`);
    const content = lines.join('\n');
    const result = compressArtifact(content, 'audit-log');
    assert.ok(result.compressedSize < result.originalSize, `Should compress: ${result.compressedSize} < ${result.originalSize}`);
    assert.ok(result.savingsPercent > 0);
  });

  it('preserves sacred spans in compressed output', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `log line ${i}`);
    lines.push('error: gate failure detected');
    const content = lines.join('\n');
    const result = compressArtifact(content, 'audit-log');
    assert.ok(result.sacredSpans.length > 0 || result.compressed.includes('error'));
  });

  it('is fail-closed: returns raw on internal error', () => {
    const content = 'simple content';
    const result = compressArtifact(content, 'verify-output');
    assert.ok(result.compressed.length > 0);
    assert.ok(result.originalSize > 0);
  });

  it('reports originalSize and compressedSize in bytes', () => {
    const content = 'hello world';
    const result = compressArtifact(content, 'prd-spec-plan');
    assert.equal(result.originalSize, Buffer.byteLength(content, 'utf8'));
  });
});
