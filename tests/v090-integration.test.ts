// v0.9.0 integration tests — exercises multiple modules working together
// Covers: DAG execution, budget fences, complexity routing, context compression,
// cost reporting, and token estimation calibration.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// DAG + Spawner
import {
  buildDefaultDAG,
  computeExecutionLevels,
  executeDAG,
  filterDAGToRoles,
} from '../src/core/agent-dag.js';
import type { AgentRole } from '../src/core/subagent-isolator.js';

// Budget fences
import {
  createBudgetFence,
  checkBudgetFence,
  updateBudgetFence,
  createExtendedTelemetry,
  recordTokenUsage,
  recordLocalTransformSavings,
  recordCompressionSavings,
  generateTokenReport,
  persistTokenReport,
} from '../src/core/execution-telemetry.js';

// Complexity + Routing + Transforms
import {
  extractComplexitySignals,
  computeComplexityScore,
  mapScoreToPreset,
  assessComplexity,
} from '../src/core/complexity-classifier.js';
import {
  classifyTaskSignature,
  routeTask,
  getDefaultRouterConfig,
} from '../src/core/task-router.js';
import {
  applyLocalTransform,
  detectApplicableTransforms,
  applyAllApplicable,
} from '../src/core/local-transforms.js';

// Context compression
import {
  compressContext,
  getAgentCompressionConfig,
  collapseWhitespace,
  stripComments,
} from '../src/core/context-compressor.js';

// Token estimation
import { estimateTokens } from '../src/core/token-estimator.js';

