import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseVerdict, verifyTask } from '../src/core/verifier.js';

const originalCwd = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  process.chdir(originalCwd);
  process.exitCode = 0;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe('parseVerdict', () => {
  it('detects PASS on first line', () => {
    const { passed } = parseVerdict('PASS\nLooks good.');
    assert.strictEqual(passed, true);
  });

  it('detects PASSED on first line', () => {
    const { passed } = parseVerdict('PASSED\nAll criteria met.');
    assert.strictEqual(passed, true);
  });

  it('detects FAIL on first line', () => {
    const { passed } = parseVerdict('FAIL\nMissing tests.');
    assert.strictEqual(passed, false);
  });

  it('detects FAILED on first line', () => {
    const { passed } = parseVerdict('FAILED\nBroken output.');
    assert.strictEqual(passed, false);
  });

  it('FAIL takes priority over ambiguous lines', () => {
    const { passed } = parseVerdict('FAIL: This almost PASSED but had issues');
    assert.strictEqual(passed, false);
  });

  it('rejects lines that only contain PASS mid-sentence', () => {
    // "This PASSED" does NOT start with PASS
    const { passed } = parseVerdict('This PASSED all checks');
    assert.strictEqual(passed, false);
  });

  it('extracts explanation from remaining lines', () => {
    const { explanation } = parseVerdict('PASS\nLine 1\nLine 2');
    assert.strictEqual(explanation, 'Line 1\nLine 2');
  });

  it('returns empty explanation for single-line response', () => {
    const { explanation } = parseVerdict('PASS');
    assert.strictEqual(explanation, '');
  });

  it('handles empty response as failure', () => {
    const { passed } = parseVerdict('');
    assert.strictEqual(passed, false);
  });

  it('handles whitespace-only response as failure', () => {
    const { passed } = parseVerdict('   \n  ');
    assert.strictEqual(passed, false);
  });
});

describe('verifyTask', () => {
  it('fails closed when no verification output is available', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-verifier-test-'));
    tempDirs.push(tmpDir);
    process.chdir(tmpDir);

    const passed = await verifyTask({ name: 'Ship release', verify: 'All checks pass' });
    const state = await fs.readFile(path.join(tmpDir, '.danteforge', 'STATE.yaml'), 'utf8');

    assert.strictEqual(passed, false);
    assert.match(state, /verify: Ship release/);
    assert.doesNotMatch(state, /PASS \(manual\)/);
  });
});
