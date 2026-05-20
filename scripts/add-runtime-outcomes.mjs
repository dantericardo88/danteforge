#!/usr/bin/env node
// Add runtime quality outcomes to 6 critical dimensions.
// These replace structural file checks with real CLI execution at T5+.

import fs from 'node:fs';
import path from 'node:path';

const MATRIX_PATH = path.join(process.cwd(), '.danteforge', 'compete', 'matrix.json');
const matrix = JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8'));

const RUNTIME_OUTCOMES = {
  testing: [
    {
      id: 't_golden_flow_runtime',
      tier: 'T5',
      kind: 'runtime-exec',
      command: 'npx tsx --test tests/matrix-golden-flow.test.ts',
      expected_exit: 0,
      expected_output_pattern: 'pass',
      min_duration_ms: 500,
      timeout_ms: 120000,
      required_callsite: 'tests/matrix-golden-flow.test.ts',
      description: 'Golden flow integration test RUNS and passes',
    },
    {
      id: 't_cli_smoke_runner_runtime',
      tier: 'T5',
      kind: 'runtime-exec',
      command: 'npx tsx --test tests/cli-smoke-runner.test.ts',
      expected_exit: 0,
      expected_output_pattern: 'pass',
      min_duration_ms: 200,
      timeout_ms: 60000,
      required_callsite: 'src/matrix/engines/cli-smoke-runner.ts',
      description: 'CLI smoke runner tests EXECUTE and pass',
    },
    {
      id: 't_runtime_exec_runner_runtime',
      tier: 'T5',
      kind: 'runtime-exec',
      command: 'npx tsx --test tests/runtime-exec-runner.test.ts',
      expected_exit: 0,
      expected_output_pattern: 'pass',
      min_duration_ms: 200,
      timeout_ms: 60000,
      required_callsite: 'src/matrix/engines/runtime-exec-runner.ts',
      description: 'Runtime exec runner tests EXECUTE and pass',
    },
  ],
  developer_experience: [
    {
      id: 'dx_cli_help_smoke',
      tier: 'T5',
      kind: 'cli-smoke',
      cli_args: ['--help'],
      expected_exit: 0,
      expected_stdout_patterns: ['danteforge'],
      cwd_strategy: 'project-root',
      timeout_ms: 30000,
      required_callsite: 'src/cli/index.ts',
      description: 'CLI --help runs and shows expected commands',
    },
    {
      id: 'dx_score_prompt_smoke',
      tier: 'T5',
      kind: 'cli-smoke',
      cli_args: ['score', '--prompt'],
      expected_exit: 0,
      expected_stdout_patterns: ['score', 'dimension'],
      cwd_strategy: 'project-root',
      timeout_ms: 30000,
      required_callsite: 'src/cli/commands/score.ts',
      description: 'danteforge score --prompt runs without errors',
    },
  ],
  functionality: [
    {
      id: 'fn_help_smoke',
      tier: 'T5',
      kind: 'cli-smoke',
      cli_args: ['help'],
      expected_exit: 0,
      expected_stdout_patterns: ['forge', 'verify'],
      cwd_strategy: 'project-root',
      timeout_ms: 30000,
      required_callsite: 'src/cli/index.ts',
      description: 'danteforge help runs and lists commands',
    },
    {
      id: 'fn_verify_prompt_smoke',
      tier: 'T5',
      kind: 'cli-smoke',
      cli_args: ['verify', '--prompt'],
      expected_exit: 0,
      cwd_strategy: 'project-root',
      timeout_ms: 30000,
      required_callsite: 'src/cli/commands/verify.ts',
      description: 'danteforge verify --prompt runs without errors',
    },
  ],
  spec_driven_pipeline: [
    {
      id: 'sp_specify_prompt_smoke',
      tier: 'T5',
      kind: 'cli-smoke',
      cli_args: ['specify', '--prompt'],
      expected_exit: 0,
      cwd_strategy: 'project-root',
      timeout_ms: 30000,
      required_callsite: 'src/cli/commands/specify.ts',
      description: 'danteforge specify --prompt runs and produces output',
    },
  ],
  outcome_verification: [
    {
      id: 'ov_validate_runtime',
      tier: 'T5',
      kind: 'runtime-exec',
      command: 'npx tsx --test tests/outcome-quality-runtime.test.ts',
      expected_exit: 0,
      expected_output_pattern: 'pass',
      min_duration_ms: 200,
      timeout_ms: 60000,
      required_callsite: 'src/matrix/engines/outcome-quality.ts',
      description: 'Outcome quality runtime gate tests EXECUTE and pass',
    },
  ],
  multi_agent_orchestration: [
    {
      id: 'mo_kernel_status_smoke',
      tier: 'T5',
      kind: 'cli-smoke',
      cli_args: ['matrix-kernel', 'status'],
      expected_exit: 0,
      cwd_strategy: 'project-root',
      timeout_ms: 30000,
      required_callsite: 'src/cli/commands/matrix-kernel.ts',
      description: 'matrix-kernel status runs and returns state',
    },
  ],
};

let added = 0;
for (const dim of matrix.dimensions) {
  const newOutcomes = RUNTIME_OUTCOMES[dim.id];
  if (!newOutcomes) continue;

  const existingIds = new Set((dim.outcomes || []).map(o => o.id));
  for (const outcome of newOutcomes) {
    if (existingIds.has(outcome.id)) {
      console.log(`  skip ${dim.id}/${outcome.id} (already exists)`);
      continue;
    }
    dim.outcomes = dim.outcomes || [];
    dim.outcomes.push(outcome);
    added++;
    console.log(`  + ${dim.id}/${outcome.id} (${outcome.kind}, ${outcome.tier})`);
  }
}

fs.writeFileSync(MATRIX_PATH, JSON.stringify(matrix, null, 2) + '\n');
console.log(`\nDone: ${added} runtime outcomes added.`);
