#!/usr/bin/env node
// Main CLI entry
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import * as commands from './commands/index.js';
import { loadState } from '../core/state.js';
import { logger } from '../core/logger.js';
import { enforceWorkflow } from '../core/workflow-enforcer.js';

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
  .action(commands.init);

program
  .command('constitution')
  .description('Initialize project constitution and principles')
  .action(commands.constitution);

program
  .command('specify <idea>')
  .description('High-level idea -> full spec artifacts')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .option('--ceo-review', 'Apply founder/CEO intent elevation before writing SPEC.md')
  .option('--refine', 'Inject PDSE score as context for iterative improvement')
  .action(commands.specify);

program
  .command('clarify')
  .description('Run clarification Q&A on current spec')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .action(commands.clarify);

program
  .command('plan')
  .description('Generate detailed plan from spec')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .option('--ceo-review', 'Apply CEO-level strategic review before writing PLAN.md')
  .option('--refine', 'Inject PDSE score as context for iterative improvement')
  .action(commands.plan);

program
  .command('tasks')
  .description('Break plan into executable tasks')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .action(commands.tasks);

program
  .command('design <prompt>')
  .description('Generate design artifacts from natural language via OpenPencil Design-as-Code engine')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--light', 'Skip hard gates')
  .option('--format <type>', 'Export format: jsx | vue | html', 'jsx')
  .option('--parallel', 'Enable spatial parallel decomposition')
  .option('--worktree', 'Run in isolated git worktree')
  .action(commands.design);

program
  .command('ux-refine')
  .description('Explicit UX refinement: use --openpencil for local DESIGN.op extraction or --prompt for guided Figma/manual refinement')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--light', 'Skip hard gates for simple changes')
  .option('--host <type>', 'Specify host editor (claude-code|cursor|codex|vscode|windsurf|auto)', 'auto')
  .option('--figma-url <url>', 'Figma file URL to sync with')
  .option('--token-file <path>', 'Path to design tokens file')
  .option('--skip-ux', 'Skip UX refinement entirely')
  .option('--after-forge', 'Confirm running after forge pass (skip auto-detect)')
  .option('--openpencil', 'Use local OpenPencil engine instead of Figma MCP')
  .option('--lint', 'Run design rules engine against DESIGN.op')
  .option('--live', 'Capture live browser screenshot and accessibility as UX evidence')
  .option('--url <url>', 'URL to capture (requires --live)')
  .action(commands.uxRefine);

program
  .command('forge [phase]')
  .description('Execute development waves with agent orchestration')
  .option('--parallel', 'Enable parallel wave execution')
  .option('--profile <type>', 'quality | balanced | budget', 'balanced')
  .option('--prompt', 'Generate copy-paste prompts for each task instead of executing')
  .option('--light', 'Skip hard gates for simple changes')
  .option('--worktree', 'Run execution in an isolated git worktree')
  .option('--figma', 'Use the prompt-driven Figma refinement path during this wave (requires --prompt)')
  .option('--skip-ux', 'Skip UX refinement even with --figma')
  .action(commands.forge);

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
  .command('verify')
  .description('Run verification checks on project state & artifacts')
  .option('--release', 'Include release/build/package verification checks')
  .option('--live', 'Run live browser checks on deployed app')
  .option('--url <url>', 'URL to verify against (requires --live)')
  .option('--recompute', 'Re-detect project type and recompute completion scores')
  .option('--json', 'Output verify receipt JSON to stdout')
  .action(commands.verify);

program
  .command('synthesize')
  .description('Generate Ultimate Planning Resource (UPR.md) from all artifacts')
  .action(commands.synthesize);

program
  .command('feedback')
  .description('Generate prompt from UPR.md for LLM refinement (closes the loop)')
  .option('--auto', 'Send directly to a live provider instead of generating a copy-paste prompt')
  .action(commands.feedbackPrompt);

program
  .command('import <file>')
  .description('Import an LLM-generated file into .danteforge/')
  .option('--as <name>', 'Save as a specific filename (default: keep original name)')
  .action(commands.importFile);

const skillsCommand = program
  .command('skills')
  .description('Manage DanteForge skill catalogs and imports');

skillsCommand
  .command('import')
  .description('Import one Antigravity bundle into the packaged DanteForge skills catalog')
  .requiredOption('--from <source>', 'Source catalog to import from (antigravity)')
  .option('--bundle <name>', 'Bundle name from docs/BUNDLES.md (default: Essentials)')
  .option('--allow-overwrite', 'Replace an existing packaged skill when the imported skill name collides')
  .option('--enhance', 'Apply DanteForge wrappers to imported skills')
  .action(commands.skillsImport);

