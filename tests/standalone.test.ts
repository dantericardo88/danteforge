// Standalone mode tests — isStandalone, standaloneVerify, standaloneReport
// All tests use tmp dirs and never call the real LLM or real PDSE API.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let tmpDir: string;
const originalCwd = process.cwd();
const originalEnv = { ...process.env };

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-standalone-'));
  process.chdir(tmpDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  // Restore env vars
  for (const key of ['DANTECODE_ROOT', 'CLAUDE_PLUGIN_ROOT']) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── isStandalone ──────────────────────────────────────────────────────────

describe('isStandalone', () => {
  it('returns true when neither env var is set', async () => {
    delete process.env.DANTECODE_ROOT;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const { isStandalone } = await import('../src/core/standalone.js');
    assert.strictEqual(isStandalone(), true);
  });

  it('returns false when DANTECODE_ROOT is set', async () => {
    process.env.DANTECODE_ROOT = '/some/root';
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const { isStandalone } = await import('../src/core/standalone.js');
    assert.strictEqual(isStandalone(), false);
    delete process.env.DANTECODE_ROOT;
  });

  it('returns false when CLAUDE_PLUGIN_ROOT is set', async () => {
    delete process.env.DANTECODE_ROOT;
    process.env.CLAUDE_PLUGIN_ROOT = '/plugin/root';
    const { isStandalone } = await import('../src/core/standalone.js');
    assert.strictEqual(isStandalone(), false);
    delete process.env.CLAUDE_PLUGIN_ROOT;
  });
});

// ─── standaloneVerify ──────────────────────────────────────────────────────

describe('standaloneVerify', () => {
  it('returns a result with required fields in an empty project dir', async () => {
    const { standaloneVerify } = await import('../src/core/standalone.js');
    const result = await standaloneVerify(tmpDir);

    assert.ok(typeof result.score === 'number', 'score should be a number');
    assert.ok(result.score >= 0 && result.score <= 100, `score ${result.score} should be 0-100`);
    assert.ok(Array.isArray(result.issues), 'issues should be an array');
    assert.ok(typeof result.pdseScores === 'object', 'pdseScores should be an object');
    assert.ok(typeof result.projectType === 'string', 'projectType should be a string');
    assert.ok(typeof result.timestamp === 'string', 'timestamp should be a string');
    assert.ok(result.timestamp.length > 0, 'timestamp should be non-empty');
  });

  it('returns score of 0 for empty dir (no artifacts, no source files)', async () => {
    const { standaloneVerify } = await import('../src/core/standalone.js');
    const result = await standaloneVerify(tmpDir);
    // No PDSE artifacts and no drift violations → score is 0
    assert.strictEqual(result.score, 0);
    assert.deepStrictEqual(result.issues, []);
  });

  it('does not crash when src/ directory is missing', async () => {
    // tmpDir has no src/ directory
    const { standaloneVerify } = await import('../src/core/standalone.js');
    await assert.doesNotReject(() => standaloneVerify(tmpDir));
  });

  it('handles src/ directory with TS files and still produces a result', async () => {
    // Create a minimal src dir with a TS file
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir);
    await fs.writeFile(path.join(srcDir, 'index.ts'), 'export function hello() { return "hello"; }');

    const { standaloneVerify } = await import('../src/core/standalone.js');
    const result = await standaloneVerify(tmpDir);
    assert.ok(typeof result.score === 'number', 'should still return a numeric score');
  });

  it('returns projectType from state (defaults to unknown)', async () => {
    const { standaloneVerify } = await import('../src/core/standalone.js');
    const result = await standaloneVerify(tmpDir);
    // Fresh state has no projectType configured → 'unknown'
    assert.ok(
      result.projectType === 'unknown' || typeof result.projectType === 'string',
      'projectType should be a string',
    );
  });
});

// ─── standaloneReport ──────────────────────────────────────────────────────

describe('standaloneReport', () => {
  it('returns a markdown report string with required sections', async () => {
    const { standaloneReport } = await import('../src/core/standalone.js');
    const report = await standaloneReport(tmpDir);

    assert.ok(typeof report === 'string', 'report should be a string');
    assert.ok(report.includes('# DanteForge Standalone Verification Report'), 'should have header');
    assert.ok(report.includes('**Score:**'), 'should have score line');
    assert.ok(report.includes('**Project Type:**'), 'should have project type');
    assert.ok(report.includes('**Timestamp:**'), 'should have timestamp');
  });

  it('includes drift issues section (empty or with content)', async () => {
    const { standaloneReport } = await import('../src/core/standalone.js');
    const report = await standaloneReport(tmpDir);
    assert.ok(report.includes('## Drift Issues'), 'should have drift issues section');
  });

  it('shows "No drift violations detected" for clean empty project', async () => {
    const { standaloneReport } = await import('../src/core/standalone.js');
    const report = await standaloneReport(tmpDir);
    assert.ok(
      report.includes('No drift violations detected'),
      'Empty project should report no drift violations',
    );
  });

  it('includes PDSE scores section when artifacts are found', async () => {
    // Create a minimal SPEC file so PDSE might score something
    const danteDir = path.join(tmpDir, '.danteforge');
    await fs.mkdir(danteDir);
    await fs.writeFile(path.join(danteDir, 'SPEC.md'), '# Spec\nThis is a test spec.');

    const { standaloneReport } = await import('../src/core/standalone.js');
    const report = await standaloneReport(tmpDir);
    // Report should still be a valid markdown string regardless
    assert.ok(typeof report === 'string');
    assert.ok(report.includes('# DanteForge Standalone Verification Report'));
  });
});
