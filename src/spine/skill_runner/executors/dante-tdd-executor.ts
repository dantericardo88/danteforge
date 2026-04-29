/**
 * /dante-tdd executor — 6-step verify-cycle (red+verify, green+verify, refactor+verify).
 *
 * Deterministic mode validates that a candidate cycle has the required artifacts:
 *   step1_test_authored, step2_red_verified, step3_implementation,
 *   step4_green_verified, step5_refactor, step6_refactor_verified.
 *
 * It does NOT execute the test runner itself — the runner is the agent that
 * invokes /dante-tdd. The executor's job is to attest the cycle's evidence
 * shape and surface gate failures (oversized files, missing verify steps, etc.).
 */

import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SkillExecutor } from '../runner.js';

export interface TddInputs {
  taskDescription: string;
  cycle: {
    step1_test_authored?: { testFile: string; testName: string; assertionMessage?: string };
    step2_red_verified?: { failingMessage: string; failureReason: 'real' | 'syntax' | 'unrelated' };
    step3_implementation?: { files: string[] };
    step4_green_verified?: { suitePassed: boolean; testNameMatchedBehavior: boolean };
    step5_refactor?: { extractions: string[]; noRefactor?: boolean };
    step6_refactor_verified?: { suitePassedAfterRefactor: boolean };
  };
  /** Repo root for KiloCode size checks (default: cwd). */
  repo?: string;
  /** Optional LLM caller; reserved for future verification-narrative generation. Accepted for orchestration-runtime threading consistency. */
  _llmCaller?: (prompt: string) => Promise<string>;
}

interface TddOutput {
  cycleComplete: boolean;
  blockingIssues: string[];
  oversizedFiles: { file: string; loc: number }[];
  verifyStepStatus: {
    red: 'passed' | 'failed' | 'missing';
    green: 'passed' | 'failed' | 'missing';
    refactor: 'passed' | 'failed' | 'missing';
  };
}

const KILOCODE_LOC_CEILING = 500;

export const danteTddExecutor: SkillExecutor = async (raw) => {
  const inputs = parseInputs(raw);
  const blocking: string[] = [];
  const oversized: { file: string; loc: number }[] = [];

  const verifyStatus = {
    red: stepStatus(inputs.cycle.step2_red_verified, v => v.failureReason === 'real'),
    green: stepStatus(inputs.cycle.step4_green_verified, v => v.suitePassed && v.testNameMatchedBehavior),
    refactor: stepStatus(inputs.cycle.step6_refactor_verified, v => v.suitePassedAfterRefactor)
  };

  if (!inputs.cycle.step1_test_authored) blocking.push('step1_test_authored missing — no failing test was authored');
  if (verifyStatus.red === 'missing') blocking.push('step2_red_verified missing — test fails for unknown reason');
  if (verifyStatus.red === 'failed') blocking.push('step2_red_verified failed — test failed for the wrong reason (syntax / unrelated)');
  if (!inputs.cycle.step3_implementation) blocking.push('step3_implementation missing — no production code change');
  if (verifyStatus.green === 'missing') blocking.push('step4_green_verified missing');
  if (verifyStatus.green === 'failed') blocking.push('step4_green_verified failed — suite did not pass cleanly OR test name did not match behavior');
  if (verifyStatus.refactor === 'missing') blocking.push('step6_refactor_verified missing — refactor verification skipped');
  if (verifyStatus.refactor === 'failed') blocking.push('step6_refactor_verified failed — refactor changed behavior');

  // KiloCode discipline check on touched files
  if (inputs.cycle.step3_implementation?.files) {
    const repo = inputs.repo ?? process.cwd();
    for (const f of inputs.cycle.step3_implementation.files) {
      const path = resolve(repo, f);
      if (!existsSync(path)) continue;
      try {
        const loc = countLines(path);
        if (loc > KILOCODE_LOC_CEILING) {
          oversized.push({ file: f, loc });
          blocking.push(`KiloCode ceiling violated: ${f} is ${loc} LOC (>${KILOCODE_LOC_CEILING}); refactor required before commit`);
        }
      } catch { /* unreadable file — not a TDD blocker, but skip */ }
    }
  }

  const output: TddOutput = {
    cycleComplete: blocking.length === 0,
    blockingIssues: blocking,
    oversizedFiles: oversized,
    verifyStepStatus: verifyStatus
  };

  return {
    output,
    phaseArtifacts: [
      { label: 'step1_test_authored', payload: inputs.cycle.step1_test_authored ?? null },
      { label: 'step2_red_verified', payload: inputs.cycle.step2_red_verified ?? null },
      { label: 'step3_implementation', payload: inputs.cycle.step3_implementation ?? null },
      { label: 'step4_green_verified', payload: inputs.cycle.step4_green_verified ?? null },
      { label: 'step5_refactor', payload: inputs.cycle.step5_refactor ?? null },
      { label: 'step6_refactor_verified', payload: inputs.cycle.step6_refactor_verified ?? null }
    ],
    surfacedAssumptions: blocking.length === 0
      ? ['Cycle attests the diff matches the test name in plain language; founder may sample-audit any cycle.']
      : ['Cycle blocked — see output.blockingIssues; founder may override only with explicit waiver.']
  };
};

function parseInputs(raw: Record<string, unknown>): TddInputs {
  return {
    taskDescription: typeof raw.taskDescription === 'string' ? raw.taskDescription : '',
    cycle: (typeof raw.cycle === 'object' && raw.cycle !== null ? raw.cycle : {}) as TddInputs['cycle'],
    repo: typeof raw.repo === 'string' ? raw.repo : undefined,
    _llmCaller: typeof raw._llmCaller === 'function' ? (raw._llmCaller as (p: string) => Promise<string>) : undefined
  };
}

function stepStatus<T>(step: T | undefined, predicate: (v: T) => boolean): 'passed' | 'failed' | 'missing' {
  if (step === undefined) return 'missing';
  return predicate(step) ? 'passed' : 'failed';
}

function countLines(path: string): number {
  const stat = statSync(path);
  if (!stat.isFile()) return 0;
  if (stat.size < 200) return 1;
  return readFileSync(path, 'utf-8').split('\n').length;
}