program
  .command('config')
  .description('Manage API keys and LLM provider settings')
  .option('--set-key <provider:key>', 'Set API key (e.g., "grok:xai-abc123")')
  .option('--delete-key <provider>', 'Remove a stored API key')
  .option('--provider <name>', 'Set default provider (grok, claude, openai, gemini, ollama)')
  .option('--model <provider:model>', 'Set model for provider (e.g., "grok:grok-3")')
  .option('--show', 'Show current configuration')
  .action(commands.configCmd);

program
  .command('debug <issue>')
  .description('Systematic 4-phase debugging framework')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .action(commands.debug);

program
  .command('compact')
  .description('Compact audit log - summarize old entries to save context')
  .action(commands.compact);

program
  .command('setup')
  .argument('<tool>', 'Tool to set up (figma|assistants|ollama)')
  .description('Interactive setup wizard for integrations')
  .option('--host <type>', 'Specify host editor', 'auto')
  .option('--assistants <list>', 'Comma-separated assistant list (claude,codex,antigravity|gemini,opencode,cursor,all). Defaults to user-level assistants only; cursor is explicit.')
  .option('--ollama-model <name>', 'Preferred Ollama model for local-first spend optimization')
  .option('--pull', 'Pull the recommended Ollama model during setup when it is missing')
  .option('--figma-url <url>', 'Figma file URL')
  .option('--token-file <path>', 'Design tokens file path')
  .option('--no-test', 'Skip connection test')
  .action((tool: string, options) => {
    if (tool === 'figma') return commands.setupFigma(options);
    if (tool === 'assistants') return commands.setupAssistants(options);
    if (tool === 'ollama') return commands.setupOllama(options);
    logger.error(`Unknown tool: ${tool}. Available: figma, assistants, ollama`);
  });

program
  .command('doctor')
  .description('System health check and diagnostics')
  .option('--fix', 'Attempt to auto-fix issues')
  .option('--live', 'Run live connectivity checks for providers, upstreams, registries, and Figma MCP')
  .action(commands.doctor);

program
  .command('dashboard')
  .description('Launch progress dashboard (local HTML, auto-closes in 5 min)')
  .option('--port <number>', 'Port to serve on', '4242')
  .action(commands.dashboard);

program
  .command('cost')
  .description('Token cost reporting — view spend by agent, tier, model, and savings')
  .option('--by-agent', 'Show cost breakdown by agent role')
  .option('--by-tier', 'Show cost breakdown by model tier')
  .option('--savings', 'Show savings from local transforms, compression, and gates')
  .option('--history', 'Show historical cost across sessions')
  .action(commands.cost);

program
  .command('mcp-start')
  .description('Start DanteForge MCP server — expose tools to Claude Code, Codex, or any MCP client')
  .action(commands.mcpServer);

program
  .command('policy [action] [value]')
  .description('Get or set the self-edit policy for this project (deny | confirm | allow-with-audit)')
  .option('--cwd <path>', 'Project directory')
  .action((action, value, opts) => commands.policy(action, value, opts));

program
  .command('audit')
  .description('Show self-edit audit log entries')
  .option('--last <n>', 'Show last N entries')
  .option('--format <fmt>', 'Output format: table | json', 'table')
  .option('--cwd <path>', 'Project directory')
  .action(opts => commands.audit(opts));

program
  .command('spark [goal]')
  .description('Zero-token planning preset: review -> constitution -> specify -> clarify -> tech-decide -> plan -> tasks')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--skip-tech-decide', 'Skip the tech-decide step (useful for follow-up sprints where tech is already decided)')
  .action((goal, opts) => commands.spark(goal, {
    prompt: opts.prompt,
    skipTechDecide: opts.skipTechDecide,
  }));

program
  .command('ember [goal]')
  .description('Very low-token preset for quick features and light checkpoints')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .action((goal, opts) => commands.ember(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
  }));

program
  .command('canvas [goal]')
  .description('Design-first frontend preset: design → autoforge → ux-refine → verify')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--design-prompt <text>', 'Override design prompt (defaults to goal)')
  .action((goal, opts) => commands.canvas(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
    designPrompt: opts.designPrompt,
  }));

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
  .action((goal, opts) => commands.magic(goal, {
    level: opts.level,
    profile: opts.profile,
    skipUx: opts.skipUx,
    host: opts.host,
    prompt: opts.prompt,
    worktree: opts.worktree,
    isolation: opts.isolation,
    maxRepos: parseInt(opts.maxRepos, 10),
  }));

