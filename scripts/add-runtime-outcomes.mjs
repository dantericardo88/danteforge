#!/usr/bin/env node
// Upgrade matrix outcomes above T4 to runtime evidence.
//
// The scoring doctrine caps structural checks at T4/7.0. This script removes
// T5+ shell outcomes that only inspect files and replaces them with runtime
// tests or CLI smoke checks that exercise the capability.

import fs from 'node:fs';
import path from 'node:path';

const MATRIX_PATH = path.join(process.cwd(), '.danteforge', 'compete', 'matrix.json');
const matrix = JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8'));

const HIGH_TIERS = new Set(['T5', 'T6', 'T7', 'T8']);
const OBSOLETE_HIGH_TIER_IDS = new Set([
  'dx_score_prompt_smoke',
  'fn_verify_prompt_smoke',
  'sp_specify_prompt_smoke',
]);

function runtime(id, tier, command, callsite, description, timeout = 120000) {
  return {
    id,
    tier,
    kind: 'runtime-exec',
    command,
    expected_exit: 0,
    expected_output_pattern: 'pass',
    timeout_ms: timeout,
    required_callsite: callsite,
    description,
  };
}

const RUNTIME_OUTCOMES = {
  testing: [
    runtime('testing_t5_smoke_runtime', 'T5', 'npx tsx --test tests/smoke.test.ts', 'tests/smoke.test.ts', 'Smoke test suite executes.'),
    runtime('testing_t5_cli_runner_runtime', 'T5', 'npx tsx --test tests/cli-smoke-runner.test.ts', 'src/matrix/engines/cli-smoke-runner.ts', 'CLI smoke runner tests execute.'),
    runtime('testing_t7_golden_runtime', 'T7', 'npx tsx --test tests/matrix-golden-flow.test.ts tests/runtime-exec-runner.test.ts', 'tests/matrix-golden-flow.test.ts', 'Golden matrix flow and runtime runner execute.'),
  ],
  developer_experience: [
    runtime('dx_t5_developer_runtime', 'T5', 'npx tsx --test tests/developer-experience.test.ts', 'tests/developer-experience.test.ts', 'Developer experience tests execute.'),
    runtime('dx_t5_command_suggest_runtime', 'T5', 'npx tsx --test tests/command-suggest.test.ts', 'tests/command-suggest.test.ts', 'Command suggestion tests execute.'),
    runtime('dx_t7_docs_cli_runtime', 'T7', 'npx tsx --test tests/docs-command.test.ts tests/cli-error-boundary.test.ts', 'tests/docs-command.test.ts', 'Docs command and CLI error-boundary tests execute.'),
  ],
  ux_polish: [
    runtime('ux_t5_actionable_errors_runtime', 'T5', 'npx tsx --test tests/actionable-errors.test.ts', 'src/core/actionable-errors.ts', 'Actionable error UX tests execute.'),
    runtime('ux_t5_format_error_runtime', 'T5', 'npx tsx --test tests/format-error.test.ts', 'src/core/format-error.ts', 'Formatted error UX tests execute.'),
    runtime('ux_t7_cli_error_runtime', 'T7', 'npx tsx --test tests/cli-error-boundary.test.ts tests/actionable-errors.test.ts', 'tests/cli-error-boundary.test.ts', 'CLI error UX boundary tests execute.'),
  ],
  functionality: [
    runtime('functionality_t5_smoke_runtime', 'T5', 'npx tsx --test tests/smoke.test.ts', 'tests/smoke.test.ts', 'CLI smoke tests execute.'),
    runtime('functionality_t5_core_runtime', 'T5', 'npx tsx --test tests/functionality.test.ts', 'tests/functionality.test.ts', 'Core functionality tests execute.'),
    runtime('functionality_t7_cli_runtime', 'T7', 'npx tsx --test tests/cli-flags.test.ts tests/cli-smoke-runner.test.ts', 'tests/cli-flags.test.ts', 'CLI flag and smoke runner tests execute.'),
  ],
  autonomy: [
    runtime('autonomy_t5_frontier_runtime', 'T5', 'npx tsx --test tests/frontier-state.test.ts', 'src/core/frontier-state.ts', 'Frontier state autonomy tests execute.'),
    runtime('autonomy_t5_harden_crusade_runtime', 'T5', 'npx tsx --test tests/harden-crusade.test.ts', 'src/cli/commands/harden-crusade.ts', 'Harden-crusade autonomy tests execute.'),
    runtime('autonomy_t7_crusade_runtime', 'T7', 'npx tsx --test tests/autonomy.test.ts tests/crusade-autonomy.test.ts tests/frontier-crusade.test.ts', 'src/cli/commands/frontier.ts', 'Autonomy and frontier crusade tests execute.'),
  ],
  security: [
    runtime('security_t5_scan_runtime', 'T5', 'npx tsx --test tests/security.test.ts', 'src/core/security-scan.ts', 'Security scan tests execute.'),
    runtime('security_t5_controls_runtime', 'T5', 'npx tsx --test tests/security-controls.test.ts', 'src/core/security-controls.ts', 'Security control tests execute.'),
    runtime('security_t7_runtime', 'T7', 'npx tsx --test tests/security-scoring.test.ts tests/anti-stub-scan.test.ts', 'tests/security-scoring.test.ts', 'Security scoring and anti-stub tests execute.'),
  ],
  error_handling: [
    runtime('errors_t5_handling_runtime', 'T5', 'npx tsx --test tests/error-handling.test.ts', 'tests/error-handling.test.ts', 'Error handling tests execute.'),
    runtime('errors_t5_boundary_runtime', 'T5', 'npx tsx --test tests/error-boundary-coverage.test.ts', 'tests/error-boundary-coverage.test.ts', 'Error boundary coverage tests execute.'),
    runtime('errors_t7_actionable_runtime', 'T7', 'npx tsx --test tests/actionable-errors.test.ts tests/format-error.test.ts', 'tests/actionable-errors.test.ts', 'Actionable and formatted error tests execute.'),
  ],
  performance: [
    runtime('performance_t5_monitor_runtime', 'T5', 'npx tsx --test tests/performance-monitor.test.ts', 'src/core/performance-monitor.ts', 'Performance monitor tests execute.'),
    runtime('performance_t5_bench_runtime', 'T5', 'npx tsx --test tests/performance.test.ts', 'tests/performance.test.ts', 'Performance tests execute.'),
    runtime('performance_t7_token_runtime', 'T7', 'npx tsx --test tests/token-economy.test.ts tests/token-estimator.test.ts', 'tests/token-economy.test.ts', 'Token economy performance tests execute.'),
  ],
  documentation: [
    runtime('docs_t5_documentation_runtime', 'T5', 'npx tsx --test tests/documentation.test.ts', 'tests/documentation.test.ts', 'Documentation generator tests execute.'),
    runtime('docs_t5_command_runtime', 'T5', 'npx tsx --test tests/docs-command.test.ts', 'tests/docs-command.test.ts', 'Docs command tests execute.'),
    runtime('docs_t7_reference_runtime', 'T7', 'npx tsx --test tests/documentation.test.ts tests/docs-command.test.ts', 'docs/COMMAND_REFERENCE.md', 'Documentation reference workflow tests execute.'),
  ],
  convergence_self_healing: [
    runtime('convergence_t5_core_runtime', 'T5', 'npx tsx --test tests/convergence.test.ts', 'tests/convergence.test.ts', 'Convergence core tests execute.'),
    runtime('convergence_t5_self_healing_runtime', 'T5', 'npx tsx --test tests/convergence-self-healing.test.ts', 'src/core/convergence-self-healing.ts', 'Self-healing convergence tests execute.'),
    runtime('convergence_t7_e2e_runtime', 'T7', 'npx tsx --test tests/e2e-convergence.test.ts tests/e2e-convergence-runtime.test.ts', 'tests/e2e-convergence.test.ts', 'E2E convergence runtime tests execute.', 180000),
  ],
  spec_driven_pipeline: [
    runtime('sdp_t5_workflow_runtime', 'T5', 'npx tsx --test tests/workflow-enforcer.test.ts', 'src/core/workflow-enforcer.ts', 'Workflow enforcer tests execute.'),
    runtime('sdp_t5_clarify_runtime', 'T5', 'npx tsx --test tests/clarify-engine.test.ts', 'src/harvested/spec/clarify-engine.ts', 'Clarify engine tests execute.'),
    runtime('sdp_t7_e2e_runtime', 'T7', 'npx tsx --test tests/e2e-spec-pipeline.test.ts tests/clarify-command.test.ts', 'tests/e2e-spec-pipeline.test.ts', 'E2E spec pipeline tests execute.'),
  ],
  planning_quality: [
    runtime('planning_t5_quality_runtime', 'T5', 'npx tsx --test tests/planning-quality.test.ts', 'tests/planning-quality.test.ts', 'Planning quality tests execute.'),
    runtime('planning_t5_planner_runtime', 'T5', 'npx tsx --test tests/planner.test.ts', 'tests/planner.test.ts', 'Planner tests execute.'),
    runtime('planning_t7_sprint_runtime', 'T7', 'npx tsx --test tests/sprint-plan.test.ts tests/task-router.test.ts tests/tasks-command.test.ts', 'tests/sprint-plan.test.ts', 'Sprint planning and task routing tests execute.'),
  ],
  maintainability: [
    runtime('maint_t5_complexity_runtime', 'T5', 'npx tsx --test tests/maintainability.test.ts', 'tests/maintainability.test.ts', 'Maintainability tests execute.'),
    runtime('maint_t5_file_size_runtime', 'T5', 'npx tsx --test tests/file-size-hygiene.test.ts', 'tests/file-size-hygiene.test.ts', 'File-size hygiene tests execute.'),
    runtime('maint_t7_anti_stub_runtime', 'T7', 'npx tsx --test tests/anti-stub-scan.test.ts tests/shared-options.test.ts', 'tests/anti-stub-scan.test.ts', 'Anti-stub and shared option tests execute.'),
  ],
  token_economy: [
    runtime('token_t5_economy_runtime', 'T5', 'npx tsx --test tests/token-economy.test.ts', 'src/core/token-economy.ts', 'Token economy tests execute.'),
    runtime('token_t5_estimator_runtime', 'T5', 'npx tsx --test tests/token-estimator.test.ts', 'src/core/token-estimator.ts', 'Token estimator tests execute.'),
    runtime('token_t7_roi_runtime', 'T7', 'npx tsx --test tests/token-roi.test.ts tests/workspace-tokens.test.ts', 'tests/token-roi.test.ts', 'Token ROI and workspace token tests execute.'),
  ],
  self_improvement: [
    runtime('self_t5_loop_runtime', 'T5', 'npx tsx --test tests/self-improve-loop.test.ts', 'src/core/self-improve.ts', 'Self-improve loop tests execute.'),
    runtime('self_t5_report_runtime', 'T5', 'npx tsx --test tests/self-improve-report.test.ts', 'tests/self-improve-report.test.ts', 'Self-improve report tests execute.'),
    runtime('self_t7_lessons_runtime', 'T7', 'npx tsx --test tests/auto-lessons.test.ts tests/lessons-command.test.ts', 'tests/auto-lessons.test.ts', 'Auto-lessons and lessons command tests execute.'),
  ],
  ecosystem_mcp: [
    runtime('mcp_t5_ecosystem_runtime', 'T5', 'npx tsx --test tests/ecosystem-mcp.test.ts', 'tests/ecosystem-mcp.test.ts', 'Ecosystem MCP tests execute.'),
    runtime('mcp_t5_server_runtime', 'T5', 'npx tsx --test tests/mcp-server.test.ts tests/mcp-tools.test.ts', 'src/mcp/server.ts', 'MCP server and tool tests execute.'),
    runtime('mcp_t7_sdk_runtime', 'T7', 'npx tsx --test tests/mcp-server-sdk.test.ts tests/mcp-server-command.test.ts', 'tests/mcp-server-sdk.test.ts', 'MCP SDK and command tests execute.'),
  ],
  enterprise_readiness: [
    runtime('enterprise_t5_readiness_runtime', 'T5', 'npx tsx --test tests/enterprise-readiness.test.ts', 'src/core/enterprise-readiness.ts', 'Enterprise readiness tests execute.'),
    runtime('enterprise_t5_orchestrator_runtime', 'T5', 'npx tsx --test tests/enterprise-orchestrator.test.ts', 'src/core/enterprise-orchestrator.ts', 'Enterprise orchestrator tests execute.'),
    runtime('enterprise_t7_config_runtime', 'T7', 'npx tsx --test tests/config.test.ts tests/security-controls.test.ts', 'tests/config.test.ts', 'Config and security control tests execute.'),
  ],
  agent_activity_provenance: [
    runtime('provenance_t5_activity_runtime', 'T5', 'npx tsx --test tests/agent-activity-provenance.test.ts', 'src/core/agent-activity-provenance.ts', 'Agent activity provenance tests execute.'),
    runtime('provenance_t5_time_machine_runtime', 'T5', 'npx tsx --test tests/time-machine-outcome-integration.test.ts', 'src/core/time-machine.ts', 'Time Machine outcome integration tests execute.'),
    runtime('provenance_t7_summary_runtime', 'T7', 'npx tsx --test tests/provenance-summary.test.ts tests/time-machine-outcome-integration.test.ts', 'tests/provenance-summary.test.ts', 'Provenance summary and Time Machine tests execute.'),
  ],
  spec_workflow_enforcement: [
    runtime('swe_t5_enforcer_runtime', 'T5', 'npx tsx --test tests/workflow-enforcer.test.ts', 'src/core/workflow-enforcer.ts', 'Workflow enforcement tests execute.'),
    runtime('swe_t5_gates_runtime', 'T5', 'npx tsx --test tests/gates.test.ts', 'src/core/gates.ts', 'Workflow gate tests execute.'),
    runtime('swe_t7_workflow_runtime', 'T7', 'npx tsx --test tests/e2e-spec-pipeline.test.ts tests/workflow-command.test.ts', 'tests/e2e-spec-pipeline.test.ts', 'Spec pipeline and workflow command tests execute.'),
  ],
  outcome_verification: [
    runtime('outcome_t5_quality_runtime', 'T5', 'npx tsx --test tests/outcome-quality-runtime.test.ts', 'src/matrix/engines/outcome-quality.ts', 'Outcome runtime quality tests execute.'),
    runtime('outcome_t5_derived_runtime', 'T5', 'npx tsx --test tests/derived-score.test.ts', 'src/core/derived-score.ts', 'Derived score tests execute.'),
    runtime('outcome_t7_runner_runtime', 'T7', 'npx tsx --test tests/e2e-workflow-runner.test.ts tests/outcome-quality.test.ts', 'src/matrix/engines/e2e-workflow-runner.ts', 'E2E workflow runner and quality gate tests execute.'),
  ],
  constitutional_governance: [
    runtime('governance_t5_hardener_runtime', 'T5', 'npx tsx --test tests/hardener.test.ts', 'src/matrix/engines/hardener.ts', 'Hardener governance tests execute.'),
    runtime('governance_t5_agent_guard_runtime', 'T5', 'npx tsx --test tests/agent-guard.test.ts', 'scripts/check-agent-guard.mjs', 'Agent guard tests execute.'),
    runtime('governance_t7_protected_runtime', 'T7', 'npx tsx --test tests/matrix-protected-lines.test.ts tests/policy-gate.test.ts', 'tests/matrix-protected-lines.test.ts', 'Protected-line and policy-gate tests execute.'),
  ],
  multi_agent_orchestration: [
    runtime('multi_agent_t5_engine_runtime', 'T5', 'npx tsx --test tests/matrix-development-engine.test.ts', 'src/matrix/engine.ts', 'Matrix development engine tests execute.'),
    runtime('multi_agent_t5_score_writes_runtime', 'T5', 'npx tsx --test tests/matrix-kernel-score-writes.test.ts', 'src/matrix/kernel.ts', 'Matrix kernel score-write tests execute.'),
    runtime('multi_agent_t7_party_runtime', 'T7', 'npx tsx --test tests/agent-dag.test.ts tests/party-agents.test.ts', 'src/core/agent-dag.ts', 'Agent DAG and party orchestration tests execute.'),
  ],
  depth_doctrine: [
    runtime('depth_t5_doctrine_runtime', 'T5', 'npx tsx --test tests/depth-doctrine-e2e.test.ts', 'src/core/scoring-doctrine.ts', 'Depth doctrine E2E tests execute.'),
    runtime('depth_t5_quality_runtime', 'T5', 'npx tsx --test tests/outcome-quality-runtime.test.ts', 'src/matrix/engines/outcome-quality.ts', 'Runtime evidence quality tests execute.'),
    runtime('depth_t7_score_runtime', 'T7', 'npx tsx --test tests/derived-score.test.ts tests/outcome-quality.test.ts', 'src/core/derived-score.ts', 'Derived scoring and quality gate tests execute.'),
  ],
};

