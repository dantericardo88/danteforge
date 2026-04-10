// docs - auto-generate command reference documentation from the declarative registry
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

interface CommandEntry {
  name: string;
  args?: string;
  description: string;
  options: string[];
  group: string;
}

const COMMAND_REGISTRY: CommandEntry[] = [
  { name: 'init', description: 'Interactive first-run wizard - detect project, check health, show next steps', options: ['--prompt'], group: 'Pipeline' },
  { name: 'constitution', description: 'Initialize project constitution and principles', options: [], group: 'Pipeline' },
  { name: 'specify', args: '<idea>', description: 'High-level idea -> full spec artifacts', options: ['--prompt', '--light', '--ceo-review', '--refine'], group: 'Pipeline' },
  { name: 'clarify', description: 'Run clarification Q&A on current spec', options: ['--prompt', '--light'], group: 'Pipeline' },
  { name: 'plan', description: 'Generate detailed plan from spec', options: ['--prompt', '--light', '--ceo-review', '--refine'], group: 'Pipeline' },
  { name: 'tasks', description: 'Break plan into executable tasks', options: ['--prompt', '--light'], group: 'Pipeline' },
  { name: 'forge', args: '[phase]', description: 'Execute development waves with agent orchestration', options: ['--parallel', '--profile <type>', '--prompt', '--light', '--worktree', '--figma', '--skip-ux'], group: 'Pipeline' },
  { name: 'verify', description: 'Run verification checks on project state and artifacts', options: ['--release', '--live', '--url <url>', '--recompute'], group: 'Pipeline' },
  { name: 'synthesize', description: 'Generate Ultimate Planning Resource (UPR.md) from all artifacts', options: [], group: 'Pipeline' },

  { name: 'spark', args: '[goal]', description: 'Zero-token planning preset for new ideas and project starts', options: ['--prompt', '--skip-tech-decide'], group: 'Automation' },
  { name: 'ember', args: '[goal]', description: 'Very low-token preset with light checkpoints and loop detection', options: ['--profile <type>', '--prompt'], group: 'Automation' },
  { name: 'canvas', args: '[goal]', description: 'Design-first frontend preset: design -> autoforge -> ux-refine -> verify', options: ['--profile <type>', '--prompt', '--design-prompt <text>'], group: 'Automation' },
  { name: 'magic', args: '[goal]', description: 'Balanced default preset for daily follow-up work', options: ['--level <level>', '--profile <type>', '--skip-ux', '--host <type>', '--prompt', '--worktree', '--isolation', '--max-repos <n>'], group: 'Automation' },
  { name: 'blaze', args: '[goal]', description: 'High-power preset with full party orchestration, synthesis, and retro', options: ['--profile <type>', '--prompt', '--worktree', '--isolation', '--with-design', '--design-prompt <text>'], group: 'Automation' },
  { name: 'nova', args: '[goal]', description: 'Very-high-power preset with planning prefix plus deep execution and polish', options: ['--profile <type>', '--prompt', '--worktree', '--isolation', '--tech-decide', '--with-design', '--design-prompt <text>'], group: 'Automation' },
  { name: 'inferno', args: '[goal]', description: 'Maximum-power preset with OSS discovery, full implementation, and evolution', options: ['--profile <type>', '--prompt', '--worktree', '--isolation', '--max-repos <n>', '--with-design', '--design-prompt <text>', '--local-sources <paths>', '--local-depth <level>', '--local-config <path>'], group: 'Automation' },
  { name: 'autoforge', args: '[goal]', description: 'Deterministic auto-orchestration of the full DanteForge pipeline', options: ['--dry-run', '--max-waves <n>', '--profile <type>', '--parallel', '--worktree', '--light', '--prompt', '--score-only', '--auto', '--force'], group: 'Automation' },
  { name: 'autoresearch', args: '<goal>', description: 'Autonomous metric-driven optimization loop', options: ['--metric <metric>', '--time <budget>', '--prompt', '--dry-run'], group: 'Automation' },
  { name: 'party', description: 'Launch multi-agent collaboration mode', options: ['--worktree', '--isolation', '--figma', '--skip-ux', '--design', '--no-design'], group: 'Automation' },

  { name: 'design', args: '<prompt>', description: 'Generate design artifacts via OpenPencil Design-as-Code engine', options: ['--prompt', '--light', '--format <type>', '--parallel', '--worktree'], group: 'Design' },
  { name: 'ux-refine', description: 'Explicit UX refinement via OpenPencil or Figma', options: ['--prompt', '--light', '--host <type>', '--figma-url <url>', '--token-file <path>', '--skip-ux', '--after-forge', '--openpencil', '--lint', '--live', '--url <url>'], group: 'Design' },
  { name: 'browse', args: '<subcommand> [args...]', description: 'Browser automation - navigate, screenshot, inspect live apps', options: ['--url <url>', '--port <port>'], group: 'Design' },
  { name: 'qa', description: 'Structured QA pass with health score on live app', options: ['--url <url> (required)', '--type <mode>', '--baseline <path>', '--save-baseline', '--fail-below <score>'], group: 'Design' },

  { name: 'tech-decide', description: 'Guided tech stack selection - 3-5 options per category with pros/cons', options: ['--prompt', '--auto'], group: 'Intelligence' },
  { name: 'debug', args: '<issue>', description: 'Systematic 4-phase debugging framework', options: ['--prompt'], group: 'Intelligence' },
  { name: 'lessons', args: '[correction]', description: 'Self-improving lessons - capture corrections, view rules, auto-compact', options: ['--prompt', '--compact'], group: 'Intelligence' },
  { name: 'oss', description: 'Auto-detect project, search OSS, clone, license-gate, scan, extract patterns, report', options: ['--prompt', '--dry-run', '--max-repos <n>'], group: 'Intelligence' },
  { name: 'local-harvest', args: '[paths...]', description: 'Harvest patterns from local private repos, folders, and zip archives', options: ['--config <path>', '--depth <level>', '--prompt', '--dry-run', '--max-sources <n>'], group: 'Intelligence' },
  { name: 'harvest', args: '<system>', description: 'Titan Harvest V2 - constitutional harvest of OSS patterns with hash-verifiable ratification', options: ['--prompt', '--lite'], group: 'Intelligence' },
  { name: 'retro', description: 'Project retrospective with metrics, delta scoring, and trend tracking', options: ['--summary', '--cwd <path>'], group: 'Intelligence' },

  { name: 'config', description: 'Manage API keys and LLM provider settings', options: ['--set-key <provider:key>', '--delete-key <provider>', '--provider <name>', '--model <provider:model>', '--show'], group: 'Tools' },
  { name: 'setup', args: '<tool>', description: 'Interactive setup wizard for integrations (figma|assistants|goose)', options: ['--host <type>', '--assistants <list>', '--figma-url <url>', '--token-file <path>', '--no-test'], group: 'Tools' },
  { name: 'doctor', description: 'System health check and diagnostics', options: ['--fix', '--live'], group: 'Tools' },
  { name: 'dashboard', description: 'Launch progress dashboard (local HTML, auto-closes in 5 min)', options: ['--port <number>'], group: 'Tools' },
  { name: 'compact', description: 'Compact audit log - summarize old entries to save context', options: [], group: 'Tools' },
  { name: 'import', args: '<file>', description: 'Import an LLM-generated file into .danteforge/', options: ['--as <name>'], group: 'Tools' },
  { name: 'skills import', description: 'Import one Antigravity bundle into the packaged skills catalog', options: ['--from <source> (required)', '--bundle <name>', '--allow-overwrite', '--enhance'], group: 'Tools' },
  { name: 'ship', description: 'Paranoid release guidance + version bump plan + changelog draft', options: ['--dry-run', '--skip-review'], group: 'Tools' },

  { name: 'help', args: '[query]', description: 'Context-aware guidance engine', options: [], group: 'Meta' },
  { name: 'review', description: 'Scan existing repo -> generate CURRENT_STATE.md', options: ['--prompt'], group: 'Meta' },
  { name: 'feedback', description: 'Generate prompt from UPR.md for LLM refinement', options: ['--auto'], group: 'Meta' },
  { name: 'update-mcp', description: 'Manual MCP self-healing - check for protocol updates', options: ['--prompt', '--apply', '--check'], group: 'Meta' },
  { name: 'awesome-scan', description: 'Discover, classify, and import skills across all sources', options: ['--source <path>', '--domain <type>', '--install'], group: 'Meta' },
  { name: 'docs', description: 'Generate or update the command reference documentation', options: [], group: 'Meta' },
];