program
  .command('blaze [goal]')
  .description('High-power preset: full party + strong autoforge + synthesize + retro + self-improve')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--worktree', 'Run in an isolated git worktree')
  .option('--isolation', 'Run party with isolation enabled')
  .option('--with-design', 'Add design + ux-refine steps to the pipeline (design-first mode)')
  .option('--design-prompt <text>', 'Prompt to pass to the design step (defaults to goal)')
  .option('--local-sources <paths>', 'Comma-separated local repo/folder paths to harvest first')
  .option('--local-depth <level>', 'Harvest depth for local sources: shallow|medium|full', 'medium')
  .action((goal, opts) => commands.blaze(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
    worktree: opts.worktree,
    isolation: opts.isolation,
    withDesign: opts.withDesign,
    designPrompt: opts.designPrompt,
    localSources: opts.localSources?.split(',').map((s: string) => s.trim()).filter(Boolean),
    localDepth: opts.localDepth,
  }));

program
  .command('nova [goal]')
  .description('Very-high-power preset: planning prefix + blaze execution + inferno polish (no OSS)')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--worktree', 'Run in an isolated git worktree')
  .option('--isolation', 'Run party with isolation enabled')
  .option('--tech-decide', 'Add a tech-decide step after the planning prefix')
  .option('--with-design', 'Add design + ux-refine steps to the pipeline (design-first mode)')
  .option('--design-prompt <text>', 'Prompt to pass to the design step (defaults to goal)')
  .option('--local-sources <paths>', 'Comma-separated local repo/folder paths to harvest first')
  .option('--local-depth <level>', 'Harvest depth for local sources: shallow|medium|full', 'medium')
  .action((goal, opts) => commands.nova(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
    worktree: opts.worktree,
    isolation: opts.isolation,
    withTechDecide: opts.techDecide,
    withDesign: opts.withDesign,
    designPrompt: opts.designPrompt,
    localSources: opts.localSources?.split(',').map((s: string) => s.trim()).filter(Boolean),
    localDepth: opts.localDepth,
  }));

program
  .command('inferno [goal]')
  .description('Maximum-power preset: OSS mining + full implementation + evolution')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--worktree', 'Run in an isolated git worktree')
  .option('--isolation', 'Run party with isolation enabled')
  .option('--max-repos <n>', 'Maximum repos for OSS discovery', '12')
  .option('--with-design', 'Add design + ux-refine steps to the pipeline (design-first mode)')
  .option('--design-prompt <text>', 'Prompt to pass to the design step (defaults to goal)')
  .option('--local-sources <paths>', 'Comma-separated local repo/folder paths to harvest first')
  .option('--local-depth <level>', 'Harvest depth for local sources: shallow|medium|full', 'medium')
  .option('--local-config <path>', 'YAML config file listing local sources')
  .action((goal, opts) => commands.inferno(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
    worktree: opts.worktree,
    isolation: opts.isolation,
    maxRepos: parseInt(opts.maxRepos, 10),
    withDesign: opts.withDesign,
    designPrompt: opts.designPrompt,
    localSources: opts.localSources?.split(',').map((s: string) => s.trim()).filter(Boolean),
    localDepth: opts.localDepth,
    localSourcesConfig: opts.localConfig,
  }));

program
  .command('help [query]')
  .description('Context-aware guidance engine')
  .action(commands.helpCmd);

program
  .command('docs')
  .description('Generate or update the command reference documentation')
  .action(commands.docs);

program
  .command('update-mcp')
  .description('Manual MCP self-healing - check for protocol updates and apply safely')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--apply', 'Apply recommended updates after review')
  .option('--check', 'Check-only mode (no changes)')
  .action(commands.updateMcp);

program
  .command('tech-decide')
  .description('Guided tech stack selection - 3-5 options per category with pros/cons')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--auto', 'Accept all recommended defaults without interactive review')
  .action(commands.techDecide);

program
  .command('lessons [correction]')
  .description('Self-improving lessons - capture corrections, view rules, auto-compact')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--compact', 'Force compaction of lessons file')
  .action(commands.lessons);

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
  .action((goal, opts) => commands.autoforge(goal, {
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
  }));

program
  .command('awesome-scan')
  .description('Discover, classify, and import skills across all sources')
  .option('--source <path>', 'Scan an external directory for skills')
  .option('--domain <type>', 'Filter by domain (security|fullstack|devops|ux|backend|frontend|data|testing|architecture|general)')
  .option('--install', 'Import compatible external skills')
  .action(commands.awesomeScan);

program
  .command('profile [subcommand] [arg]')
  .description('Model personality profiles — view learned behavioral patterns per model')
  .option('--prompt', 'Generate a copy-paste prompt instead of displaying')
  .action((subcommand, arg, opts) => commands.profile(subcommand, arg, { prompt: opts.prompt }));

program
  .command('retro')
  .description('Project retrospective with metrics, delta scoring, and trend tracking')
  .option('--summary', 'Print trend summary of last 5 retros')
  .option('--cwd <path>', 'Project directory')
  .action(commands.retro);

