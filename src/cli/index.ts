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
  .action(commands.plan);

program
  .command('plan')
  .description('Generate detailed plan from spec')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .action(withAuditLogging('plan', commands.plan));

program
  .command('design <prompt>')
  .description('Generate design artifacts from prompt')
  .option('--format', 'Output format (op, figma)')
  .option('--parallel', 'Run in parallel')
  .option('--worktree', 'Use isolated git worktree')
  .action(withAuditLogging('design', async (prompt, opts) => await commands.design(prompt, opts)));

program
  .command('ux-refine')
  .description('UX refinement with OpenPencil or Figma')
  .option('--openpencil', 'Use OpenPencil extraction')
  .option('--figma-url <url>', 'Figma file URL')
  .option('--live', 'Enable live mode')
  .option('--lint', 'Run accessibility linting')
  .action(withAuditLogging('ux-refine', commands.uxRefine));

program
  .command('forge [phase]')
  .description('Execute development waves')
  .option('--parallel', 'Run tasks in parallel')
  .option('--profile <type>', 'Quality profile (quality, balanced, budget)')
  .option('--worktree', 'Use isolated git worktree')
  .option('--light', 'Skip hard gates')
  .action(withAuditLogging('forge', async (phase, opts) => await commands.forge(phase, opts)));

program
  .command('party')
  .description('Launch multi-agent collaboration mode')
  .option('--worktree', 'Create isolated worktrees for each agent')
  .option('--isolation', 'Run each agent through subagent isolation and dual-stage review')
  .option('--figma', 'Legacy compatibility flag; use ux-refine separately for Figma workflows')
  .option('--skip-ux', 'Skip UX refinement even with --figma')
  .option('--design', 'Activate Design Agent for UI generation via OpenPencil')
  .option('--no-design', 'Exclude Design Agent from party mode')
  .action(commands.party);

program
  .command('review')
  .description('Scan existing repo -> generate CURRENT_STATE.md')
  .option('--prompt', 'Generate a copy-paste prompt for Claude Code / ChatGPT instead of local/API')
  .action(commands.review);

program
  .command('browse <subcommand> [args...]')
  .description('Browser automation — navigate, screenshot, inspect live apps')
  .option('--url <url>', 'Target URL (shorthand for goto)')
  .option('--port <port>', 'Override browse daemon port', '9400')
  .action(commands.browse);

program
  .command('qa')
  .description('Structured QA pass with health score on live app')
  .requiredOption('--url <url>', 'Staging or production URL to test')
  .option('--type <mode>', 'QA mode: full | quick | regression', 'full')
  .option('--baseline <path>', 'Baseline JSON for regression comparison')
  .option('--save-baseline', 'Save current report as new baseline')
  .option('--fail-below <score>', 'Exit code 1 if score below threshold', '0')
  .action(commands.qa);

program
  .command('party')
  .description('Launch multi-agent collaboration mode')
  .option('--worktree', 'Use isolated git worktree')
  .option('--isolation', 'Run agents in isolated environments')
  .option('--design', 'Include design agents')
  .action(withAuditLogging('party', commands.party));

program
  .command('review')
  .description('Scan repo and generate CURRENT_STATE.md')
  .option('--prompt', 'Generate prompt instead of executing')
  .action(withAuditLogging('review', commands.review));

program
  .command('verify')
  .description('Run verification checks')
  .option('--release', 'Include release checks')
  .option('--live', 'Include live integration checks')
  .option('--url <url>', 'URL for live verification')
  .option('--recompute', 'Force recomputation')
  .option('--json', 'Output JSON format')
  .action(withAuditLogging('verify', commands.verify));

program
  .command('synthesize')
  .description('Generate Ultimate Planning Resource (UPR.md) from all artifacts')
  .action(withAuditLogging('synthesize', commands.synthesize));

program
  .command('feedback')
  .description('Generate prompt from UPR.md for LLM refinement (closes the loop)')
  .option('--auto', 'Send directly to a live provider instead of generating a copy-paste prompt')
  .action(withAuditLogging('feedback', commands.feedbackPrompt));