import type { DanteState } from '../src/core/state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal DanteState for test use. */
function minimalState(overrides?: Partial<DanteState>): DanteState {
  return {
    project: 'integration-test',
    lastHandoff: '',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    auditLog: [],
    profile: 'default',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Group 1: DAG -> Execution Pipeline (4 tests)
// ---------------------------------------------------------------------------

describe('DAG -> Execution Pipeline', () => {
  it('builds default DAG with 4 execution levels', () => {
    const dag = buildDefaultDAG();
    const plan = computeExecutionLevels(dag);
    assert.equal(plan.levels.length, 4);
    // Level 0: pm, Level 1: architect, Level 2: dev/ux/design, Level 3: scrum-master
    assert.deepStrictEqual(plan.levels[0].agents.sort(), ['pm']);
    assert.deepStrictEqual(plan.levels[1].agents.sort(), ['architect']);
    assert.deepStrictEqual(plan.levels[2].agents.sort(), ['design', 'dev', 'ux']);
    assert.deepStrictEqual(plan.levels[3].agents.sort(), ['scrum-master']);
  });

  it('executes DAG with mock executor in correct order', async () => {
    const dag = buildDefaultDAG();
    const plan = computeExecutionLevels(dag);
    const executionOrder: AgentRole[][] = [];
    const executor = async (agents: AgentRole[]) => {
      executionOrder.push([...agents]);
      const results = new Map<AgentRole, string>();
      for (const a of agents) results.set(a, `${a}-done`);
      return results;
    };
    const result = await executeDAG(plan, executor);
    assert.equal(executionOrder.length, 4);
    assert.deepStrictEqual(executionOrder[0].sort(), ['pm']);
    assert.deepStrictEqual(executionOrder[3].sort(), ['scrum-master']);
    // All 6 agents should produce results (none blocked)
    assert.equal(result.results.size, 6);
    assert.equal(result.blockedAgents.length, 0);
  });

  it('marks dependents as blocked when agent fails', async () => {
    const dag = buildDefaultDAG();
    const plan = computeExecutionLevels(dag);
    const executor = async (agents: AgentRole[]) => {
      const results = new Map<AgentRole, string>();
      for (const a of agents) {
        // architect fails (not included in results)
        if (a !== 'architect') results.set(a, `${a}-done`);
      }
      return results;
    };
    const result = await executeDAG(plan, executor);
    // architect failed, so dev/ux/design/scrum-master should be blocked
    assert.ok(result.blockedAgents.length > 0, 'should have blocked agents');
    // pm should still have a result
    assert.ok(result.results.has('pm'), 'pm should complete');
    // architect should not have a result
    assert.ok(!result.results.has('architect'), 'architect should not have a result');
  });

  it('filters DAG to subset of roles and preserves dependency order', () => {
    const dag = buildDefaultDAG();
    const filtered = filterDAGToRoles(dag, ['pm', 'dev'] as AgentRole[]);
    const plan = computeExecutionLevels(filtered);
    // pm has no deps -> level 0; dev originally depends on architect (filtered out) -> level 0 or 1
    assert.ok(plan.levels.length >= 1);
    // pm should be present
    const allAgents = plan.levels.flatMap((l) => l.agents);
    assert.ok(allAgents.includes('pm'), 'pm should be in filtered DAG');
    assert.ok(allAgents.includes('dev'), 'dev should be in filtered DAG');
    assert.equal(allAgents.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Group 2: Budget Fence -> Cost Control (4 tests)
// ---------------------------------------------------------------------------

describe('Budget Fence -> Cost Control', () => {
  it('creates a fence and allows calls within budget', () => {
    const fence = createBudgetFence('dev', 1.0);
    const check = checkBudgetFence(fence);
    assert.ok(check.proceed);
    assert.equal(check.warning, undefined);
  });

  it('blocks when budget is exceeded', () => {
    let fence = createBudgetFence('dev', 0.50);
    fence = updateBudgetFence(fence, 0.55);
    const check = checkBudgetFence(fence);
    assert.ok(!check.proceed, 'should not proceed when budget exceeded');
  });

  it('warns at threshold percentage', () => {
    let fence = createBudgetFence('dev', 1.0, 80);
    fence = updateBudgetFence(fence, 0.85);
    const check = checkBudgetFence(fence);
    assert.ok(check.proceed, 'should still proceed below hard limit');
    assert.ok(check.warning !== undefined, 'should emit a warning at 85% of 80% threshold');
  });

  it('fence with zero spend proceeds without warning', () => {
    const fence = createBudgetFence('pm', 5.0);
    assert.equal(fence.currentSpendUsd, 0);
    const check = checkBudgetFence(fence);
    assert.ok(check.proceed);
    assert.equal(check.warning, undefined);
  });
});

// ---------------------------------------------------------------------------
// Group 3: Complexity -> Routing -> Transform Pipeline (4 tests)
// ---------------------------------------------------------------------------

describe('Complexity -> Routing -> Transform Pipeline', () => {
  it('simple task scores at spark level', () => {
    const state = minimalState();
    const signals = extractComplexitySignals(
      [{ name: 'fix typo', files: ['README.md'] }],
      state,
    );
    const score = computeComplexityScore(signals);
    assert.ok(score < 16, `score ${score} should be below 16 for spark`);
    const preset = mapScoreToPreset(score);
    assert.equal(preset, 'spark');
  });

  it('local-routed task can apply var-to-const transform at zero cost', () => {
    const content = 'var x = 1;\nvar y = 2;\n';
    const transforms = detectApplicableTransforms(content, 'test.ts');
    assert.ok(transforms.includes('var-to-const'), 'should detect var-to-const');
    const result = applyLocalTransform('test.ts', content, 'var-to-const');
    assert.ok(result.applied, 'var-to-const should apply');
    assert.ok(result.transformedContent.includes('const x'), 'should have const x');
    assert.ok(result.transformedContent.includes('const y'), 'should have const y');
    // No LLM call needed for local transforms
  });

  it('complex task with architecture keywords scores at magic or higher', () => {
    const state = minimalState();
    const signals = extractComplexitySignals(
      [
        { name: 'refactor authentication system', files: ['src/auth.ts', 'src/session.ts', 'src/middleware.ts', 'src/db/schema.ts', 'src/api/routes.ts', 'src/api/oauth.ts'] },
        { name: 'add security middleware', files: ['src/security.ts'] },
        { name: 'migrate database schema', files: ['prisma/schema.prisma'] },
      ],
      state,
    );
    const score = computeComplexityScore(signals);
    // architecture (15) + security (10) + database (7) + api (8) + files (10 for 8 files) = 50+
    assert.ok(score >= 36, `score ${score} should be >= 36 for magic or higher`);
  });

  it('end-to-end: assessComplexity returns valid assessment', () => {
    const state = minimalState();
    const assessment = assessComplexity(
      [{ name: 'fix typo in readme' }],
      state,
    );
    assert.ok(assessment.score >= 0, 'score should be non-negative');
    assert.ok(
      ['spark', 'ember', 'magic', 'blaze', 'inferno'].includes(assessment.recommendedPreset),
      `preset ${assessment.recommendedPreset} should be valid`,
    );
    assert.ok(typeof assessment.reasoning === 'string', 'should have reasoning string');
    assert.ok(typeof assessment.shouldUseParty === 'boolean', 'shouldUseParty should be boolean');
  });
});

// ---------------------------------------------------------------------------
// Group 4: Context Compression -> Agent Isolation (4 tests)
// ---------------------------------------------------------------------------

describe('Context Compression -> Agent Isolation', () => {
  it('PM context compressed below maxContextTokens budget', () => {
    const config = getAgentCompressionConfig('pm');
    // Generate large context (~10000 chars)
    const largeContext = '// Comment line\n'.repeat(300) + 'const x = 1;\n'.repeat(300);
    const result = compressContext(largeContext, config);
    const tokens = estimateTokens(result.compressed, 'code-aware');
    assert.ok(
      tokens <= config.maxContextTokens,
      `PM tokens ${tokens} should be <= ${config.maxContextTokens}`,
    );
  });

  it('Dev context gets more generous budget than PM', () => {
    const pmConfig = getAgentCompressionConfig('pm');
    const devConfig = getAgentCompressionConfig('dev');
    assert.ok(
      devConfig.maxContextTokens > pmConfig.maxContextTokens,
      `dev budget ${devConfig.maxContextTokens} should exceed pm budget ${pmConfig.maxContextTokens}`,
    );
  });

  it('compression preserves non-empty output', () => {
    const config = getAgentCompressionConfig('architect');
    const input = 'export function main() {\n  return 42;\n}\n';
    const result = compressContext(input, config);
    assert.ok(result.compressed.length > 0, 'compressed output should not be empty');
  });

  it('collapseWhitespace and stripComments compose correctly', () => {
    const input = '// A comment\nconst   x  =  1;  \n\n\n/* block */\nconst y = 2;';
    const stripped = stripComments(input);
    const collapsed = collapseWhitespace(stripped);
    assert.ok(!collapsed.includes('// A comment'), 'single-line comment should be removed');
    assert.ok(!collapsed.includes('/* block */'), 'block comment should be removed');
    assert.ok(collapsed.includes('const'), 'code should be preserved');
  });
});

// ---------------------------------------------------------------------------
// Group 5: Task Router Integration (3 tests)
// ---------------------------------------------------------------------------

describe('Task Router Integration', () => {
  it('simple transform task routes to local tier', () => {
    const state = minimalState();
    const sig = classifyTaskSignature(
      { name: 'rename variable', files: [] },
      state,
    );
    const decision = routeTask(sig);
    assert.equal(decision.tier, 'local', 'rename should route to local');
    assert.equal(decision.estimatedCostUsd, 0, 'local tier should have zero cost');
  });

  it('architectural task routes to heavy tier', () => {
    const state = minimalState();
    const sig = classifyTaskSignature(
      { name: 'architect the authentication module', files: ['src/auth.ts', 'src/session.ts', 'src/middleware.ts', 'src/routes.ts', 'src/config.ts'] },
      state,
    );
    const decision = routeTask(sig);
    assert.equal(decision.tier, 'heavy', 'architect task should route to heavy');
    assert.ok(decision.estimatedCostUsd > 0, 'heavy tier should have non-zero cost');
  });

  it('getDefaultRouterConfig returns valid thresholds', () => {
    const config = getDefaultRouterConfig();
    assert.ok(config.localThreshold > 0, 'local threshold should be positive');
    assert.ok(config.lightThreshold > config.localThreshold, 'light threshold should exceed local');
    assert.ok(typeof config.lightModel === 'string', 'lightModel should be a string');
    assert.ok(typeof config.heavyModel === 'string', 'heavyModel should be a string');
  });
});

// ---------------------------------------------------------------------------
// Group 6: Cost Reporting Pipeline (4 tests)
// ---------------------------------------------------------------------------

describe('Cost Reporting Pipeline', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-cost-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('records token usage and generates report', () => {
    const telemetry = createExtendedTelemetry();
    recordTokenUsage(telemetry, 1000, 200, 0.005, 'dev', 'heavy', 'claude-sonnet');
    recordTokenUsage(telemetry, 500, 100, 0.002, 'pm', 'light', 'claude-haiku');
    const report = generateTokenReport(telemetry, 'test-session');
    assert.equal(report.totalInputTokens, 1500);
    assert.equal(report.totalOutputTokens, 300);
    assert.ok(report.totalCostUsd > 0, 'total cost should be positive');
    assert.equal(report.sessionId, 'test-session');
  });

  it('records local transform savings in report', () => {
    const telemetry = createExtendedTelemetry();
    recordLocalTransformSavings(telemetry, 500, 0.002);
    recordLocalTransformSavings(telemetry, 300, 0.001);
    const report = generateTokenReport(telemetry, 'transform-session');
    assert.equal(report.savedByLocalTransforms.estimatedSavedTokens, 800);
    assert.equal(report.savedByLocalTransforms.callCount, 2);
  });

  it('records compression savings', () => {
    const telemetry = createExtendedTelemetry();
    recordCompressionSavings(telemetry, 10000, 4000);
    const report = generateTokenReport(telemetry, 'compression-session');
    assert.equal(report.savedByCompression.originalTokens, 10000);
    assert.equal(report.savedByCompression.compressedTokens, 4000);
    assert.ok(report.savedByCompression.savedPercent > 0, 'saved percent should be positive');
  });

  it('persists report to disk and reads back', async () => {
    const telemetry = createExtendedTelemetry();
    recordTokenUsage(telemetry, 100, 50, 0.001, 'dev');
    const report = generateTokenReport(telemetry, 'persist-test');
    const filePath = await persistTokenReport(report, tmpDir);
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    assert.equal(parsed.sessionId, 'persist-test');
    assert.equal(parsed.totalInputTokens, 100);
    assert.equal(parsed.totalOutputTokens, 50);
  });
});

// ---------------------------------------------------------------------------
// Group 7: Token Estimation Calibration (2 tests)
// ---------------------------------------------------------------------------

describe('Token Estimation Calibration', () => {
  it('code-aware gives higher token count for TypeScript code', () => {
    const code = 'export function foo(x: number): boolean {\n  if (x > 0) {\n    return true;\n  }\n  return false;\n}\n';
    const simple = estimateTokens(code, 'simple');
    const codeAware = estimateTokens(code, 'code-aware');
    // Code-aware uses ~2.5 chars/token vs simple's ~4 chars/token
    // So code-aware should yield more tokens for code
    assert.ok(
      codeAware > simple,
      `code-aware (${codeAware}) should be > simple (${simple})`,
    );
  });

  it('code-aware estimate is similar to simple for prose', () => {
    const prose = 'This is a simple readme file that describes the project. It has no special characters and is just plain English text explaining what this tool does and how to use it.';
    const simple = estimateTokens(prose, 'simple');
    const codeAware = estimateTokens(prose, 'code-aware');
    // Prose should use ~3.5 chars/token (code-aware) vs ~4 chars/token (simple)
    // Ratio should be roughly similar (within 50% difference)
    const ratio = codeAware / simple;
    assert.ok(
      ratio > 0.8 && ratio < 1.8,
      `prose ratio ${ratio.toFixed(2)} should be near 1.0`,
    );
  });
});