program
  .command('ship')
  .description('Paranoid release guidance + version bump plan + changelog draft')
  .option('--dry-run', 'Run checks and generate guidance without changing the audit intent')
  .option('--skip-review', 'Skip pre-landing review (emergency only, logged to audit)')
  .action(commands.ship);

const ossCommand = program
  .command('oss')
  .description('OSS repository discovery, persistent harvesting, and library management')
  .option('--prompt', 'Generate a copy-paste research plan prompt instead of executing')
  .option('--dry-run', 'Show what would be searched without cloning')
  .option('--max-repos <n>', 'Maximum NEW repos to discover per run (default: 4)', '4')
  .action((opts) => commands.ossResearcher({
    prompt: opts.prompt,
    dryRun: opts.dryRun,
    maxRepos: opts.maxRepos,
  }));

ossCommand
  .command('learn')
  .description('Re-extract patterns from all cached repos and regenerate OSS_REPORT.md')
  .option('--repo <name>', 'Re-learn a single repo by name (partial match)')
  .option('--prompt', 'Show manual instructions instead of executing')
  .action((opts) => commands.ossLearn({
    repo: opts.repo,
    prompt: opts.prompt,
  }));

ossCommand
  .command('clean')
  .description('Remove cached OSS repos from .danteforge/oss-repos/')
  .option('--all', 'Remove all repos')
  .option('--blocked', 'Remove only blocked-license repos')
  .option('--older-than <days>', 'Remove repos older than N days')
  .option('--dry-run', 'Preview what would be deleted without removing anything')
  .action((opts) => commands.ossClean({
    all: opts.all,
    blocked: opts.blocked,
    olderThan: opts.olderThan,
    dryRun: opts.dryRun,
  }));

program
  .command('local-harvest [paths...]')
  .description('Harvest patterns from local private repos, folders, and zip archives')
  .option('--config <path>', 'YAML config file listing sources (.danteforge/local-sources.yaml)')
  .option('--depth <level>', 'shallow | medium | full (default: medium)', 'medium')
  .option('--prompt', 'Show harvest plan without executing')
  .option('--dry-run', 'Detect source types without reading')
  .option('--max-sources <n>', 'Maximum sources to analyze (default: 5)', '5')
  .action((paths, opts) => commands.localHarvest(paths ?? [], {
    config: opts.config,
    depth: opts.depth,
    prompt: opts.prompt,
    dryRun: opts.dryRun,
    maxSources: parseInt(opts.maxSources, 10),
  }));

program
  .command('autoresearch <goal>')
  .description('Autonomous metric-driven optimization loop — plan, rewrite, execute, evaluate, keep winners')
  .option('--metric <metric>', 'How to measure success (e.g., "startup time ms", "bundle size KB")')
  .option('--time <budget>', 'Time budget (e.g., "4h", "30m")', '4h')
  .option('--prompt', 'Generate a copy-paste prompt instead of executing')
  .option('--dry-run', 'Show the experiment plan without running')
  .action((goal, opts) => commands.autoResearch(goal, {
    metric: opts.metric,
    time: opts.time,
    prompt: opts.prompt,
    dryRun: opts.dryRun,
  }));

program
  .command('harvest <system>')
  .description('Titan Harvest V2 — 5-step constitutional harvest of OSS patterns with hash-verifiable ratification')
  .option('--prompt', 'Display the 5-step copy-paste template without calling the LLM')
  .option('--lite', 'Run in SEP-LITE mode (Steps 1-3 + 5 only, 2-3 donors, 2-4 organs)')
  .action(commands.harvest);

program
  .command('premium [subcommand]')
  .description('Manage premium tier, license, and audit trail')
  .option('--key <key>', 'License key for activation')
  .action((subcommand, opts) => commands.premium(subcommand ?? 'status', { key: opts.key }));

// First-run detection — suggest init when no .danteforge/ exists
program.hook('preAction', (_thisCommand, actionCommand) => {
  const skip = new Set(['init', 'config', 'doctor', 'help', 'setup', 'skills', 'docs', 'premium']);
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
  Automation:     spark, ember, magic, blaze, inferno, autoforge, autoresearch, party
  Design:         design, ux-refine, browse, qa
  Intelligence:   tech-decide, debug, lessons, profile, oss, harvest, retro
  Tools:          config, setup, doctor, dashboard, cost, compact, import, skills, ship, premium
  Meta:           help, review, feedback, update-mcp, awesome-scan, docs

Run "danteforge help <command>" for detailed help on any command.
Run "danteforge init" to set up a new project.
`);

loadState().catch(() => { /* state will be created on first write */ });

program.parse(process.argv);