program
  .command('import <file>')
  .description('Import an LLM-generated file into .danteforge/')
  .option('--as <name>', 'Save as a specific filename (default: keep original name)')
  .action(withAuditLogging('import', async (file, opts) => await commands.importFile(file, opts)));

const skillsCommand = program
  .command('skills')
  .description('Manage DanteForge skill catalogs and imports')
  .addHelpText('after', '\nSubcommands: import --from <source> [--bundle <name>] [--allow-overwrite] [--enhance]');

skillsCommand
  .command('import')
  .description('Import one Antigravity bundle into the packaged DanteForge skills catalog, or export skills to an agent tool directory')
  .option('--from <source>', 'Source catalog to import from (antigravity)')
  .option('--bundle <name>', 'Bundle name from docs/BUNDLES.md (default: Essentials)')
  .option('--allow-overwrite', 'Replace an existing packaged skill when the imported skill name collides')
  .option('--enhance', 'Apply DanteForge wrappers to imported skills')
  .option('--export', 'Export packaged skills to a target agent tool directory')
  .option('--target <agent>', 'Export target: claude-code, codex, cursor, windsurf, or all (default: claude-code)')
  .action(commands.skillsImport);

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
  .command('magic [goal]')
  .description('Balanced preset and default hero command for most follow-up work')
  .option('--level <level>', 'spark | ember | canvas | magic | blaze | nova | inferno', 'magic')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--skip-ux', 'Skip UX refinement')
  .option('--host <type>', 'Specify host editor for MCP', 'auto')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--worktree', 'Run heavy preset execution inside an isolated git worktree')
  .option('--isolation', 'Use isolation when a preset escalates into party mode')
  .option('--max-repos <n>', 'Maximum repos for inferno OSS discovery', '12')
  .action(withAuditLogging('magic', async (goal, opts) => await commands.magic(goal, {
    level: opts.level,
    profile: opts.profile,
    skipUx: opts.skipUx,
    host: opts.host,
    prompt: opts.prompt,
    worktree: opts.worktree,
    isolation: opts.isolation,
    maxRepos: parseInt(opts.maxRepos, 10),
  })));

program
  .command('blaze [goal]')
  .description('High-power preset: full party + strong autoforge + synthesize + retro + self-improve')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--worktree', 'Run in an isolated git worktree')
  .option('--isolation', 'Run party with isolation enabled')
  .option('--with-design', 'Add design + ux-refine steps to the pipeline')
  .option('--design-prompt <text>', 'Prompt to pass to the design step')
  .action(withAuditLogging('blaze', async (goal, opts) => await commands.blaze(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
    worktree: opts.worktree,
    isolation: opts.isolation,
    withDesign: opts.withDesign,
    designPrompt: opts.designPrompt,
  })));

program
  .command('nova [goal]')
  .description('Very-high-power preset: planning prefix + blaze execution + inferno polish (no OSS)')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--worktree', 'Run in an isolated git worktree')
  .option('--isolation', 'Run party with isolation enabled')
  .option('--tech-decide', 'Add a tech-decide step after the planning prefix')
  .option('--with-design', 'Add design + ux-refine steps to the pipeline')
  .option('--design-prompt <text>', 'Prompt to pass to the design step')
  .action(withAuditLogging('nova', async (goal, opts) => await commands.nova(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
    worktree: opts.worktree,
    isolation: opts.isolation,
    withTechDecide: opts.techDecide,
    withDesign: opts.withDesign,
    designPrompt: opts.designPrompt,
  })));

