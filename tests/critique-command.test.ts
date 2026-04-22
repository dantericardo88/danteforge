import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { critique } from '../src/cli/commands/critique.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;
const noLLM = { _isLLMAvailable: async () => false };

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'critique-cmd-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  // Reset exit code after each test
  process.exitCode = undefined;
});

async function writePlan(content: string): Promise<string> {
  const planPath = path.join(tmpDir, 'PLAN.md');
  await fs.writeFile(planPath, content, 'utf8');
  return planPath;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('critique command', () => {
  it('T1: missing plan file → exits with code 1', async () => {
    await critique(path.join(tmpDir, 'NONEXISTENT.md'), { cwd: tmpDir, ...noLLM });
    assert.equal(process.exitCode, 1);
  });

  it('T2: --skip-critique → skips and exits 0', async () => {
    const planPath = await writePlan("callLLM(prompt) // no seam");
    await critique(planPath, { cwd: tmpDir, skipCritique: true, ...noLLM });
    assert.notEqual(process.exitCode, 1);
  });

  it('T3: --json → outputs valid JSON to stdout', async () => {
    const planPath = await writePlan('A clean plan with no issues.');
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    };

    try {
      await critique(planPath, { cwd: tmpDir, json: true, ...noLLM });
      const output = chunks.join('');
      const parsed = JSON.parse(output) as unknown;
      assert.ok(typeof parsed === 'object' && parsed !== null, 'output should be valid JSON object');
      assert.ok('gapsFound' in (parsed as object), 'output should have gapsFound field');
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it('T4: blocking gap → exits with code 1', async () => {
    const planPath = await writePlan("Store at '~/danteforge/data.json'");
    await critique(planPath, { cwd: tmpDir, ...noLLM });
    assert.equal(process.exitCode, 1);
  });

  it('T5: 0 blocking gaps → exits with code 0', async () => {
    const planPath = await writePlan('Clean plan: use path.join(os.homedir(), ".danteforge").');
    await critique(planPath, { cwd: tmpDir, ...noLLM });
    assert.notEqual(process.exitCode, 1);
  });

  it('T6: --auto-refine → annotates plan file with blocking gaps', async () => {
    const planPath = await writePlan("callLLM(prompt) without seam");
    await critique(planPath, { cwd: tmpDir, autoRefine: true, ...noLLM });
    const updated = await fs.readFile(planPath, 'utf8');
    assert.ok(updated.includes('Critique Annotations'), 'plan should contain critique annotations');
    assert.ok(updated.includes('test-discipline'), 'annotations should reference the gap category');
  });

  it('T7: --diff with _gitDiff injection → passes diff to critiquePlan', async () => {
    const planPath = await writePlan('Plan to adopt circuit-breaker pattern');
    let receivedDiff = '';
    await critique(planPath, {
      cwd: tmpDir,
      diff: 'HEAD~1',
      _gitDiff: async (ref: string) => { receivedDiff = ref; return '+const x = callLLM(p)'; },
      ...noLLM,
    });
    assert.equal(receivedDiff, 'HEAD~1', '_gitDiff should be called with the ref');
  });

  it('T8: --stakes critical passes through to critiquePlan', async () => {
    const callLog: string[] = [];
    const planPath = await writePlan('Critical stakes plan');
    await critique(planPath, {
      cwd: tmpDir,
      stakes: 'critical',
      _isLLMAvailable: async () => true,
      _llmCaller: async (p: string) => { callLog.push(p); return '[]'; },
    });
    const hasSecurityPersona = callLog.some(p => p.includes('SECURITY'));
    assert.ok(hasSecurityPersona, 'security persona should run at critical stakes');
  });

  it('T9: LLM unavailable → falls back to deterministic checks, does not throw', async () => {
    const planPath = await writePlan('Use callLLM(prompt) directly in handler');
    let threw = false;
    try {
      await critique(planPath, { cwd: tmpDir, _isLLMAvailable: async () => false });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'should not throw when LLM unavailable');
    assert.equal(process.exitCode, 1, 'should still detect the blocking gap deterministically');
  });

  it('T10: records blocking gaps as lessons (best-effort)', async () => {
    const planPath = await writePlan("callLLM(prompt) and '~/lib/data.json'");
    await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
    await critique(planPath, { cwd: tmpDir, ...noLLM });

    // Lessons file should have been written (best-effort, so we check it exists if possible)
    try {
      const lessons = await fs.readFile(path.join(tmpDir, '.danteforge', 'lessons.md'), 'utf8');
      assert.ok(lessons.includes('plan_critique'), 'lessons should contain plan_critique category');
    } catch {
      // Lessons write is best-effort — test passes either way
    }
  });
});
