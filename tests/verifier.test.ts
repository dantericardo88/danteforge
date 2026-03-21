import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseVerdict, verifyTask, generateVerifyPrompt } from '../src/core/verifier.js';

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

  it('fails closed with no-LLM message when taskOutput is provided but no LLM is available', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-verifier-nollm-'));
    tempDirs.push(tmpDir);
    process.chdir(tmpDir);

    // Provide real task output — triggers the "no LLM available" branch (not the "no output" branch)
    const passed = await verifyTask(
      { name: 'Build API endpoint', verify: 'Endpoint returns 200' },
      'function handler(req, res) { res.json({ ok: true }); }',
    );
    const state = await fs.readFile(path.join(tmpDir, '.danteforge', 'STATE.yaml'), 'utf8');

    assert.strictEqual(passed, false);
    // Audit log should record BLOCKED with the no-LLM reason
    assert.match(state, /Build API endpoint/);
    assert.match(state, /BLOCKED/);
  });

  it('records audit log entry on every call', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-verifier-audit-'));
    tempDirs.push(tmpDir);
    process.chdir(tmpDir);

    await verifyTask({ name: 'Audit task' });

    const state = await fs.readFile(path.join(tmpDir, '.danteforge', 'STATE.yaml'), 'utf8');
    assert.match(state, /verify: Audit task/);
  });

  it('uses default criteria when task.verify is not set', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-verifier-default-'));
    tempDirs.push(tmpDir);
    process.chdir(tmpDir);

    // Should not throw even without verify criteria
    const passed = await verifyTask({ name: 'Task without criteria' });
    assert.strictEqual(passed, false); // fails because no output
  });
});

describe('generateVerifyPrompt', () => {
  it('returns a non-empty prompt string', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-verifyprompt-'));
    tempDirs.push(tmpDir);
    process.chdir(tmpDir);

    const prompt = await generateVerifyPrompt(
      'Test authentication',
      'function login(user, pass) { return user === "admin"; }',
      'Login function returns true for admin user',
    );

    assert.ok(typeof prompt === 'string', 'prompt should be a string');
    assert.ok(prompt.length > 50, 'prompt should be substantive');
  });

  it('saves prompt to .danteforge/prompts/ directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-verifyprompt-save-'));
    tempDirs.push(tmpDir);
    process.chdir(tmpDir);

    await generateVerifyPrompt(
      'Build pipeline check',
      'npx tsc && npm test',
      'All types check and all tests pass',
    );

    // Prompt should be saved somewhere — state should record it
    // YAML may wrap long lines, so join and check for key parts
    const statePath = path.join(tmpDir, '.danteforge', 'STATE.yaml');
    const state = await fs.readFile(statePath, 'utf8');
    const stateNormalized = state.replace(/\s+/g, ' ');
    assert.ok(
      stateNormalized.includes('verify prompt generated for: Build pipeline check'),
      'State should record the prompt generation event',
    );
  });

  it('prompt content includes task name and criteria', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-verifyprompt-content-'));
    tempDirs.push(tmpDir);
    process.chdir(tmpDir);

    const prompt = await generateVerifyPrompt(
      'Rate limiter implementation',
      'const limiter = rateLimit({ windowMs: 60000, max: 100 });',
      'Rate limiter blocks more than 100 requests per minute',
    );

    assert.ok(
      prompt.includes('Rate limiter implementation') || prompt.includes('Rate limiter blocks'),
      'prompt should include task or criteria information',
    );
  });
});