program
  .command('inferno [goal]')
  .description('Maximum-power preset: OSS mining + full implementation + evolution')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--worktree', 'Run in an isolated git worktree')
  .option('--isolation', 'Run party with isolation enabled')
  .option('--max-repos <n>', 'Maximum repos for OSS discovery', '12')
  .option('--with-design', 'Add design + ux-refine steps to the pipeline')
  .option('--design-prompt <text>', 'Prompt to pass to the design step')
  .option('--local-sources <paths>', 'Comma-separated local repo or folder paths to harvest first')
  .option('--local-depth <level>', 'Harvest depth for local sources: shallow|medium|full', 'medium')
  .option('--local-config <path>', 'YAML config file listing local sources')
  .action(withAuditLogging('inferno', async (goal, opts) => await commands.inferno(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
    worktree: opts.worktree,
    isolation: opts.isolation,
    maxRepos: parseInt(opts.maxRepos, 10),
    withDesign: opts.withDesign,
    designPrompt: opts.designPrompt,
    localSources: opts.localSources?.split(',').map((source: string) => source.trim()).filter(Boolean),
    localDepth: opts.localDepth,
    localSourcesConfig: opts.localConfig,
  })));

program
  .command('workflow')
  .description('Show the 12-stage pipeline with your current position highlighted')
  .action(withAuditLogging('workflow', async () => {
    const { workflow } = await import('./commands/workflow.js');
    await workflow();
  }));

program
  .command('help [query]')
  .description('Context-aware guidance engine')
  .action(withAuditLogging('help', async (query) => await commands.helpCmd(query)));

program
  .command('docs')
  .description('Generate or update the command reference documentation')
  .action(withAuditLogging('docs', commands.docs));

program
  .command('update-mcp')
  .description('Manual MCP self-healing - check for protocol updates and apply safely')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--apply', 'Apply recommended updates after review')
  .option('--check', 'Check-only mode (no changes)')
  .action(withAuditLogging('update-mcp', commands.updateMcp));

program
  .command('tech-decide')
  .description('Guided tech stack selection - 3-5 options per category with pros/cons')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--auto', 'Accept all recommended defaults without interactive review')
  .action(withAuditLogging('tech-decide', commands.techDecide));

program
  .command('lessons [correction]')
  .description('Self-improving lessons - capture corrections, view rules, auto-compact')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--compact', 'Force compaction of lessons file')
  .action(withAuditLogging('lessons', async (correction, opts) => await commands.lessons(correction, opts)));

program
  .command('autoforge [goal]')
  .description('Deterministic auto-orchestration of the full DanteForge pipeline')
  .option('--dry-run', 'Show plan without executing')
  .option('--max-waves <n>', 'Max steps before checkpoint', '3')
  .option('--profile <type>', 'quality | balanced | budget', 'balanced')
  .option('--parallel', 'Run forge steps in parallel lanes when execution begins')
  .option('--worktree', 'Run forge steps in an isolated git worktree')
  .option('--light', 'Skip hard gates')
  .option('--prompt', 'Generate copy-paste prompt describing what autoforge would do')
  .option('--score-only', 'Score existing artifacts and write AUTOFORGE_GUIDANCE.md — no execution')
  .option('--auto', 'Run autonomous loop until 95% completion or BLOCKED state')
  .option('--force', 'Override one BLOCKED artifact for one cycle (logged to audit trail)')
  .option('--pause-at <score>', 'Pause the loop when average PDSE score reaches this value')
  .action(withAuditLogging('autoforge', async (goal, opts) => await commands.autoforge(goal, {
    dryRun: opts.dryRun,
    maxWaves: parseInt(opts.maxWaves, 10),
    light: opts.light,
    prompt: opts.prompt,
    scoreOnly: opts.scoreOnly,
    auto: opts.auto,
    force: opts.force,
    profile: opts.profile,
    parallel: opts.parallel,
    worktree: opts.worktree,
    pauseAt: opts.pauseAt !== undefined ? parseInt(opts.pauseAt, 10) : undefined,
  })));

program
  .command('resume')
  .description('Resume a paused autoforge loop from the last checkpoint')
  .action(withAuditLogging('resume', async () => await commands.resumeAutoforge()));

program
  .command('awesome-scan')
  .description('Discover, classify, and import skills across all sources')
  .option('--source <path>', 'Scan an external directory for skills')
  .option('--domain <type>', 'Filter by domain (security|fullstack|devops|ux|backend|frontend|data|testing|architecture|general)')
  .option('--install', 'Import compatible external skills')
  .action(withAuditLogging('awesome-scan', commands.awesomeScan));

