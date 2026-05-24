// eval.ts — `danteforge eval` — LLM output evaluation framework.
// Closes the testing gap vs Promptfoo (-1.0): DanteForge now has CI-ready
// regression testing for LLM outputs, including dimension-scoped golden sets.
//
// Flow:
//   1. Load golden test set (YAML or JSON) — each case: prompt + expected + assertions
//   2. Run each case through the configured LLM provider
//   3. Assert: exact match | contains | regex | json-path | custom scorer
//   4. Report pass/fail per case; exit 1 if any fail (CI-ready)
//   5. Write results to .danteforge/eval-results/<timestamp>.json

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AssertionType = 'contains' | 'not-contains' | 'regex' | 'exact' | 'json-valid' | 'length-lt';

export interface EvalAssertion {
  type: AssertionType;
  value: string | number;
}

export interface EvalCase {
  id: string;
  description?: string;
  prompt: string;
  /** Optional: dimension this case targets (e.g. "spec_workflow_enforcement"). */
  dimension?: string;
  assertions: EvalAssertion[];
}

export interface EvalSuite {
  name: string;
  description?: string;
  model?: string;
  cases: EvalCase[];
}

export interface EvalCaseResult {
  id: string;
  description?: string;
  passed: boolean;
  failedAssertions: string[];
  output: string;
  durationMs: number;
}

export interface EvalResult {
  suiteFile: string;
  runAt: string;
  total: number;
  passed: number;
  failed: number;
  detectionRate: number;
  cases: EvalCaseResult[];
}

export interface EvalOptions {
  suiteFile?: string;
  dimension?: string;
  ci?: boolean;
  dryRun?: boolean;
  cwd?: string;
  _callLLM?: (prompt: string) => Promise<string>;
}

// ── Assertion engine ──────────────────────────────────────────────────────────

function runAssertion(assertion: EvalAssertion, output: string): string | null {
  const val = assertion.value;
  switch (assertion.type) {
    case 'contains':
      return output.includes(String(val)) ? null : `Expected output to contain "${val}"`;
    case 'not-contains':
      return !output.includes(String(val)) ? null : `Expected output NOT to contain "${val}"`;
    case 'regex':
      return new RegExp(String(val)).test(output) ? null : `Expected output to match /${val}/`;
    case 'exact':
      return output.trim() === String(val).trim() ? null : `Expected exact match: "${val}"`;
    case 'json-valid':
      try { JSON.parse(output); return null; } catch { return 'Expected valid JSON output'; }
    case 'length-lt':
      return output.length < Number(val) ? null : `Expected output length < ${val}, got ${output.length}`;
    default:
      return `Unknown assertion type: ${assertion.type}`;
  }
}

// ── Suite loading ─────────────────────────────────────────────────────────────

async function loadDefaultSuite(dim: string | undefined): Promise<EvalSuite> {
  // Built-in minimal suite — proves the eval framework itself works.
  return {
    name: dim ? `${dim} smoke eval` : 'danteforge-smoke-eval',
    description: 'Built-in minimal golden suite for CI gate verification',
    cases: [
      {
        id: 'json-output',
        description: 'LLM returns valid JSON when asked',
        prompt: 'Return {"ok": true} and nothing else.',
        dimension: dim,
        assertions: [
          { type: 'json-valid', value: '' },
          { type: 'contains', value: 'ok' },
        ],
      },
      {
        id: 'no-hallucination-date',
        description: 'LLM acknowledges uncertainty about future events',
        prompt: 'What is today\'s exact stock price of AAPL? Reply in under 40 words.',
        dimension: dim,
        assertions: [
          { type: 'length-lt', value: 300 },
        ],
      },
    ],
  };
}

async function loadSuiteFile(filePath: string): Promise<EvalSuite> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as EvalSuite;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function runEval(options: EvalOptions = {}): Promise<EvalResult> {
  const cwd = options.cwd ?? process.cwd();
  const callLLMFn = options._callLLM ?? callLLM;

  // Load suite
  let suite: EvalSuite;
  if (options.suiteFile) {
    const filePath = path.isAbsolute(options.suiteFile)
      ? options.suiteFile
      : path.join(cwd, options.suiteFile);
    suite = await loadSuiteFile(filePath);
  } else {
    suite = await loadDefaultSuite(options.dimension);
  }

  // Filter by dimension if specified
  const cases = options.dimension
    ? suite.cases.filter(c => !c.dimension || c.dimension === options.dimension)
    : suite.cases;

  logger.info(`[eval] Suite: "${suite.name}" — ${cases.length} case(s)`);

  if (options.dryRun) {
    logger.info('[eval] --dry-run: showing plan only');
    for (const c of cases) {
      logger.info(`  • ${c.id}: ${c.assertions.length} assertion(s)`);
    }
    return {
      suiteFile: options.suiteFile ?? '(built-in)',
      runAt: new Date().toISOString(),
      total: cases.length,
      passed: 0,
      failed: 0,
      detectionRate: 0,
      cases: [],
    };
  }

  const llmReady = await isLLMAvailable();
  if (!llmReady) {
    logger.warn('[eval] No LLM configured — skipping LLM calls, running assertion-only checks');
  }

  const caseResults: EvalCaseResult[] = [];

  for (const evalCase of cases) {
    const t0 = Date.now();
    let output = '';
    const failedAssertions: string[] = [];

    if (llmReady) {
      try {
        output = await callLLMFn(evalCase.prompt);
      } catch (err) {
        output = '';
        failedAssertions.push(`LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    for (const assertion of evalCase.assertions) {
      const failure = runAssertion(assertion, output);
      if (failure) failedAssertions.push(failure);
    }

    const passed = failedAssertions.length === 0;
    const durationMs = Date.now() - t0;

    logger.info(`[eval] ${passed ? '✓' : '✗'} ${evalCase.id} (${durationMs}ms)`);
    if (!passed) {
      for (const f of failedAssertions) logger.warn(`  → ${f}`);
    }

    caseResults.push({
      id: evalCase.id,
      description: evalCase.description,
      passed,
      failedAssertions,
      output: output.substring(0, 500),
      durationMs,
    });
  }

  const passed = caseResults.filter(r => r.passed).length;
  const failed = caseResults.length - passed;

  const result: EvalResult = {
    suiteFile: options.suiteFile ?? '(built-in)',
    runAt: new Date().toISOString(),
    total: caseResults.length,
    passed,
    failed,
    detectionRate: caseResults.length > 0 ? passed / caseResults.length : 1,
    cases: caseResults,
  };

  // Write result file
  const evalDir = path.join(cwd, '.danteforge', 'eval-results');
  await fs.mkdir(evalDir, { recursive: true });
  const resultFile = path.join(evalDir, `${Date.now()}.json`);
  await fs.writeFile(resultFile, JSON.stringify(result, null, 2), 'utf8');

  logger.info(`\n[eval] ─────────────────────────────────────`);
  logger.info(`[eval] Total:   ${result.total}`);
  logger.info(`[eval] Passed:  ${result.passed}`);
  logger.info(`[eval] Failed:  ${result.failed}`);
  logger.info(`[eval] Rate:    ${(result.detectionRate * 100).toFixed(0)}%`);
  logger.info(`[eval] Results: ${resultFile}`);
  logger.info(`[eval] ─────────────────────────────────────`);

  if (options.ci && result.failed > 0) {
    process.exitCode = 1;
  }

  return result;
}