function formatCommandReference(): string {
  const groups = new Map<string, CommandEntry[]>();
  for (const cmd of COMMAND_REGISTRY) {
    const list = groups.get(cmd.group) ?? [];
    list.push(cmd);
    groups.set(cmd.group, list);
  }

  const lines: string[] = [
    '# DanteForge Command Reference',
    '',
    `> Auto-generated by \`danteforge docs\`. ${COMMAND_REGISTRY.length} commands across ${groups.size} categories.`,
    '',
    '## Table of Contents',
    '',
  ];

  for (const group of groups.keys()) {
    lines.push(`- [${group}](#${group.toLowerCase()})`);
  }
  lines.push('');

  for (const [group, cmds] of groups) {
    lines.push(`## ${group}`, '');
    for (const cmd of cmds) {
      const usage = cmd.args
        ? `danteforge ${cmd.name} ${cmd.args}`
        : `danteforge ${cmd.name}`;
      lines.push(`### \`${usage}\``, '');
      lines.push(cmd.description, '');
      if (cmd.options.length > 0) {
        lines.push('**Options:**', '');
        for (const opt of cmd.options) {
          lines.push(`- \`${opt}\``);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

export async function docs(): Promise<void> {
  return withErrorBoundary('docs', async () => {
  const cwd = process.cwd();
  const timestamp = new Date().toISOString();

  logger.info('Generating command reference...');

  const markdown = formatCommandReference();
  const docsDir = path.join(cwd, 'docs');
  await fs.mkdir(docsDir, { recursive: true });
  const outputPath = path.join(docsDir, 'COMMAND_REFERENCE.md');
  await fs.writeFile(outputPath, markdown);

  logger.success(`Command reference written to: ${outputPath}`);
  logger.info(`${COMMAND_REGISTRY.length} commands documented.`);

  try {
    const state = await loadState();
    state.auditLog.push(
      `${timestamp} | docs: generated COMMAND_REFERENCE.md (${COMMAND_REGISTRY.length} commands)`,
    );
    await saveState(state);
  } catch {
    // Best-effort audit log only.
  }
  });
}