program
  .command('profile [subcommand] [arg]')
  .description('Model personality profiles — view learned behavioral patterns per model')
  .option('--prompt', 'Generate a copy-paste prompt instead of displaying')
  .addHelpText('after', '\nSubcommands: (none)=summary, compare, report, weakness <model>, recommend <task>')
  .action(withAuditLogging('profile', async (subcommand, arg, opts) => await commands.profile(subcommand, arg, { prompt: opts.prompt })));

program
  .command('retro')
  .description('Project retrospective with metrics, delta scoring, and trend tracking')
  .option('--summary', 'Print trend summary of last 5 retros')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('retro', commands.retro));

program
  .command('maturity')
  .description('Assess current code maturity level with founder-friendly quality report')
  .option('--preset <level>', 'Target preset level (spark|ember|canvas|magic|blaze|nova|inferno)')
  .option('--json', 'Output JSON instead of plain text')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('maturity', async (opts) => await commands.maturity({
    preset: opts.preset,
    json: opts.json,
    cwd: opts.cwd,
  })));

program
  .command('ship')
  .description('Paranoid release guidance + version bump plan + changelog draft')
  .option('--dry-run', 'Run checks and generate guidance without changing the audit intent')
  .option('--skip-review', 'Skip pre-landing review (emergency only, logged to audit)')
  .action(withAuditLogging('ship', commands.ship));

program
  .command('oss')
  .description('Auto-detect project, search OSS, clone, license-gate, scan, extract patterns, report')
  .option('--prompt', 'Generate a copy-paste research plan prompt instead of executing')
  .option('--dry-run', 'Show what would be searched without cloning')
  .option('--max-repos <n>', 'Maximum repos to clone and analyze (default: 8)', '8')
  .action(withAuditLogging('oss', async (opts) => await commands.ossResearcher({
    prompt: opts.prompt,
    dryRun: opts.dryRun,
    maxRepos: opts.maxRepos,
  })));

program
  .command('local-harvest [paths...]')
  .description('Harvest patterns from local private repos, folders, and zip archives')
  .option('--config <path>', 'YAML config file listing sources (.danteforge/local-sources.yaml)')
  .option('--depth <level>', 'shallow | medium | full (default: medium)', 'medium')
  .option('--prompt', 'Show harvest plan without executing')
  .option('--dry-run', 'Detect source types without reading')
  .option('--max-sources <n>', 'Maximum sources to analyze (default: 5)', '5')
  .action(withAuditLogging('local-harvest', async (paths, opts) => await commands.localHarvest(paths ?? [], {
    config: opts.config,
    depth: opts.depth,
    prompt: opts.prompt,
    dryRun: opts.dryRun,
    maxSources: parseInt(opts.maxSources, 10),
  })));

program
  .command('autoresearch <goal>')
  .description('Autonomous metric-driven optimization loop — plan, rewrite, execute, evaluate, keep winners')
  .option('--metric <metric>', 'How to measure success (e.g., "startup time ms", "bundle size KB")')
  .option('--time <budget>', 'Time budget (e.g., "4h", "30m")', '4h')
  .option('--prompt', 'Generate a copy-paste prompt instead of executing')
  .option('--dry-run', 'Show the experiment plan without running')
  .action(withAuditLogging('autoresearch', async (goal, opts) => await commands.autoResearch(goal, {
    metric: opts.metric,
    time: opts.time,
    prompt: opts.prompt,
    dryRun: opts.dryRun,
  })));

program
  .command('harvest <system>')
  .description('Titan Harvest V2 — 5-step constitutional harvest of OSS patterns with hash-verifiable ratification')
  .option('--prompt', 'Display the 5-step copy-paste template without calling the LLM')
  .option('--lite', 'Run in SEP-LITE mode (Steps 1-3 + 5 only, 2-3 donors, 2-4 organs)')
  .action(withAuditLogging('harvest', async (system) => await commands.harvest(system)));

