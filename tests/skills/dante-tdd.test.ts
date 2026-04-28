import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { runSkill } from '../../src/spine/skill_runner/runner.js';
import { danteTddExecutor } from '../../src/spine/skill_runner/executors/dante-tdd-executor.js';

let workspace: string;

before(() => {
  workspace = mkdtempSync(resolve(tmpdir(), 'dante-tdd-eval-'));
  mkdirSync(resolve(workspace, '.danteforge'), { recursive: true });
  mkdirSync(resolve(workspace, 'src'), { recursive: true });
  writeFileSync(resolve(workspace, 'src/small.ts'), 'export const x = 1;\n');
});

test('/dante-tdd: green path — all 6 steps present and verified passes the gate', async () => {
  const result = await runSkill(danteTddExecutor, {
    skillName: 'dante-tdd',
    repo: workspace,
    inputs: {
      taskDescription: 'add x',
      cycle: {
        step1_test_authored: { testFile: 'tests/x.test.ts', testName: 'x is 1', assertionMessage: 'x must be 1' },
        step2_red_verified: { failingMessage: 'expected 1 received undefined', failureReason: 'real' },
        step3_implementation: { files: ['src/small.ts'] },
        step4_green_verified: { suitePassed: true, testNameMatchedBehavior: true },
        step5_refactor: { extractions: [], noRefactor: true },
        step6_refactor_verified: { suitePassedAfterRefactor: true }
      },
      repo: workspace
    },
    runId: 'run_20260428_920',
    frontmatter: {
      name: 'dante-tdd',
      description: 'eval',
      requiredDimensions: ['testing', 'errorHandling', 'maintainability']
    },
    scorer: () => ({ testing: 9.5, errorHandling: 9.2, maintainability: 9.1 })
  });
  const o = result.output as { cycleComplete: boolean; blockingIssues: string[] };
  assert.equal(o.cycleComplete, true);
  assert.equal(o.blockingIssues.length, 0);
  assert.equal(result.gate.overall, 'green');
});

test('/dante-tdd: false-red detection — failureReason syntax blocks', async () => {
  const result = await runSkill(danteTddExecutor, {
    skillName: 'dante-tdd',
    repo: workspace,
    inputs: {
      cycle: {
        step1_test_authored: { testFile: 'tests/x.test.ts', testName: 'x is 1' },
        step2_red_verified: { failingMessage: 'SyntaxError: Unexpected token', failureReason: 'syntax' },
        step3_implementation: { files: ['src/small.ts'] },
        step4_green_verified: { suitePassed: true, testNameMatchedBehavior: true },
        step5_refactor: { noRefactor: true },
        step6_refactor_verified: { suitePassedAfterRefactor: true }
      }
    },
    runId: 'run_20260428_921',
    frontmatter: {
      name: 'dante-tdd',
      description: 'eval',
      requiredDimensions: ['testing']
    },
    scorer: () => ({ testing: 9.5 })
  });
  const o = result.output as { cycleComplete: boolean; blockingIssues: string[] };
  assert.equal(o.cycleComplete, false);
  assert.ok(o.blockingIssues.some(b => /wrong reason/.test(b)));
});

test('/dante-tdd: missing step6_refactor_verified blocks', async () => {
  const result = await runSkill(danteTddExecutor, {
    skillName: 'dante-tdd',
    repo: workspace,
    inputs: {
      cycle: {
        step1_test_authored: { testFile: 't.test.ts', testName: 't' },
        step2_red_verified: { failingMessage: 'fail', failureReason: 'real' },
        step3_implementation: { files: [] },
        step4_green_verified: { suitePassed: true, testNameMatchedBehavior: true },
        step5_refactor: { noRefactor: true }
        // step6 missing
      }
    },
    runId: 'run_20260428_922',
    frontmatter: {
      name: 'dante-tdd',
      description: 'eval',
      requiredDimensions: ['testing']
    },
    scorer: () => ({ testing: 9.5 })
  });
  const o = result.output as { cycleComplete: boolean; blockingIssues: string[] };
  assert.equal(o.cycleComplete, false);
  assert.ok(o.blockingIssues.some(b => /step6/.test(b)));
});

test('/dante-tdd: KiloCode discipline blocks oversized file', async () => {
  // Create a >500-LOC file
  const huge = 'export const a = 1;\n'.repeat(550);
  writeFileSync(resolve(workspace, 'src/huge.ts'), huge);

  const result = await runSkill(danteTddExecutor, {
    skillName: 'dante-tdd',
    repo: workspace,
    inputs: {
      cycle: {
        step1_test_authored: { testFile: 't.test.ts', testName: 't' },
        step2_red_verified: { failingMessage: 'fail', failureReason: 'real' },
        step3_implementation: { files: ['src/huge.ts'] },
        step4_green_verified: { suitePassed: true, testNameMatchedBehavior: true },
        step5_refactor: { noRefactor: true },
        step6_refactor_verified: { suitePassedAfterRefactor: true }
      },
      repo: workspace
    },
    runId: 'run_20260428_923',
    frontmatter: {
      name: 'dante-tdd',
      description: 'eval',
      requiredDimensions: ['testing', 'maintainability']
    },
    scorer: () => ({ testing: 9.5, maintainability: 9.0 })
  });
  const o = result.output as { cycleComplete: boolean; oversizedFiles: { file: string; loc: number }[] };
  assert.equal(o.cycleComplete, false);
  assert.ok(o.oversizedFiles.length >= 1);
  assert.match(o.oversizedFiles[0]!.file, /huge\.ts/);
});
