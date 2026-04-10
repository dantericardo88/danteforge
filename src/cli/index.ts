#!/usr/bin/env node
// Main CLI entry
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import * as commands from './commands/index.js';
import { loadState } from '../core/state.js';
import { logger } from '../core/logger.js';
import { enforceWorkflow } from '../core/workflow-enforcer.js';
import { formatAndLogError } from '../core/format-error.js';
import { logCommandStart, logCommandEnd } from '../core/structured-audit.js';

// Helper to wrap command actions with audit logging
function withAuditLogging(commandName: string, action: (...args: any[]) => any) {
  return async (...args: any[]) => {
    const correlationId = logCommandStart(commandName, undefined, process.cwd());
    const startTime = Date.now();
    try {
      const result = await action(...args);
      logCommandEnd(commandName, correlationId, 'success', Date.now() - startTime, process.cwd());
      return result;
    } catch (error) {
      logCommandEnd(commandName, correlationId, 'failure', Date.now() - startTime, process.cwd());
      throw error;
    }
  };
}

const program = new Command();
program
  .name('danteforge')
  .description('Agentic development CLI - structured specs, execution waves, multi-agent orchestration')
  .version(process.env.DANTEFORGE_VERSION ?? '0.0.0-dev')
  .option('--quiet', 'Suppress all output except errors')
  .option('--verbose', 'Enable verbose/debug output');

program
  .command('init')
  .description('Interactive first-run wizard — detect project, check health, show next steps')
  .option('--non-interactive', 'Skip wizard questions (for CI/scripts)')
  .action((opts) => commands.init({ nonInteractive: opts.nonInteractive }));

program
  .command('constitution')
  .description('Initialize project constitution and principles')
  .action(withAuditLogging('constitution', commands.constitution));

program
  .command('specify <idea>')
  .description('High-level idea -> full spec artifacts')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .option('--ceo-review', 'Apply founder/CEO intent elevation before writing SPEC.md')
  .option('--refine', 'Inject PDSE score as context for iterative improvement')
  .action(withAuditLogging('specify', async (idea, opts) => await commands.specify(idea, opts)));

program
  .command('clarify')
  .description('Run clarification Q&A on current spec')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .action(withAuditLogging('clarify', commands.clarify));

program
  .command('plan')
  .description('Generate detailed plan from spec')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .option('--ceo-review', 'Apply CEO-level strategic review before writing PLAN.md')
  .option('--refine', 'Inject PDSE score as context for iterative improvement')
  .action(withAuditLogging('plan', commands.plan));

program
  .command('skills import')
  .description('Import Antigravity skill bundle')
  .action(withAuditLogging('skills-import', commands.skillsImport));

program
  .command('config')
  .description('Manage API keys and LLM provider settings')
  .option('--set-key <provider:key>', 'Set API key (e.g., "grok:xai-abc123")')
  .option('--delete-key <provider>', 'Remove a stored API key')
  .option('--provider <name>', 'Set default provider (grok, claude, openai, gemini, ollama)')
  .option('--model <provider:model>', 'Set model for provider (e.g., "grok:grok-3")')
  .option('--show', 'Show current configuration')
  .action(withAuditLogging('config', commands.configCmd));

program
  .command('debug <issue>')
  .description('Systematic 4-phase debugging framework')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .action(withAuditLogging('debug', async (issue, opts) => await commands.debug(issue, opts)));

program
  .command('compact')
  .description('Compact audit log - summarize old entries to save context')
  .action(withAuditLogging('compact', commands.compact));