program
  .command('premium [subcommand]')
  .description('Manage premium tier, license, and audit trail')
  .option('--key <key>', 'License key for activation')
  .option('--tier <tier>', 'License tier for keygen: pro or enterprise', 'pro')
  .option('--days <n>', 'Days until expiry for keygen (default: 365)', '365')
  .action(withAuditLogging('premium', async (subcommand, opts) => await commands.premium(subcommand ?? 'status', { key: opts.key, tier: opts.tier, days: opts.days })));

program
  .command('mcp-server')
  .description('Start DanteForge MCP server over stdio — for Claude Code, Codex, Cursor')
  .action(withAuditLogging('mcp-server', async () => await commands.mcpServer()));

program
  .command('publish-check')
  .description('Pre-publish validation gate — 12 parallel checks before npm publish')
  .option('--json', 'Output machine-readable JSON')
  .action(withAuditLogging('publish-check', async (opts) => await commands.publishCheck({ json: opts.json })));

program
  .command('audit-export')
  .description('Export audit trail to JSON, CSV, or Markdown for compliance reporting')
  .option('--format <type>', 'Output format: json, csv, markdown (default: json)', 'json')
  .option('--since <date>', 'Filter entries since ISO date (e.g., 2026-01-01)')
  .option('--output <path>', 'Write to file instead of stdout')
  .option('--json', 'Machine-readable JSON output')
  .action(withAuditLogging('audit-export', async (opts) => {
    const { auditExport } = await import('./commands/audit-export.js');
    await auditExport(opts);
  }));

program
  .command('assess')
  .description('Harsh self-assessment: score all 18 dimensions, benchmark vs 27 competitors, generate masterplan')
  .option('--no-harsh', 'Use normal PDSE thresholds instead of harsh mode')
  .option('--no-competitors', 'Skip competitor benchmarking')
  .option('--min-score <n>', 'Target score threshold (default: 9.0)', '9.0')
  .option('--json', 'Output machine-readable JSON')
  .option('--preset <level>', 'Preset for target maturity level')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('assess', async (opts) => {
    try {
      await commands.assess({
        harsh: opts.harsh !== false,
        competitors: opts.competitors !== false,
        minScore: parseFloat(opts.minScore),
        json: opts.json,
        preset: opts.preset,
        cwd: opts.cwd,
      });
    } catch (err) {
      formatAndLogError(err, 'assess');
      process.exitCode = 1;
    }
  }));

program
  .command('self-improve [goal]')
  .description('Autonomous quality loop: assess → forge gaps → verify → repeat until 9+/10')
  .option('--min-score <n>', 'Target score threshold (default: 9.0)', '9.0')
  .option('--max-cycles <n>', 'Safety limit on loop cycles (default: 20)', '20')
  .option('--focus <dimension>', 'Focus on a specific dimension')
  .option('--preset <level>', 'Preset for target maturity level')
  .option('--cwd <path>', 'Project directory')
  .action((goal, opts) => void commands.selfImprove({
    goal,
    minScore: parseFloat(opts.minScore),
    maxCycles: parseInt(opts.maxCycles, 10),
    focusDimensions: opts.focus ? [opts.focus] : undefined,
    preset: opts.preset,
    cwd: opts.cwd,
  }));

program
  .command('define-done')
  .description('Define what "9+" means — sets the completion target used by assess and self-improve')
  .option('--reset', 'Clear existing target and re-prompt')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('define-done', async (opts) => void commands.defineDone({
    reset: opts.reset,
    cwd: opts.cwd,
  })));

program
  .command('universe')
  .description('View the competitive feature universe — all unique capabilities across competitors, scored')
  .option('--refresh', 'Force rebuild of feature universe from competitors')
  .option('--json', 'Output machine-readable JSON')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('universe', async (opts) => void commands.universe({
    refresh: opts.refresh,
    json: opts.json,
    cwd: opts.cwd,
  })));

program
  .command('workspace <subcommand> [args...]')
  .description('Manage workspaces for multi-user projects')
  .option('--role <role>', 'Member role: owner, editor, reviewer', 'editor')
  .action(withAuditLogging('workspace', async (subcommand: string, args: string[], options: { role?: string }) => {
    await commands.workspace(subcommand, args ?? [], options);
  }));