function dimensionsOf(value) {
  return Array.isArray(value.dimensions) ? value.dimensions : Object.values(value.dimensions ?? {});
}

function isRuntimeOutcome(outcome) {
  return ['cli-smoke', 'runtime-exec', 'e2e-workflow', 'external-benchmark'].includes(outcome.kind);
}

let removed = 0;
let added = 0;

for (const dim of dimensionsOf(matrix)) {
  const newOutcomes = RUNTIME_OUTCOMES[dim.id];
  if (!newOutcomes) continue;

  const before = dim.outcomes ?? [];
  dim.outcomes = before.filter((outcome) => {
    if (OBSOLETE_HIGH_TIER_IDS.has(outcome.id)) {
      removed++;
      return false;
    }
    if (!HIGH_TIERS.has(outcome.tier)) return true;
    if (isRuntimeOutcome(outcome)) return true;
    removed++;
    return false;
  });

  const existingIds = new Set(dim.outcomes.map((outcome) => outcome.id));
  for (const outcome of newOutcomes) {
    if (existingIds.has(outcome.id)) continue;
    dim.outcomes.push(outcome);
    existingIds.add(outcome.id);
    added++;
  }
}

const receiptDir = path.join(process.cwd(), '.danteforge', 'matrix');
fs.mkdirSync(receiptDir, { recursive: true });
const receiptPath = path.join(receiptDir, `runtime-outcomes-upgrade-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(
  receiptPath,
  JSON.stringify(
    {
      kind: 'matrix-runtime-outcome-upgrade',
      ranAt: new Date().toISOString(),
      matrixPath: path.relative(process.cwd(), MATRIX_PATH),
      removedStructuralHighTierOutcomes: removed,
      addedRuntimeOutcomes: added,
      dimensions: Object.keys(RUNTIME_OUTCOMES),
      rationale: 'T5+ scores require runtime execution evidence; structural shell outcomes are capped at T4.',
    },
    null,
    2,
  ) + '\n',
);

fs.writeFileSync(MATRIX_PATH, JSON.stringify(matrix, null, 2) + '\n');
console.log(`Removed ${removed} structural T5+ outcomes.`);
console.log(`Added ${added} runtime T5+/T7 outcomes.`);
console.log(`Receipt: ${path.relative(process.cwd(), receiptPath)}`);
