// Tests for exported verify.ts helper functions
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  parseCurrentStateMetadata,
  stageRequiresExecution,
  normalizeMarkdownValue,
  readWorkspacePackageVersion,
} from '../src/cli/commands/verify.js';

const tempDirs: string[] = [];

after(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-verify-'));
  tempDirs.push(dir);
  return dir;
}

// ── parseCurrentStateMetadata ──────────────────────────────────────────────

describe('parseCurrentStateMetadata', () => {
  it('extracts version from table format', () => {
    const content = '| Version | `1.2.3` |\n| Status | active |';
    const meta = parseCurrentStateMetadata(content);
    assert.strictEqual(meta.version, '1.2.3');
  });

  it('extracts version from bullet format', () => {
    const content = '- **Version**: 0.9.0';
    const meta = parseCurrentStateMetadata(content);
    assert.strictEqual(meta.version, '0.9.0');
  });

  it('extracts projectType from table format', () => {
    const content = '| Detected project type | cli |';
    const meta = parseCurrentStateMetadata(content);
    assert.strictEqual(meta.projectType, 'cli');
  });

  it('returns undefined for empty content', () => {
    const meta = parseCurrentStateMetadata('');
    assert.strictEqual(meta.version, undefined);
    assert.strictEqual(meta.projectType, undefined);
  });

  it('returns undefined for invalid projectType', () => {
    const content = '| Detected project type | spaceship |';
    const meta = parseCurrentStateMetadata(content);
    assert.strictEqual(meta.projectType, undefined);
  });

  it('handles backtick-wrapped values', () => {
    const content = '| Version | `2.0.0-beta` |';
    const meta = parseCurrentStateMetadata(content);
    assert.strictEqual(meta.version, '2.0.0-beta');
  });
});

// ── stageRequiresExecution ─────────────────────────────────────────────────

describe('stageRequiresExecution', () => {
  it('returns true for forge', () => {
    assert.strictEqual(stageRequiresExecution('forge'), true);
  });

  it('returns true for ux-refine, verify, synthesize', () => {
    assert.strictEqual(stageRequiresExecution('ux-refine'), true);
    assert.strictEqual(stageRequiresExecution('verify'), true);
    assert.strictEqual(stageRequiresExecution('synthesize'), true);
  });

  it('returns false for planning stages', () => {
    assert.strictEqual(stageRequiresExecution('plan'), false);
    assert.strictEqual(stageRequiresExecution('tasks'), false);
    assert.strictEqual(stageRequiresExecution('specify'), false);
  });

  it('returns false for early stages', () => {
    assert.strictEqual(stageRequiresExecution('initialized'), false);
    assert.strictEqual(stageRequiresExecution('review'), false);
    assert.strictEqual(stageRequiresExecution('constitution'), false);
    assert.strictEqual(stageRequiresExecution('clarify'), false);
  });
});

// ── normalizeMarkdownValue ─────────────────────────────────────────────────

describe('normalizeMarkdownValue', () => {
  it('strips backticks and trims', () => {
    assert.strictEqual(normalizeMarkdownValue('`hello`  '), 'hello');
  });

  it('returns undefined for undefined input', () => {
    assert.strictEqual(normalizeMarkdownValue(undefined), undefined);
  });

  it('handles empty string', () => {
    assert.strictEqual(normalizeMarkdownValue(''), '');
  });
});

// ── readWorkspacePackageVersion ────────────────────────────────────────────

describe('readWorkspacePackageVersion', () => {
  it('returns version from valid package.json', async () => {
    const dir = await makeTmpDir();
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'test', version: '3.1.4' }));
    const version = await readWorkspacePackageVersion(dir);
    assert.strictEqual(version, '3.1.4');
  });

  it('returns undefined when no package.json exists', async () => {
    const dir = await makeTmpDir();
    const version = await readWorkspacePackageVersion(dir);
    assert.strictEqual(version, undefined);
  });

  it('returns undefined when version field is missing', async () => {
    const dir = await makeTmpDir();
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const version = await readWorkspacePackageVersion(dir);
    assert.strictEqual(version, undefined);
  });
});