program
  .command('setup')
  .argument('<tool>', 'Tool to set up (figma|assistants|ollama)')
  .description('Interactive setup wizard for integrations')
  .option('--host <type>', 'Specify host editor', 'auto')
  .option('--assistants <list>', 'Comma-separated assistant list (claude,codex,antigravity|gemini,opencode,cursor,all). Defaults to user-level assistants only; cursor is explicit.')
  .option('--figma-url <url>', 'Figma file URL')
  .option('--token-file <path>', 'Design tokens file path')
  .option('--no-test', 'Skip connection test')
  .addHelpText('after', '\nSubcommands: figma, assistants, ollama')
  .action(withAuditLogging('setup', async (tool: string, options) => {
    if (tool === 'figma') return commands.setupFigma(options);
    if (tool === 'assistants') return commands.setupAssistants(options);
    if (tool === 'ollama') {
      if (options.host === 'codex') {
        logger.info('Native Codex workflows already use the host model/session — no Ollama required for Codex.');
        logger.info('Codex executes workflow commands through its own model context automatically.');
      }
      logger.info('Install Ollama from https://ollama.com/download');
      logger.info('Recommended spend-saver model: qwen2.5-coder:7b');
      logger.info('After install: ollama pull qwen2.5-coder:7b');
      logger.info('Then set in DanteForge: danteforge config --set-key "ollama:qwen2.5-coder:7b"');
      return;
    }
    logger.error(`Unknown tool: ${tool}. Available: figma, assistants`);
  }));

program
  .command('doctor')
  .description('System health check and diagnostics')
  .option('--fix', 'Attempt to auto-fix issues')
  .option('--live', 'Run live connectivity checks for providers, upstreams, registries, and Figma MCP')
  .action(withAuditLogging('doctor', commands.doctor));

program
  .command('dashboard')
  .description('Launch progress dashboard (local HTML, auto-closes in 5 min)')
  .option('--port <number>', 'Port to serve on', '4242')
  .action(withAuditLogging('dashboard', commands.dashboard));

program
  .command('spark [goal]')
  .description('Zero-token planning preset: review -> constitution -> specify -> clarify -> tech-decide -> plan -> tasks')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--skip-tech-decide', 'Skip the tech-decide step when the stack is already decided')
  .action(withAuditLogging('spark', async (goal, opts) => await commands.spark(goal, {
    prompt: opts.prompt,
    skipTechDecide: opts.skipTechDecide,
  })));

program
  .command('ember [goal]')
  .description('Very low-token preset for quick features and light checkpoints')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .action(withAuditLogging('ember', async (goal, opts) => await commands.ember(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
  })));

program
  .command('canvas [goal]')
  .description('Design-first frontend preset: design -> autoforge -> ux-refine -> verify')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--design-prompt <text>', 'Override the prompt passed to the design step')
  .action(withAuditLogging('canvas', async (goal, opts) => await commands.canvas(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
    designPrompt: opts.designPrompt,
  })));

program
  .command('self-improve [goal]')
  .description('Run autonomous quality loop until target score achieved')
  .option('--level <number>', 'Target maturity level (1-6)', '4')
  .option('--profile <type>', 'quality | balanced | budget', 'quality')
  .option('--prompt', 'Generate the improvement plan without executing')
  .action(withAuditLogging('self-improve', async (goal, opts) => await commands.selfImprove({
    goal,
    minScore: parseFloat(opts.level) * 1.5, // Convert level to score
    maxCycles: 20,
    preset: opts.profile,
    cwd: opts.cwd,
  })));

