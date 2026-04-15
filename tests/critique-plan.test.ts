import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCritiquePlan, type CritiquePlanOptions } from '../src/cli/commands/critique-plan.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const noLLM: Pick<CritiquePlanOptions, '_isLLMAvailable'> = {
  _isLLMAvailable: async () => false,
};

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'critique-plan-cmd-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    process.exitCode = undefined;
  }
}

const cleanPlan = `# Sprint 1: Add Error Handling

## Target Dimensions
- error-handling: 4.5 → 7.0

## Waves

### Wave 1: Adopt patterns from harvest queue
- **Actions**: danteforge harvest-forge --auto --max-cycles 3
- **Acceptance criteria**: error-handling ≥ 6.0

## Verification Gate
- error-handling ≥ 6.0
`;

const blockingPlan = `# Sprint 1: Add Error Handling

## Goal
Use callLLM(prompt) to build things.
Store files at ~/my-data/results.json.
`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runCritiquePlan', () => {
  it('T1: returns approved=true for a clean plan with no blocking patterns', async () => {
    await withTmpDir(async (dir) => {
      const planPath = path.join(dir, 'PLAN.md');
      await fs.writeFile(planPath, cleanPlan, 'utf8');

      const result = await runCritiquePlan({
        cwd: dir,
        ...noLLM,
        sourceFiles: [],
      });

      assert.equal(result.approved, true, 'clean plan should be approved');
      assert.equal(result.blockingCount, 0);
    });
  });

  it('T2: returns approved=false and sets blockingCount when plan has blocking patterns', async () => {
    await withTmpDir(async (dir) => {
      const planPath = path.join(dir, 'PLAN.md');
      await fs.writeFile(planPath, blockingPlan, 'utf8');

      const result = await runCritiquePlan({
        cwd: dir,
        ...noLLM,
        sourceFiles: [],
        failOnBlocking: false, // don't set exitCode in tests
      });

      assert.equal(result.approved, false);
      assert.ok(result.blockingCount > 0, 'should have at least one blocking gap');
    });
  });

  it('T3: reads plan from explicit planFile path', async () => {
    await withTmpDir(async (dir) => {
      const customPath = path.join(dir, 'my-sprint.md');
      await fs.writeFile(customPath, cleanPlan, 'utf8');

      const result = await runCritiquePlan({
        cwd: dir,
        planFile: 'my-sprint.md',
        ...noLLM,
        sourceFiles: [],
      });

      assert.equal(result.planFile, customPath);
      assert.equal(result.approved, true);
    });
  });

  it('T4: returns approved=false with 1 blocking gap when plan file is missing', async () => {
    await withTmpDir(async (dir) => {
      const result = await runCritiquePlan({
        cwd: dir,
        planFile: 'does-not-exist.md',
        ...noLLM,
        sourceFiles: [],
      });

      assert.equal(result.approved, false);
      assert.equal(result.blockingCount, 1, 'missing file counts as one blocking gap');
    });
  });

  it('T5: _readFile injection is used instead of real fs.readFile', async () => {
    let readCallCount = 0;
    const result = await runCritiquePlan({
      cwd: '/fake',
      planFile: 'PLAN.md',
      ...noLLM,
      sourceFiles: [],
      _readFile: async (p: string) => {
        readCallCount++;
        if (p.includes('PLAN.md')) return cleanPlan;
        throw new Error('ENOENT');
      },
    });

    assert.ok(readCallCount > 0, '_readFile should have been called');
    assert.equal(result.approved, true);
  });

  it('T6: deterministicOnly=true disables LLM even when _isLLMAvailable returns true', async () => {
    let llmCalled = false;
    await withTmpDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'PLAN.md'), cleanPlan, 'utf8');

      await runCritiquePlan({
        cwd: dir,
        deterministicOnly: true,
        sourceFiles: [],
        _isLLMAvailable: async () => true,
        _llmCaller: async () => { llmCalled = true; return '[]'; },
      });

      assert.equal(llmCalled, false, 'LLM should not be called in deterministicOnly mode');
    });
  });

  it('T7: gapCount includes both blocking and high severity gaps', async () => {
    await withTmpDir(async (dir) => {
      // Plan with both blocking (~/) and a high-severity pattern (direct callLLM)
      const mixedPlan = `# Plan\n\nStore at '~/lib/data.json'. Also callLLM(prompt) directly.\n`;
      await fs.writeFile(path.join(dir, 'PLAN.md'), mixedPlan, 'utf8');

      const result = await runCritiquePlan({
        cwd: dir,
        ...noLLM,
        sourceFiles: [],
        failOnBlocking: false,
      });

      assert.ok(result.gapCount >= 2, `expected ≥2 total gaps, got ${result.gapCount}`);
      assert.ok(result.blockingCount >= 1, 'should have at least one blocking gap for ~/');
    });
  });

  it('T8: LLM gaps merged into result when LLM is available', async () => {
    await withTmpDir(async (dir) => {
      await fs.writeFile(path.join(dir, 'PLAN.md'), cleanPlan, 'utf8');

      const llmGap = JSON.stringify([{
        category: 'schema',
        severity: 'high',
        description: 'Missing version field on new JSON file',
        specificFix: "Add version: '1.0.0'",
      }]);

      const result = await runCritiquePlan({
        cwd: dir,
        sourceFiles: [],
        _isLLMAvailable: async () => true,
        _llmCaller: async (p: string) => {
          // Return empty for pre-mortem, gap for critique
          if (p.includes('most likely')) return '[]';
          return llmGap;
        },
      });

      assert.ok(result.gapCount >= 1, 'LLM gap should be included in total count');
    });
  });
});