// First-run detection — suggest init when no .danteforge/ exists
program.hook('preAction', (_thisCommand, actionCommand) => {
  const skip = new Set(['init', 'quickstart', 'config', 'doctor', 'help', 'setup', 'skills', 'docs', 'premium', 'workflow', 'mcp-server', 'publish-check', 'plugin', 'benchmark', 'benchmark-llm', 'explain', 'pack', 'ci-setup', 'proof', 'sync-context', 'demo', 'commit', 'branch', 'pr']);
  if (skip.has(actionCommand.name())) return;
  if (!existsSync('.danteforge')) {
    logger.info('Tip: No .danteforge/ directory found. Run "danteforge init" to set up your project.');
  }
});

program.hook('preAction', () => {
  const opts = program.opts();
  if (opts.quiet) logger.setLevel('error');
  else if (opts.verbose) logger.setLevel('verbose');
});

program.hook('preAction', async (_thisCommand, actionCommand) => {
  const opts = actionCommand.optsWithGlobals?.() ?? actionCommand.opts();
  await enforceWorkflow(actionCommand.name(), undefined, Boolean(opts.light));
});

// Command group help for discoverability
program.addHelpText('after', `
Command Groups:
  Pipeline:       init, constitution, specify, clarify, plan, tasks, forge, verify, synthesize
  Presets:        spark, ember, canvas, magic, blaze, nova, inferno
  Automation:     autoforge, autoresearch, party, resume
  Intelligence:   tech-decide, debug, lessons, profile, oss, local-harvest, harvest, retro, maturity
  Self-Assessment: assess, self-improve, define-done, universe
  Design & QA:    design, ux-refine, browse, qa, awesome-scan
  Git Integration: commit, branch, pr
  Setup & Health: config, setup, doctor, dashboard, mcp-server, sync-context, publish-check, premium
  Wiki:           wiki-ingest, wiki-lint, wiki-query, wiki-status, wiki-export
  Tools:          compact, import, skills, ship, pack, ci-setup, proof, benchmark, demo, plugin
  Meta:           help, review, feedback, docs, workflow, explain, completion, update-mcp, audit-export

Run "danteforge help <command>" for detailed help on any command.
Run "danteforge init" to set up a new project.

Preset ladder: spark → ember → canvas → magic → blaze → nova → inferno

Common flags:
  --light          Skip hard gates (constitution, spec, plan, tests)
  --prompt         Generate copy-paste prompt instead of auto-executing
  --profile <name> Use a specific quality profile (quality|balanced|budget)
  --worktree       Run in isolated git worktree
  --verbose        Show debug output

Shell completion:
  eval "\$(danteforge completion bash)"   # add to ~/.bashrc
  eval "\$(danteforge completion zsh)"    # add to ~/.zshrc
`);

program
  .command('wiki-ingest')
  .description('Ingest raw source files into compiled wiki entity pages')
  .option('--bootstrap', 'Seed wiki from existing .danteforge/ artifacts')
  .option('--prompt', 'Show the command without executing')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('wiki-ingest', async (opts) => void commands.wikiIngestCommand({
    bootstrap: opts.bootstrap,
    prompt: opts.prompt,
    cwd: opts.cwd,
  })));

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
  .command('benchmark')
  .description('Cross-project PDSE benchmarking and completion truthfulness harness')
  .option('--register', 'Register this project in global benchmark registry')
  .option('--compare', 'Show ranked table of all registered projects')
  .option('--report', 'Generate BENCHMARK_REPORT.md')
  .option('--harness', 'Run completion truthfulness benchmark harness')
  .option('--suite <id>', 'Benchmark suite to run (with --harness)')
  .option('--task <id>', 'Benchmark task to run (with --harness)')
  .option('--all', 'Run all benchmark suites (with --harness)')
  .option('--cwd <path>', 'Project directory')
  .action(withAuditLogging('benchmark', async (opts) => void commands.benchmark({
    register: opts.register,
    compare: opts.compare,
    report: opts.report,
    harness: opts.harness,
    suite: opts.suite,
    task: opts.task,
    all: opts.all,
    cwd: opts.cwd,
  })));

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