program
  .command('performance')
  .description('Performance monitoring and regression detection')
  .option('--monitor', 'Show performance metrics')
  .option('--costs', 'Show cost tracking')
  .option('--baseline', 'Update performance baseline')
  .option('--check', 'Check for performance regression')
  .action(withAuditLogging('performance', async (opts) => {
    try {
      await commands.performance(opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Performance command failed: ${message}`);
      console.error('Usage: danteforge performance --help');
      process.exit(1);
    }
  }));

program
  .command('wiki-lint')
  .description('Run self-evolution scan: contradictions, staleness, link integrity, pattern synthesis')
  .option('--heuristic-only', 'Skip LLM calls (zero-cost mode)')
  .option('--prompt', 'Show the command without executing')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('wiki-lint', async (opts) => void commands.wikiLintCommand({
    heuristicOnly: opts.heuristicOnly,
    prompt: opts.prompt,
    cwd: opts.cwd,
  })));

program
  .command('wiki-query <topic>')
  .description('Search wiki for entity pages, decisions, and patterns relevant to a topic')
  .option('--json', 'Output machine-readable JSON')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('wiki-query', async (topic, opts) => void commands.wikiQueryCommand({
    topic,
    json: opts.json,
    cwd: opts.cwd,
  })));

program
  .command('wiki-status')
  .description('Display wiki health metrics: pages, link density, staleness, lint pass rate, anomalies')
  .option('--json', 'Output machine-readable JSON')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('wiki-status', async (opts) => void commands.wikiStatusCommand({
    json: opts.json,
    cwd: opts.cwd,
  })));

program
  .command('wiki-export')
  .description('Export compiled wiki as Obsidian vault or static HTML')
  .option('--format <type>', 'Export format: obsidian or html (default: obsidian)', 'obsidian')
  .option('--out <dir>', 'Output directory path')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('wiki-export', async (opts) => void commands.wikiExportCommand({
    format: opts.format as 'obsidian' | 'html',
    out: opts.out,
    cwd: opts.cwd,
  })));

program
  .command('quickstart [idea]')
  .description('Guided 5-minute path: init → constitution → spark → PDSE score')
  .option('--non-interactive', 'Skip all prompts (CI mode)')
  .action(withAuditLogging('quickstart', async (idea, opts) => void commands.quickstart({ idea, nonInteractive: opts.nonInteractive })));

program
  .command('plugin <subcommand> [args...]')
  .description('Manage community skill plugins: install, list, remove')
  .action(withAuditLogging('plugin', async (subcommand: string, args: string[]) => {
    await commands.pluginCommand(subcommand as 'install' | 'list' | 'remove', args ?? []);
  }));



program
  .command('benchmark-llm')
  .description('Run A/B LLM benchmark: raw prompt vs DanteForge-structured context')
  .argument('[task]', 'Task description to benchmark')
  .option('--compare', 'Show historical comparison')
  .option('--no-save', 'Skip saving results')
  .action(withAuditLogging('benchmark-llm', async (task: string | undefined, opts: { compare?: boolean; save?: boolean }) => {
    await commands.benchmarkLLM({ task, compare: opts.compare, save: opts.save });
  }));

program
  .command('explain [term]')
  .description('Plain-English glossary — explain any DanteForge term or list all terms')
  .option('--list', 'List all glossary terms with one-line descriptions')
  .action(withAuditLogging('explain', async (term, opts) => await commands.explain({ term, list: opts.list })));

program
  .command('pack [output]')
  .description('Pack workspace into a single AI-ready context bundle (Repomix-style)')
  .option('--format <type>', 'Output format: xml | markdown | plain', 'markdown')
  .option('--include <patterns>', 'Comma-separated glob patterns to include')
  .option('--exclude <patterns>', 'Comma-separated patterns to exclude')
  .option('--token-count', 'Show token summary only (no file content)')
  .option('--no-gitignore', 'Ignore .gitignore patterns')
  .action(withAuditLogging('pack', async (output, opts) => void commands.pack({
    output,
    format: opts.format as 'xml' | 'markdown' | 'plain',
    include: opts.include?.split(',').map((s: string) => s.trim()).filter(Boolean),
    exclude: opts.exclude?.split(',').map((s: string) => s.trim()).filter(Boolean),
    tokenCount: opts.tokenCount,
    gitignore: opts.gitignore !== false,
  })));

program
  .command('ci-setup')
  .description('Generate CI/CD pipeline config with DanteForge quality gate (GitHub/GitLab/Bitbucket)')
  .option('--provider <name>', 'CI provider: github | gitlab | bitbucket', 'github')
  .option('--branch <name>', 'Branch to trigger on', 'main')
  .option('--output-dir <path>', 'Override output directory for the generated file')
  .action(withAuditLogging('ci-setup', async (opts) => void commands.ciSetup({
    provider: opts.provider as 'github' | 'gitlab' | 'bitbucket',
    branch: opts.branch,
    outputDir: opts.outputDir,
  })));

program
  .command('proof')
  .description('Measure AI context quality improvement — compare raw prompt vs DanteForge structured artifacts')
  .option('--prompt <text>', 'Raw prompt to score against DanteForge artifacts')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('proof', async (opts) => void commands.proof({
    prompt: opts.prompt,
    cwd: opts.cwd ?? process.cwd(),
  })));

program
  .command('sync-context')
  .description('Generate project-specific context files for Cursor, Claude Code, and Codex from live state')
  .option('--target <name>', 'Target tool: cursor | claude | codex | all (default: all)', 'all')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('sync-context', async (opts) => void commands.syncContext({
    target: opts.target as 'cursor' | 'claude' | 'codex' | 'all',
    cwd: opts.cwd ?? process.cwd(),
  })));

program
  .command('demo')
  .description('Show DanteForge proof of value — before/after AI context quality scores (zero setup)')
  .option('--fixture <name>', 'Demo fixture: task-tracker | auth-system | data-pipeline', 'task-tracker')
  .option('--all', 'Run all demo fixtures')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('demo', async (opts) => void commands.demo({
    fixture: opts.fixture,
    all: opts.all,
    cwd: opts.cwd ?? process.cwd(),
  })));

program
  .command('completion [shell]')
  .description('Output shell completion script (bash, zsh, fish)')
  .addHelpText('after', '\nUsage:\n  eval "$(danteforge completion bash)"   # add to ~/.bashrc\n  eval "$(danteforge completion zsh)"    # add to ~/.zshrc\n  danteforge completion fish > ~/.config/fish/completions/danteforge.fish')
  .action(withAuditLogging('completion', async (shell) => { await commands.completionCmd(shell); }));

program
  .command('commit')
  .description('Stage changed files and commit with task-derived message')
  .option('--message <msg>', 'Override generated commit message')
  .option('--push', 'Also push after committing')
  .action(withAuditLogging('commit', async (opts) => { await commands.gitCommit({ message: opts.message, push: opts.push }); }));

program
  .command('branch')
  .description('Create git branch from current task state')
  .option('--name <name>', 'Override generated branch name')
  .action(withAuditLogging('branch', async (opts) => { await commands.gitBranch({ name: opts.name }); }));

program
  .command('pr')
  .description('Generate PR body from spec and plan, then open PR via gh CLI')
  .option('--draft', 'Create draft PR')
  .option('--base <branch>', 'Base branch for PR')
  .option('--title <title>', 'Override PR title')
  .action(withAuditLogging('pr', async (opts) => { await commands.gitPR({ draft: opts.draft, base: opts.base, title: opts.title }); }));

loadState().catch(() => { /* state will be created on first write */ });

program
  .command('enterprise-readiness')
  .description('Generate enterprise readiness report')
  .option('--format <type>', 'Output format: json, markdown, html', 'json')
  .option('--include-audit', 'Include audit logging analysis')
  .action(withAuditLogging('enterprise-readiness', async (opts) => {
    try {
      const { enterpriseReadiness } = await import('./commands/enterprise-readiness.js');
      await enterpriseReadiness(opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Enterprise-readiness command failed: ${message}`);
      console.error('Usage: danteforge enterprise-readiness --help');
      process.exit(1);
    }
  }));

