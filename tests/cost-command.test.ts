import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'path';

describe('execution-telemetry budget & cost functions', () => {
  // ── createBudgetFence ──────────────────────────────────────────────────────

  describe('createBudgetFence', () => {
    it('initializes correctly with defaults', async () => {
      const { createBudgetFence } = await import(
        '../src/core/execution-telemetry.js'
      );
      const fence = createBudgetFence('planner', 1.0);
      assert.strictEqual(fence.agentRole, 'planner');
      assert.strictEqual(fence.maxBudgetUsd, 1.0);
      assert.strictEqual(fence.currentSpendUsd, 0);
      assert.strictEqual(fence.isExceeded, false);
      assert.strictEqual(fence.warningThresholdPercent, 80);
    });

    it('respects custom warningThresholdPercent', async () => {
      const { createBudgetFence } = await import(
        '../src/core/execution-telemetry.js'
      );
      const fence = createBudgetFence('coder', 2.0, 90);
      assert.strictEqual(fence.warningThresholdPercent, 90);
    });
  });

  // ── checkBudgetFence ───────────────────────────────────────────────────────

  describe('checkBudgetFence', () => {
    it('returns proceed=true when under budget', async () => {
      const { createBudgetFence, checkBudgetFence } = await import(
        '../src/core/execution-telemetry.js'
      );
      const fence = createBudgetFence('planner', 1.0);
      const result = checkBudgetFence(fence);
      assert.strictEqual(result.proceed, true);
      assert.strictEqual(result.warning, undefined);
    });

    it('returns proceed=false when exceeded', async () => {
      const { checkBudgetFence } = await import(
        '../src/core/execution-telemetry.js'
      );
      const fence = {
        agentRole: 'coder',
        maxBudgetUsd: 1.0,
        currentSpendUsd: 1.5,
        isExceeded: true,
        warningThresholdPercent: 80,
      };
      const result = checkBudgetFence(fence);
      assert.strictEqual(result.proceed, false);
      assert.ok(result.warning, 'Should have a warning message');
      assert.ok(result.warning!.includes('exceeded'), 'Warning should mention exceeded');
    });

    it('returns warning at threshold percentage', async () => {
      const { checkBudgetFence } = await import(
        '../src/core/execution-telemetry.js'
      );
      // 85% of 1.0 = 0.85, which is >= 80% threshold
      const fence = {
        agentRole: 'reviewer',
        maxBudgetUsd: 1.0,
        currentSpendUsd: 0.85,
        isExceeded: false,
        warningThresholdPercent: 80,
      };
      const result = checkBudgetFence(fence);
      assert.strictEqual(result.proceed, true);
      assert.ok(result.warning, 'Should have a warning at threshold');
      assert.ok(result.warning!.includes('85.0%'), 'Warning should include percentage');
    });
  });

  // ── updateBudgetFence ──────────────────────────────────────────────────────

  describe('updateBudgetFence', () => {
    it('updates currentSpendUsd and isExceeded', async () => {
      const { createBudgetFence, updateBudgetFence } = await import(
        '../src/core/execution-telemetry.js'
      );
      const fence = createBudgetFence('planner', 0.50);
      const updated = updateBudgetFence(fence, 0.30);
      assert.strictEqual(updated.currentSpendUsd, 0.30);
      assert.strictEqual(updated.isExceeded, false);

      const exceeded = updateBudgetFence(updated, 0.25);
      assert.strictEqual(exceeded.currentSpendUsd, 0.55);
      assert.strictEqual(exceeded.isExceeded, true);
    });
  });

  // ── createExtendedTelemetry ────────────────────────────────────────────────

  describe('createExtendedTelemetry', () => {
    it('has correct initial values', async () => {
      const { createExtendedTelemetry } = await import(
        '../src/core/execution-telemetry.js'
      );
      const t = createExtendedTelemetry();
      assert.deepStrictEqual(t.tokenUsageRecords, []);
      assert.deepStrictEqual(t.localTransformSavings, {
        callCount: 0,
        estimatedSavedTokens: 0,
        estimatedSavedUsd: 0,
      });
      assert.deepStrictEqual(t.compressionSavings, {
        originalTokens: 0,
        compressedTokens: 0,
      });
      assert.deepStrictEqual(t.gateBlockSavings, {
        blockedCallCount: 0,
        estimatedSavedTokens: 0,
      });
      // Also inherits base telemetry fields
      assert.deepStrictEqual(t.toolCalls, []);
      assert.deepStrictEqual(t.bashCommands, []);
      assert.deepStrictEqual(t.filesModified, []);
      assert.strictEqual(t.duration, 0);
      assert.strictEqual(t.tokenEstimate, 0);
    });
  });

  // ── recordTokenUsage ───────────────────────────────────────────────────────

  describe('recordTokenUsage', () => {
    it('adds records correctly', async () => {
      const { createExtendedTelemetry, recordTokenUsage } = await import(
        '../src/core/execution-telemetry.js'
      );
      const t = createExtendedTelemetry();
      recordTokenUsage(t, 1000, 500, 0.01, 'planner', 'premium', 'claude-opus');
      recordTokenUsage(t, 2000, 800, 0.02, 'coder', 'standard', 'gpt-4');

      assert.strictEqual(t.tokenUsageRecords.length, 2);
      assert.strictEqual(t.tokenUsageRecords[0].inputTokens, 1000);
      assert.strictEqual(t.tokenUsageRecords[0].agentRole, 'planner');
      assert.strictEqual(t.tokenUsageRecords[1].model, 'gpt-4');
      // tokenEstimate is the running sum of input+output
      assert.strictEqual(t.tokenEstimate, 1000 + 500 + 2000 + 800);
    });
  });

  // ── generateTokenReport ────────────────────────────────────────────────────

  describe('generateTokenReport', () => {
    it('computes totals from records', async () => {
      const {
        createExtendedTelemetry,
        recordTokenUsage,
        generateTokenReport,
      } = await import('../src/core/execution-telemetry.js');

      const t = createExtendedTelemetry();
      recordTokenUsage(t, 1000, 500, 0.01);
      recordTokenUsage(t, 2000, 800, 0.02);

      const report = generateTokenReport(t, 'session-1');
      assert.strictEqual(report.sessionId, 'session-1');
      assert.strictEqual(report.totalInputTokens, 3000);
      assert.strictEqual(report.totalOutputTokens, 1300);
      assert.strictEqual(report.totalCostUsd, 0.03);
      assert.ok(report.timestamp, 'Report should have a timestamp');
    });

    it('computes per-agent breakdown', async () => {
      const {
        createExtendedTelemetry,
        recordTokenUsage,
        generateTokenReport,
      } = await import('../src/core/execution-telemetry.js');

      const t = createExtendedTelemetry();
      recordTokenUsage(t, 500, 200, 0.005, 'planner');
      recordTokenUsage(t, 1000, 400, 0.01, 'coder');
      recordTokenUsage(t, 300, 100, 0.003, 'planner');

      const report = generateTokenReport(t, 'session-2');

      // planner: 2 calls
      assert.strictEqual(report.byAgent['planner'].callCount, 2);
      assert.strictEqual(report.byAgent['planner'].inputTokens, 800);
      assert.strictEqual(report.byAgent['planner'].outputTokens, 300);

      // coder: 1 call
      assert.strictEqual(report.byAgent['coder'].callCount, 1);
      assert.strictEqual(report.byAgent['coder'].inputTokens, 1000);
    });
  });

  // ── persistTokenReport ─────────────────────────────────────────────────────

  describe('persistTokenReport', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-cost-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('writes JSON to .danteforge/reports/', async () => {
      const {
        createExtendedTelemetry,
        recordTokenUsage,
        generateTokenReport,
        persistTokenReport,
      } = await import('../src/core/execution-telemetry.js');

      const t = createExtendedTelemetry();
      recordTokenUsage(t, 500, 200, 0.005, 'planner');
      const report = generateTokenReport(t, 'persist-test');

      const filePath = await persistTokenReport(report, tmpDir);

      // Verify file exists and is valid JSON
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content);
      assert.strictEqual(parsed.sessionId, 'persist-test');
      assert.strictEqual(parsed.totalInputTokens, 500);
      assert.strictEqual(parsed.totalOutputTokens, 200);

      // Verify it's in the reports subdirectory
      const reportsDir = path.join(tmpDir, '.danteforge', 'reports');
      const files = await fs.readdir(reportsDir);
      assert.strictEqual(files.length, 1);
      assert.ok(files[0].startsWith('cost-'), 'Report filename should start with cost-');
      assert.ok(files[0].endsWith('.json'), 'Report filename should end with .json');
    });
  });

  // ── recordLocalTransformSavings ────────────────────────────────────────────

  describe('recordLocalTransformSavings', () => {
    it('accumulates correctly', async () => {
      const { createExtendedTelemetry, recordLocalTransformSavings } = await import(
        '../src/core/execution-telemetry.js'
      );
      const t = createExtendedTelemetry();
      recordLocalTransformSavings(t, 500, 0.005);
      recordLocalTransformSavings(t, 300, 0.003);

      assert.strictEqual(t.localTransformSavings.callCount, 2);
      assert.strictEqual(t.localTransformSavings.estimatedSavedTokens, 800);
      assert.strictEqual(t.localTransformSavings.estimatedSavedUsd, 0.008);
    });
  });
});
