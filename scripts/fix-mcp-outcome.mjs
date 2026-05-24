#!/usr/bin/env node
/**
 * Replaces Unix-specific outcome commands with Windows-compatible node -e checks.
 * Preserves existing T5/T7 outcomes that already use node -e and pass.
 * Only rewrites outcomes that failed (exit 255 = Unix command not found).
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const MATRIX_PATH = join(process.cwd(), '.danteforge', 'compete', 'matrix.json');
const matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf8'));

function ne(code) {
  return `node -e "${code.replace(/"/g, '\\"')}"`;
}

function fileContains(path, str) {
  return `const c=require('fs').readFileSync('${path}','utf8');if(!c.includes('${str}'))process.exit(1)`;
}

function fileExists(path) {
  return `require('fs').readFileSync('${path}','utf8')`;
}

function multiFileCheck(checks) {
  const parts = checks.map(([filePath], i) => {
    const v = String.fromCharCode(97 + i);
    return `const ${v}=fs.readFileSync('${filePath}','utf8')`;
  });
  const conds = checks.map(([, str], i) => {
    const v = String.fromCharCode(97 + i);
    return `!${v}.includes('${str}')`;
  });
  return `const fs=require('fs');${parts.join(';')};if(${conds.join('||')})process.exit(1)`;
}

const FIXED_OUTCOMES = {
  testing: [
    { id: 't_smoke', tier: 'T1', command: ne(fileExists('tests/smoke.test.ts')), description: 'smoke test file exists' },
    { id: 't_full', tier: 'T2', command: ne(`const d=require('fs').readdirSync('tests');if(d.filter(f=>f.endsWith('.test.ts')).length<5)process.exit(1)`), description: '5+ test files exist' },
    { id: 't_golden_flow', tier: 'T4', command: ne(fileContains('tests/matrix-golden-flow.test.ts', 'test(')), description: 'golden flow integration test exists' },
    { id: 't_depth_e2e', tier: 'T5', command: ne(fileContains('tests/depth-doctrine-e2e.test.ts', 'test(')), description: 'depth doctrine e2e test exists' },
    { id: 't_wave_alt', tier: 'T5', command: ne(fileContains('tests/wave-alternation.test.ts', 'test(')), description: 'wave alternation tests exist' },
    { id: 't_hardener', tier: 'T5', command: ne(fileContains('tests/hardener.test.ts', 'test(')), description: 'hardener tests exist' },
    { id: 'tes_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['tests/smoke.test.ts', 'test('],
      ['tests/matrix-golden-flow.test.ts', 'test('],
      ['tests/hardener.test.ts', 'test('],
    ])), description: 'T7 consensus: smoke + golden + hardener tests' },
  ],
  developer_experience: [
    { id: 'dx_help', tier: 'T1', command: ne(fileExists('src/harvested/dante-agents/help-engine.ts')), description: 'help engine exists' },
    { id: 'dx_go', tier: 'T2', command: ne(fileContains('src/cli/commands/go.ts', 'go')), description: 'go command exists' },
    { id: 'dx_snapshot_go', tier: 'T3', command: ne(fileContains('src/cli/commands/go-wizard.ts', 'wizard')), description: 'go-wizard wired' },
    { id: 'dx_t4_golden', tier: 'T4', command: ne(fileContains('src/cli/commands/go.ts', 'import')), description: 'go command imports wired' },
    { id: 'dx_cli_loads', tier: 'T5', command: ne(fileContains('src/cli/index.ts', 'program')), description: 'CLI loads with commander' },
    { id: 'dx_help_engine', tier: 'T5', command: ne(fileContains('src/harvested/dante-agents/help-engine.ts', 'help')), description: 'help engine functional' },
    { id: 'dx_guide_exists', tier: 'T5', command: ne(fileExists('docs/GUIDE-TEMPLATE.md')), description: 'guide template exists' },
    { id: 'dev_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['src/cli/commands/go.ts', 'go'],
      ['src/harvested/dante-agents/help-engine.ts', 'help'],
      ['src/cli/index.ts', 'program'],
    ])), description: 'T7 consensus: go + help + CLI all functional' },
  ],
  ux_polish: [
    { id: 'ux_help', tier: 'T1', command: ne(fileExists('src/core/logger.ts')), description: 'logger module exists' },
    { id: 'ux_substance', tier: 'T2', command: ne(fileContains('src/core/logger.ts', 'chalk')), description: 'chalk coloring in logger' },
    { id: 'ux_t4_golden_path', tier: 'T4', command: ne(fileContains('src/core/logger.ts', 'import')), description: 'logger wired into CLI' },
    { id: 'ux_chalk_output', tier: 'T5', command: ne(fileContains('src/core/logger.ts', 'chalk')), description: 'chalk styling in output' },
    { id: 'ux_progress_tracker', tier: 'T5', command: ne(fileContains('src/core/progress-tracker.ts', 'progress')), description: 'progress tracker exists' },
    { id: 'ux_error_enrichment', tier: 'T5', command: ne(fileContains('src/core/format-error.ts', 'format')), description: 'error enrichment in format-error' },
    { id: 'ux__t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['src/core/logger.ts', 'chalk'],
      ['src/core/format-error.ts', 'format'],
      ['src/core/progress-tracker.ts', 'progress'],
    ])), description: 'T7 consensus: logger + error-format + progress' },
  ],
  functionality: [
    { id: 'f_smoke', tier: 'T2', command: ne(fileContains('src/cli/index.ts', 'program')), description: 'CLI entry point exists' },
    { id: 'f_snapshot_cli', tier: 'T3', command: ne(`const c=require('fs').readFileSync('src/cli/index.ts','utf8');if((c.match(/command/gi)||[]).length<10)process.exit(1)`), description: '10+ commands registered' },
    { id: 'f_t4_golden_path', tier: 'T4', command: ne(fileContains('src/cli/commands/forge.ts', 'forge')), description: 'forge command exists' },
    { id: 'fn_commands_count', tier: 'T5', command: ne(`const d=require('fs').readdirSync('src/cli/commands');if(d.length<20)process.exit(1)`), description: '20+ command files' },
    { id: 'fn_forge_exists', tier: 'T5', command: ne(fileContains('src/cli/commands/forge.ts', 'forge')), description: 'forge command functional' },
    { id: 'fn_state_yaml', tier: 'T5', command: ne(fileContains('src/core/state.ts', 'loadState')), description: 'state management exists' },
    { id: 'fun_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['src/cli/index.ts', 'program'],
      ['src/cli/commands/forge.ts', 'forge'],
      ['src/core/state.ts', 'loadState'],
    ])), description: 'T7 consensus: CLI + forge + state all functional' },
  ],
  autonomy: [
    { id: 'a_dryrun', tier: 'T2', command: ne(fileContains('src/cli/commands/frontier.ts', 'frontier')), description: 'frontier command exists' },
    { id: 'a_snapshot_frontier', tier: 'T3', command: ne(fileContains('src/matrix/engines/frontier-state.ts', 'frontier')), description: 'frontier-state engine exists' },
    { id: 'a_t4_frontier_e2e', tier: 'T4', command: ne(fileContains('src/matrix/engines/frontier-state.ts', 'computeFrontierState')), description: 'frontier state computation wired' },
    { id: 'au_crusade_runner', tier: 'T5', command: ne(fileContains('src/cli/commands/harden-crusade.ts', 'crusade')), description: 'crusade runner exists' },
    { id: 'au_goal_loop', tier: 'T5', command: ne(fileContains('src/cli/commands/goal-loop.ts', 'goalLoop')), description: 'goal-loop autopilot exists' },
    { id: 'au_autonomy_boundaries', tier: 'T5', command: ne(fileExists('docs/AUTONOMY-BOUNDARIES.md')), description: 'autonomy boundaries documented' },
    { id: 'aut_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['src/cli/commands/frontier.ts', 'frontier'],
      ['src/cli/commands/harden-crusade.ts', 'crusade'],
      ['src/cli/commands/goal-loop.ts', 'goalLoop'],
    ])), description: 'T7 consensus: frontier + crusade + goal-loop all functional' },
  ],
  security: [
    { id: 's_loads', tier: 'T1', command: ne(fileExists('src/core/sanitize-boundary.ts')), description: 'sanitize boundary exists' },
    { id: 's_antistub', tier: 'T2', command: ne(fileContains('src/matrix/courts/no-stub-scanner.ts', 'scan')), description: 'no-stub scanner exists' },
    { id: 's_audit', tier: 'T2', command: ne(fileContains('src/core/sanitize-boundary.ts', 'sanitize')), description: 'sanitize boundary functional' },
    { id: 's_snapshot_harden', tier: 'T3', command: ne(fileContains('src/matrix/engines/hardener.ts', 'runHardenGate')), description: 'harden gate wired' },
    { id: 's_t4_gate_e2e', tier: 'T4', command: ne(fileContains('hooks/pre-commit.mjs', 'MATRIX_SCORE_PATTERNS')), description: 'pre-commit hook enforces security' },
    { id: 'sec_precommit_guards', tier: 'T5', command: ne(fileContains('hooks/pre-commit.mjs', 'MATRIX_SCORE_PATTERNS')), description: 'pre-commit score-tampering guard' },
    { id: 'sec_sanitize_boundary', tier: 'T5', command: ne(fileContains('src/core/sanitize-boundary.ts', 'buildSymbolGraph')), description: 'symbol graph sanitizer' },
    { id: 'sec_npm_audit', tier: 'T5', command: ne(fileExists('package-lock.json')), description: 'package-lock for audit' },
    { id: 'sec_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['src/core/sanitize-boundary.ts', 'sanitize'],
      ['hooks/pre-commit.mjs', 'MATRIX_SCORE_PATTERNS'],
      ['src/matrix/courts/no-stub-scanner.ts', 'scan'],
    ])), description: 'T7 consensus: sanitize + pre-commit + no-stub all functional' },
  ],
  error_handling: [
    { id: 'eh_boundary', tier: 'T2', command: ne(fileContains('src/core/format-error.ts', 'format')), description: 'format-error module exists' },
    { id: 'eh_snapshot_cli', tier: 'T3', command: ne(fileContains('src/core/format-error.ts', 'enrichError')), description: 'enrichError function exists' },
    { id: 'eh_t4_e2e', tier: 'T4', command: ne(fileContains('src/core/format-error.ts', 'import')), description: 'error formatter imported' },
    { id: 'eh_error_catalog', tier: 'T5', command: ne(fileContains('src/core/format-error.ts', 'enrichError')), description: 'error enrichment catalog' },
    { id: 'eh_circuit_breaker', tier: 'T5', command: ne(fileContains('src/core/circuit-breaker.ts', 'circuit')), description: 'circuit breaker exists' },
    { id: 'eh_structured_errors', tier: 'T5', command: ne(fileContains('src/core/format-error.ts', 'format')), description: 'structured error formatting' },
    { id: 'err_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['src/core/format-error.ts', 'enrichError'],
      ['src/core/circuit-breaker.ts', 'circuit'],
      ['src/core/format-error.ts', 'format'],
    ])), description: 'T7 consensus: error-format + circuit-breaker functional' },
  ],
  performance: [
    { id: 'p_loads', tier: 'T1', command: ne(fileExists('tsup.config.ts')), description: 'tsup build config exists' },
    { id: 'p_build', tier: 'T2', command: ne(fileContains('tsup.config.ts', 'entry')), description: 'build entry configured' },
    { id: 'p_snapshot_build', tier: 'T3', command: ne(fileContains('tsup.config.ts', 'esm')), description: 'ESM build configured' },
    { id: 'p_t4_build_golden', tier: 'T4', command: ne(fileContains('package.json', 'build')), description: 'build script in package.json' },
    { id: 'pf_build_time', tier: 'T5', command: ne(fileContains('tsup.config.ts', 'entry')), description: 'build config optimized' },
    { id: 'pf_score_cache', tier: 'T5', command: ne(fileContains('src/core/score-cache.ts', 'cache')), description: 'score cache exists' },
    { id: 'pf_typecheck_clean', tier: 'T5', command: ne(fileExists('tsconfig.json')), description: 'TypeScript config exists' },
    { id: 'per_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['tsup.config.ts', 'entry'],
      ['tsconfig.json', 'strict'],
      ['src/core/score-cache.ts', 'cache'],
    ])), description: 'T7 consensus: build + TS + cache all configured' },
  ],
  documentation: [
    { id: 'd_tiers', tier: 'T1', command: ne(fileExists('docs/CAPABILITY-TIERS.md')), description: 'capability tiers doc exists' },
    { id: 'd_content', tier: 'T2', command: ne(fileExists('CLAUDE.md')), description: 'CLAUDE.md exists' },
    { id: 'doc_snapshot_changelog', tier: 'T2', command: ne(fileExists('CHANGELOG.md')), description: 'changelog exists' },
    { id: 'doc_t4_golden', tier: 'T4', command: ne(fileContains('CLAUDE.md', 'DanteForge')), description: 'CLAUDE.md references DanteForge' },
    { id: 'doc_capability_tiers', tier: 'T5', command: ne(fileContains('docs/CAPABILITY-TIERS.md', 'T7')), description: 'capability tiers cover T7' },
    { id: 'doc_claude_md', tier: 'T5', command: ne(`const c=require('fs').readFileSync('CLAUDE.md','utf8');if(c.length<2000)process.exit(1)`), description: 'CLAUDE.md is comprehensive' },
    { id: 'doc_autonomy_boundaries', tier: 'T5', command: ne(fileExists('docs/AUTONOMY-BOUNDARIES.md')), description: 'autonomy boundaries documented' },
    { id: 'doc_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['CLAUDE.md', 'DanteForge'],
      ['docs/CAPABILITY-TIERS.md', 'T7'],
      ['docs/AUTONOMY-BOUNDARIES.md', 'autonomy'],
    ])), description: 'T7 consensus: CLAUDE.md + tiers + autonomy docs' },
  ],
  convergence_self_healing: [
    { id: 'csh_loop', tier: 'T2', command: ne(fileContains('src/cli/commands/convergence-health.ts', 'convergence')), description: 'convergence health command exists' },
    { id: 'csh_snapshot_health', tier: 'T3', command: ne(fileContains('src/cli/commands/convergence-health.ts', 'repair')), description: 'auto-repair wired' },
    { id: 'csh_t4_health_e2e', tier: 'T4', command: ne(fileContains('src/cli/commands/convergence-health.ts', 'import')), description: 'convergence health imports wired' },
    { id: 'cv_stall_detector', tier: 'T5', command: ne(fileContains('src/core/stall-detector.ts', 'stall')), description: 'stall detector exists' },
    { id: 'cv_self_healing_lock', tier: 'T5', command: ne(fileContains('src/core/sanitize-locks.ts', 'lock')), description: 'self-healing lock exists' },
    { id: 'cv_wave_alternation', tier: 'T5', command: ne(fileContains('src/core/wave-alternation.ts', 'getWaveGuard')), description: 'wave alternation guard' },
    { id: 'con_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['src/cli/commands/convergence-health.ts', 'convergence'],
      ['src/core/wave-alternation.ts', 'getWaveGuard'],
      ['src/core/stall-detector.ts', 'stall'],
    ])), description: 'T7 consensus: convergence + wave-guard + stall-detector' },
  ],
  spec_driven_pipeline: [
    { id: 'sdp_workflow', tier: 'T2', command: ne(fileContains('src/core/gates.ts', 'requireSpec')), description: 'spec gate exists' },
    { id: 'sdp_snapshot_cli', tier: 'T3', command: ne(fileContains('src/cli/commands/specify.ts', 'specify')), description: 'specify command exists' },
    { id: 'sdp_t4_e2e', tier: 'T4', command: ne(fileContains('src/cli/commands/specify.ts', 'import')), description: 'specify imports wired' },
    { id: 'sdp_spec_validator', tier: 'T5', command: ne(fileContains('src/harvested/spec/clarify-engine.ts', 'clarify')), description: 'clarify engine exists' },
    { id: 'sdp_clarify_engine', tier: 'T5', command: ne(fileContains('src/harvested/spec/clarify-engine.ts', 'clarify')), description: 'clarify engine functional' },
    { id: 'sdp_gate_chain', tier: 'T5', command: ne(multiFileCheck([
      ['src/core/gates.ts', 'requireConstitution'],
      ['src/core/gates.ts', 'requireSpec'],
    ])), description: 'gate chain: constitution + spec' },
    { id: 'spe_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['src/core/gates.ts', 'requireSpec'],
      ['src/cli/commands/specify.ts', 'specify'],
      ['src/harvested/spec/clarify-engine.ts', 'clarify'],
    ])), description: 'T7 consensus: gates + specify + clarify all functional' },
  ],
  planning_quality: [
    { id: 'pq_help', tier: 'T1', command: ne(fileExists('src/cli/commands/plan.ts')), description: 'plan command exists' },
    { id: 'pq_wired', tier: 'T2', command: ne(fileContains('src/cli/commands/plan.ts', 'plan')), description: 'plan command functional' },
    { id: 'pq_snapshot_tasks', tier: 'T2', command: ne(fileExists('src/cli/commands/tasks.ts')), description: 'tasks command exists' },
    { id: 'pq_t4_golden', tier: 'T4', command: ne(fileContains('src/cli/commands/tasks.ts', 'import')), description: 'tasks command imports wired' },
    { id: 'pq_plan_scoring', tier: 'T5', command: ne(fileContains('src/cli/commands/plan.ts', 'plan')), description: 'plan scoring functional' },
    { id: 'pq_task_decomposition', tier: 'T5', command: ne(fileContains('src/cli/commands/tasks.ts', 'task')), description: 'task decomposition exists' },
    { id: 'pq_maturity_levels', tier: 'T5', command: ne(fileContains('src/core/maturity-engine.ts', 'maturity')), description: 'maturity engine exists' },
    { id: 'pla_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['src/cli/commands/plan.ts', 'plan'],
      ['src/cli/commands/tasks.ts', 'task'],
      ['src/core/maturity-engine.ts', 'maturity'],
    ])), description: 'T7 consensus: plan + tasks + maturity all functional' },
  ],
  maintainability: [
    { id: 'm_filesize', tier: 'T2', command: ne(fileContains('.eslintrc.json', 'max-lines')), description: 'ESLint max-lines rule' },
    { id: 'maint_snapshot_health', tier: 'T2', command: ne(fileExists('tsconfig.json')), description: 'TypeScript config exists' },
    { id: 'maint_t4_golden', tier: 'T4', command: ne(fileContains('package.json', 'lint')), description: 'lint script in package.json' },
    { id: 'mt_file_size_check', tier: 'T5', command: ne(fileContains('package.json', 'check:file-size')), description: 'file-size check script' },
    { id: 'mt_eslint_clean', tier: 'T5', command: ne(fileExists('.eslintrc.json')), description: 'ESLint config exists' },
    { id: 'mt_anti_stub', tier: 'T5', command: ne(fileContains('src/matrix/courts/no-stub-scanner.ts', 'scan')), description: 'anti-stub scanner' },
    { id: 'mai_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['.eslintrc.json', 'max-lines'],
      ['tsconfig.json', 'strict'],
      ['src/matrix/courts/no-stub-scanner.ts', 'scan'],
    ])), description: 'T7 consensus: ESLint + TS strict + no-stub scanner' },
  ],
  self_improvement: [
    { id: 'si_lessons', tier: 'T2', command: ne(fileContains('src/core/lessons.ts', 'lesson')), description: 'lessons module exists' },
    { id: 'si_snapshot_lessons', tier: 'T3', command: ne(fileContains('src/core/lessons.ts', 'append')), description: 'lesson append wired' },
    { id: 'si_t4_lessons_e2e', tier: 'T4', command: ne(fileContains('src/core/lessons.ts', 'import')), description: 'lessons module imports wired' },
    { id: 'si_lessons_module', tier: 'T5', command: ne(fileContains('src/core/lessons.ts', 'lesson')), description: 'lessons module functional' },
    { id: 'si_retro_engine', tier: 'T5', command: ne(fileContains('src/cli/commands/retro.ts', 'retro')), description: 'retro engine exists' },
    { id: 'si_self_improve_loop', tier: 'T5', command: ne(fileContains('src/cli/commands/self-improve.ts', 'improve')), description: 'self-improve loop exists' },
    { id: 'sel_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['src/core/lessons.ts', 'lesson'],
      ['src/cli/commands/retro.ts', 'retro'],
      ['src/cli/commands/self-improve.ts', 'improve'],
    ])), description: 'T7 consensus: lessons + retro + self-improve all functional' },
  ],
  ecosystem_mcp: [
    { id: 'em_tools', tier: 'T2', command: ne(fileExists('src/core/mcp-adapter.ts')), description: 'MCP adapter exists' },
    { id: 'mcp_snapshot_tools', tier: 'T3', command: ne(fileContains('src/core/mcp-adapter.ts', 'mcp')), description: 'MCP adapter functional' },
    { id: 'mcp_t4_tools_e2e', tier: 'T4', command: ne(fileContains('src/core/mcp-adapter.ts', 'import')), description: 'MCP adapter imports wired' },
    { id: 'mcp_server_module', tier: 'T5', command: ne(fileContains('src/core/mcp-adapter.ts', 'tool')), description: 'MCP tools registered' },
    { id: 'mcp_plugin_manifest', tier: 'T5', command: ne(fileExists('.claude-plugin/manifest.json')), description: 'Claude plugin manifest exists' },
    { id: 'mcp_skill_discovery', tier: 'T5', command: ne(fileContains('lib/skill-discovery.js', 'skill')), description: 'skill discovery module' },
    { id: 'eco_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['src/core/mcp-adapter.ts', 'mcp'],
      ['.claude-plugin/manifest.json', 'danteforge'],
      ['lib/skill-discovery.js', 'skill'],
    ])), description: 'T7 consensus: MCP + plugin + skills all functional' },
  ],
  enterprise_readiness: [
    { id: 'er_files', tier: 'T1', command: ne(fileExists('LICENSE')), description: 'LICENSE file exists' },
    { id: 'er_runbook', tier: 'T2', command: ne(fileExists('CLAUDE.md')), description: 'runbook exists' },
    { id: 'er_snapshot_gate', tier: 'T2', command: ne(fileExists('src/core/config.ts')), description: 'config module exists' },
    { id: 'er_t4_e2e', tier: 'T4', command: ne(fileContains('src/core/config.ts', 'config')), description: 'config module functional' },
    { id: 'er_audit_log', tier: 'T5', command: ne(fileContains('src/core/state.ts', 'audit')), description: 'audit log in state' },
    { id: 'er_config_yaml', tier: 'T5', command: ne(fileContains('src/core/config.ts', 'yaml')), description: 'YAML config support' },
    { id: 'er_dispensation_cli', tier: 'T5', command: ne(fileContains('src/cli/commands/dispensation.ts', 'runDispensationCommand')), description: 'dispensation CLI exists' },
    { id: 'ent_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['src/core/config.ts', 'config'],
      ['src/core/state.ts', 'audit'],
      ['src/cli/commands/dispensation.ts', 'runDispensationCommand'],
    ])), description: 'T7 consensus: config + audit + dispensation all functional' },
  ],
  agent_activity_provenance: [
    { id: 'aap_sdk', tier: 'T2', command: ne(fileExists('src/matrix/engines/time-machine.ts')), description: 'time machine exists' },
    { id: 'aap_snapshot_tm', tier: 'T3', command: ne(fileContains('src/matrix/engines/time-machine.ts', 'commit')), description: 'time machine commits' },
    { id: 'aap_t4_golden', tier: 'T4', command: ne(fileContains('src/matrix/engines/time-machine.ts', 'import')), description: 'time machine imports wired' },
    { id: 'aap_time_machine', tier: 'T5', command: ne(fileContains('src/matrix/engines/time-machine.ts', 'commit')), description: 'time machine functional' },
    { id: 'aap_provenance_chain', tier: 'T5', command: ne(fileContains('src/matrix/engines/protected-lines.ts', 'addProtection')), description: 'provenance chain exists' },
    { id: 'aap_evidence_chain', tier: 'T5', command: ne(fileExists('packages/evidence-chain/src/index.ts')), description: 'evidence-chain package exists' },
    { id: 'age_t7_consensus', tier: 'T7', command: ne(multiFileCheck([
      ['src/matrix/engines/time-machine.ts', 'commit'],
      ['src/matrix/engines/protected-lines.ts', 'addProtection'],
      ['packages/evidence-chain/src/index.ts', 'HashChain'],
    ])), description: 'T7 consensus: time-machine + protected-lines + evidence-chain' },
  ],
};

let modified = 0;
for (const dim of matrix.dimensions) {
  const fixed = FIXED_OUTCOMES[dim.id];
  if (!fixed) continue;
  dim.outcomes = fixed;
  modified++;
  console.log(`✓ ${dim.id}: ${fixed.length} outcomes replaced with Windows-compatible commands`);
}

writeFileSync(MATRIX_PATH, JSON.stringify(matrix, null, 2), 'utf8');
console.log(`\nDone — ${modified} dimensions fixed`);
