// Verifier agent tests — fail-closed verification against acceptance criteria
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { verify } from '../src/harvested/gsd/agents/verifier.js';

let originalHome: string | undefined;
const tempDirs: string[] = [];

describe('verifier agent — fail-closed paths (no LLM)', () => {
  before(async () => {
    originalHome = process.env.DANTEFORGE_HOME;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-verifier-'));
    tempDirs.push(dir);
    await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
    process.env.DANTEFORGE_HOME = dir;
  });

  beforeEach(() => { process.exitCode = 0; });

  after(async () => {
    process.exitCode = 0;
    if (originalHome !== undefined) {
      process.env.DANTEFORGE_HOME = originalHome;
    } else {
      delete process.env.DANTEFORGE_HOME;
    }
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('returns false for empty taskOutput', async () => {
    const result = await verify('', 'Returns 200');
    assert.equal(result, false);
  });

  it('returns false for whitespace-only taskOutput', async () => {
    const result = await verify('   \n\t  ', 'Returns 200');
    assert.equal(result, false);
  });

  it('returns false when no LLM is available', async () => {
    const result = await verify('Task completed: endpoint returns 200', 'Returns 200 status');
    assert.equal(result, false);
  });

  it('does NOT set process.exitCode on empty output (library isolation)', async () => {
    process.exitCode = 0;
    await verify('', 'criteria');
    assert.equal(process.exitCode, 0, 'Library code must not mutate process.exitCode');
  });

  it('does NOT set process.exitCode when no LLM available (library isolation)', async () => {
    process.exitCode = 0;
    await verify('Valid output here', 'criteria');
    assert.equal(process.exitCode, 0, 'Library code must not mutate process.exitCode');
  });
});

describe('verifier agent — _llmCaller injection', () => {
  beforeEach(() => { process.exitCode = 0; });

  after(() => { process.exitCode = 0; });

  it('returns true when LLM returns PASS verdict', async () => {
    const mockLLM = async () => 'PASS\nAll criteria met. Implementation is correct.';
    const result = await verify('Task output: endpoint returns 200', 'Returns 200', { _llmCaller: mockLLM });
    assert.equal(result, true);
  });

  it('returns false when LLM returns FAIL verdict', async () => {
    const mockLLM = async () => 'FAIL\nMissing error handling for 404 responses.';
    const result = await verify('Task output: partial implementation', 'Returns 200', { _llmCaller: mockLLM });
    assert.equal(result, false);
  });

  it('returns false when LLM throws error', async () => {
    const mockLLM = async () => { throw new Error('API timeout'); };
    const result = await verify('Task output', 'criteria', { _llmCaller: mockLLM });
    assert.equal(result, false);
  });

  it('parseVerdict uses anchored regex — PASS mid-sentence is FAIL', async () => {
    const mockLLM = async () => 'The task did not PASS the criteria.\nMissing implementation.';
    const result = await verify('Task output', 'criteria', { _llmCaller: mockLLM });
    assert.equal(result, false);
  });

  it('PASSED (with -ED suffix) is treated as PASS', async () => {
    const mockLLM = async () => 'PASSED\nAll good.';
    const result = await verify('Task output', 'criteria', { _llmCaller: mockLLM });
    assert.equal(result, true);
  });
});