program
  .command('assess')
  .description('Harsh self-assessment: score all 18 dimensions, benchmark vs 27 competitors')
  .option('--no-harsh', 'Use normal PDSE thresholds instead of harsh mode')
  .option('--no-competitors', 'Skip competitor benchmarking')
  .option('--min-score <n>', 'Target score threshold (default: 9.0)')
  .option('--json', 'Output machine-readable JSON')
  .option('--preset <level>', 'Preset for target maturity level')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('assess', async (opts) => {
    try {
      await commands.assess(opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Assess command failed: ${message}`);
      console.error('Usage: danteforge assess --help');
      process.exit(1);
    }
  }));

program
  .command('verify')
  .description('Run verification checks against current implementation')
  .option('--release', 'Run release verification checks')
  .option('--live', 'Include live integration tests')
  .option('--url <url>', 'Base URL for live checks')
  .option('--recompute', 'Force recomputation of all checks')
  .option('--json', 'Output machine-readable JSON')
  .action(withAuditLogging('verify', async (opts) => {
    try {
      await commands.verify(opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Verify command failed: ${message}`);
      console.error('Usage: danteforge verify --help');
      process.exit(1);
    }
  }));

// v0.19.0 — CLI safety handlers: surface uncaught errors instead of silent exit
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${String(reason instanceof Error ? reason.message : reason)}`);
  process.exit(1);
});

program.parse(process.argv);
