#!/usr/bin/env node
// Main CLI entry
import { Command } from 'commander';
import { existsSync } from 'node:fs';
// Lazy-load command implementations — deferred until action fires, not at startup
type Commands = Awaited<typeof import('./commands/index.js')>;
let _cmds: Commands | null = null;
const C = (): Promise<Commands> =>
  _cmds ? Promise.resolve(_cmds) : import('./commands/index.js').then(m => (_cmds = m as Commands));
import { loadState } from '../core/state.js';
import { logger } from '../core/logger.js';
import { enforceWorkflow } from '../core/workflow-enforcer.js';
import { formatAndLogError } from '../core/format-error.js';
import {
  CANVAS_PRESET_TEXT,
  SPARK_PLANNING_TEXT,
} from '../core/workflow-surface.js';

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
  .option('--guided', 'Force the full interactive setup wizard (overrides TTY detection)')
  .option('--advanced', 'Enable advanced setup: adversarial scoring + competitive universe')
  .action(async (opts) => (await C()).init({ nonInteractive: opts.nonInteractive, guided: opts.guided, advanced: opts.advanced }));

program
  .command('constitution')
  .description('Initialize project constitution and principles')
  .action((...a: unknown[]) => void C().then(c => (c.constitution as (...x: unknown[]) => unknown)(...a)));

program
  .command('specify <idea>')
  .description('High-level idea -> full spec artifacts')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .option('--ceo-review', 'Apply founder/CEO intent elevation before writing SPEC.md')
  .option('--refine', 'Inject PDSE score as context for iterative improvement')
  .action((...a: unknown[]) => void C().then(c => (c.specify as (...x: unknown[]) => unknown)(...a)));

program
  .command('clarify')
  .description('Run clarification Q&A on current spec')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .action((...a: unknown[]) => void C().then(c => (c.clarify as (...x: unknown[]) => unknown)(...a)));

program
  .command('plan [goal]')
  .description('Plan a goal or generate detailed plan from spec. Use --level to select scope.')
  .option('--level <level>', 'Canonical intensity: light | standard | deep')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .option('--ceo-review', 'Apply CEO-level strategic review before writing PLAN.md')
  .option('--refine', 'Inject PDSE score as context for iterative improvement')
  .option('--skip-critique', 'Skip adversarial critique gate after plan generation')
  .option('--stakes <level>', 'Critique depth: low|medium|high|critical (default: medium)')
  .action(async (goal, opts) => {
    if (opts.level) {
      return (await C()).canonicalPlan(goal as string | undefined, {
        level: opts.level as string,
        prompt: opts.prompt as boolean | undefined,
        light: opts.light as boolean | undefined,
      });
    }
    return (await C()).plan({
      prompt: opts.prompt as boolean | undefined,
      light: opts.light as boolean | undefined,
      skipCritique: opts.skipCritique as boolean | undefined,
      stakes: opts.stakes as string | undefined,
    });
  });

program
  .command('critique <plan-file>')
  .description('Adversarial critique of a plan — finds gaps before they become bugs')
  .option('--source <files>', 'Comma-separated source files to include as context')
  .option('--auto-refine', 'Annotate plan file with blocking gaps')
  .option('--json', 'Machine-readable JSON output')
  .option('--skip-critique', 'Bypass critique (escape hatch)')
  .option('--stakes <level>', 'Check depth: low|medium|high|critical (default: medium)')
  .option('--diff <ref>', 'Compare built code against plan (e.g. HEAD~1)')
  .option('--no-premortem', 'Skip pre-mortem failure hypothesis generation')
  .action((...a: unknown[]) => void C().then(c => (c.critique as (...x: unknown[]) => unknown)(...a)));

program
  .command('tasks')
  .description('Break plan into executable tasks')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .action((...a: unknown[]) => void C().then(c => (c.tasks as (...x: unknown[]) => unknown)(...a)));

program
  .command('design <prompt>')
  .description('Generate design artifacts from natural language via OpenPencil Design-as-Code engine')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--light', 'Skip hard gates')
  .option('--format <type>', 'Export format: jsx | vue | html', 'jsx')
  .option('--parallel', 'Enable spatial parallel decomposition')
  .option('--worktree', 'Run in isolated git worktree')
  .option('--seed', 'Write a high-quality canvas seed document to DESIGN.op without LLM (scores 7/7 quality dims)')
  .action((...a: unknown[]) => void C().then(c => (c.design as (...x: unknown[]) => unknown)(...a)));

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
  .action((...a: unknown[]) => void C().then(c => (c.uxRefine as (...x: unknown[]) => unknown)(...a)));

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
  .option('--confirm', 'Require explicit human approval via policy gate before executing')
  .action((...a: unknown[]) => void C().then(c => (c.forge as (...x: unknown[]) => unknown)(...a)));

program
  .command('party')
  .description('Launch multi-agent collaboration mode')
  .option('--worktree', 'Create isolated worktrees for each agent')
  .option('--isolation', 'Run each agent through subagent isolation and dual-stage review')
  .option('--figma', 'Legacy compatibility flag; use ux-refine separately for Figma workflows')
  .option('--skip-ux', 'Skip UX refinement even with --figma')
  .option('--design', 'Activate Design Agent for UI generation via OpenPencil')
  .option('--no-design', 'Exclude Design Agent from party mode')
  .action((...a: unknown[]) => void C().then(c => (c.party as (...x: unknown[]) => unknown)(...a)));

program
  .command('review')
  .description('Scan existing repo -> generate CURRENT_STATE.md')
  .option('--prompt', 'Generate a copy-paste prompt for Claude Code / ChatGPT instead of local/API')
  .action((...a: unknown[]) => void C().then(c => (c.review as (...x: unknown[]) => unknown)(...a)));

program
  .command('browse <subcommand> [args...]')
  .description('Browser automation — navigate, screenshot, inspect live apps')
  .option('--url <url>', 'Target URL (shorthand for goto)')
  .option('--port <port>', 'Override browse daemon port', '9400')
  .action((...a: unknown[]) => void C().then(c => (c.browse as (...x: unknown[]) => unknown)(...a)));

program
  .command('qa')
  .description('Structured QA pass with health score on live app')
  .requiredOption('--url <url>', 'Staging or production URL to test')
  .option('--type <mode>', 'QA mode: full | quick | regression', 'full')
  .option('--baseline <path>', 'Baseline JSON for regression comparison')
  .option('--save-baseline', 'Save current report as new baseline')
  .option('--fail-below <score>', 'Exit code 1 if score below threshold', '0')
  .action((...a: unknown[]) => void C().then(c => (c.qa as (...x: unknown[]) => unknown)(...a)));

program
  .command('verify')
  .alias('check')
  .description('Run verification checks on project state & artifacts')
  .option('--release', 'Include release/build/package verification checks')
  .option('--live', 'Run live browser checks on deployed app')
  .option('--url <url>', 'URL to verify against (requires --live)')
  .option('--recompute', 'Re-detect project type and recompute completion scores')
  .option('--json', 'Output results as JSON to stdout (logs go to stderr)')
  .option('--light', 'Skip pipeline execution checks; substitute npm test + build (for CLI projects or early-stage pipelines)')
  .option('--cwd <path>', 'Working directory for verification (defaults to current directory)')
  .action((...a: unknown[]) => void C().then(c => (c.verify as (...x: unknown[]) => unknown)(...a)));

program
  .command('synthesize')
  .description('Generate Ultimate Planning Resource (UPR.md) from all artifacts')
  .action((...a: unknown[]) => void C().then(c => (c.synthesize as (...x: unknown[]) => unknown)(...a)));

program
  .command('feedback')
  .description('Generate prompt from UPR.md for LLM refinement (closes the loop)')
  .option('--auto', 'Send directly to a live provider instead of generating a copy-paste prompt')
  .action((...a: unknown[]) => void C().then(c => (c.feedbackPrompt as (...x: unknown[]) => unknown)(...a)));

for (const skillName of ['dante-to-prd', 'dante-grill-me', 'dante-tdd', 'dante-triage-issue', 'dante-design-an-interface'] as const) {
  program
    .command(skillName)
    .description(`Run the ${skillName} Dante-native skill (Phase 2 / PRD-MASTER §7).`)
    .option('--input-file <path>', 'JSON file with skill inputs')
    .option('--inputs-json <json>', 'Inline JSON with skill inputs')
    .option('--out-dir <path>', 'Override output dir (default: .danteforge/skill-runs/<skill>/<runId>)')
    .option('--score-override <pairs>', 'Force scorer output for testing, e.g. "testing=9.5,errorHandling=8.0"')
    .action(async (opts) => {
      const cmds = await C();
      const r = await cmds.runDanteSkill(skillName, {
        inputFile: opts.inputFile,
        inputJson: opts.inputsJson,
        outDir: opts.outDir,
        scoreOverride: opts.scoreOverride
      });
      if (r.exitCode !== 0) process.exitCode = r.exitCode;
    });
}

program
  .command('magic-orchestrate <level>')
  .description('Run a magic-level skill chain end-to-end (Phase 3 / PRD-MASTER §8). Levels: spark/ember/canvas/magic/blaze/nova/inferno/ascend')
  .option('--input-file <path>', 'JSON file with workflow inputs')
  .option('--inputs-json <json>', 'Inline JSON with workflow inputs')
  .option('--budget-usd <amount>', 'USD budget — orchestration halts on overrun')
  .option('--budget-minutes <amount>', 'Wall-clock budget in minutes')
  .option('--max-retries <n>', 'Max convergence retries per step (default 2)')
  .option('--score-override <pairs>', 'Force scorer output for testing, e.g. "testing=9.5,errorHandling=8.0"')
  .action(async (level: string, opts) => {
    const cmds = await C();
    const r = await cmds.magicOrchestrate(level, {
      inputFile: opts.inputFile,
      inputsJson: opts.inputsJson,
      budgetUsd: opts.budgetUsd,
      budgetMinutes: opts.budgetMinutes,
      maxRetries: opts.maxRetries,
      scoreOverride: opts.scoreOverride
    });
    if (r.exitCode !== 0) process.exitCode = r.exitCode;
  });

const truthLoopCommand = program
  .command('truth-loop')
  .description('Run the truth loop reconciliation pipeline (PRD-26 §5.3)');

truthLoopCommand
  .command('run')
  .description('Execute one truth-loop run: collect → import critiques → reconcile → verdict → next-action')
  .option('--repo <path>', 'Repo to evaluate (default: cwd)')
  .option('--objective <text>', 'Run objective')
  .option('--critics <list>', 'Comma-separated critic names (codex,claude,grok,gemini,human)')
  .option('--critique-file <path>', 'Critique file (repeatable; pair-by-position with --critics or use source=path syntax)', (v: string, prev: string[] = []) => prev.concat(v), [] as string[])
  .option('--budget-usd <amount>', 'Max USD budget for the run', '5')
  .option('--budget-minutes <amount>', 'Max wall-clock minutes for the run')
  .option('--mode <mode>', 'sequential | parallel', 'sequential')
  .option('--strictness <mode>', 'strict | standard | dev', 'standard')
  .option('--out <path>', 'Output directory (default: .danteforge/truth-loop/<runId>)')
  .option('--initiator <who>', 'founder | agent | ci', 'founder')
  .option('--hardware <profile>', 'rtx_4060_laptop | rtx_3090_workstation | cloud_runner | ci_only', 'rtx_4060_laptop')
  .option('--skip-tests', 'Do not run the test suite during collection')
  .option('--test-command <cmd>', 'Override the test command')
  .action(async (opts) => {
    const cmds = await C();
    const result = await cmds.truthLoopRun({
      repo: opts.repo,
      objective: opts.objective,
      critics: opts.critics,
      critiqueFile: opts.critiqueFile,
      budgetUsd: opts.budgetUsd,
      budgetMinutes: opts.budgetMinutes,
      mode: opts.mode,
      strictness: opts.strictness,
      out: opts.out,
      initiator: opts.initiator,
      hardware: opts.hardware,
      skipTests: opts.skipTests,
      testCommand: opts.testCommand
    });
    if (result.exitCode !== 0) {
      process.exitCode = result.exitCode;
    }
  });

truthLoopCommand
  .command('list')
  .description('List prior truth-loop runs in .danteforge/truth-loop/')
  .option('--json', 'Machine-readable JSON output')
  .option('--repo <path>', 'Repo to inspect (default: cwd)')
  .option('--limit <n>', 'Show only the most recent N runs')
  .action(async (opts) => {
    const cmds = await C();
    const r = await cmds.truthLoopList({
      json: opts.json,
      repo: opts.repo,
      limit: opts.limit
    });
    if (r.exitCode !== 0) process.exitCode = r.exitCode;
  });

program
  .command('import <file>')
  .description('Import an LLM-generated file into .danteforge/')
  .option('--as <name>', 'Save as a specific filename (default: keep original name)')
  .action((...a: unknown[]) => void C().then(c => (c.importFile as (...x: unknown[]) => unknown)(...a)));

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
  .action((...a: unknown[]) => void C().then(c => (c.skillsImport as (...x: unknown[]) => unknown)(...a)));

program
  .command('config')
  .description('Manage API keys and LLM provider settings')
  .option('--set-key <provider:key>', 'Set API key (e.g., "grok:xai-abc123")')
  .option('--delete-key <provider>', 'Remove a stored API key')
  .option('--provider <name>', 'Set default provider (grok, claude, openai, gemini, ollama)')
  .option('--model <provider:model>', 'Set model for provider (e.g., "grok:grok-3")')
  .option('--show', 'Show current configuration')
  .action((...a: unknown[]) => void C().then(c => (c.configCmd as (...x: unknown[]) => unknown)(...a)));

program
  .command('debug <issue>')
  .description('Systematic 4-phase debugging framework')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .action((...a: unknown[]) => void C().then(c => (c.debug as (...x: unknown[]) => unknown)(...a)));

program
  .command('compact')
  .description('Compact audit log - summarize old entries to save context')
  .action((...a: unknown[]) => void C().then(c => (c.compact as (...x: unknown[]) => unknown)(...a)));

program
  .command('setup')
  .argument('<tool>', 'Tool to set up (figma|assistants|ollama)')
  .description('Interactive setup wizard for integrations')
  .option('--host <type>', 'Specify host editor', 'auto')
  .option('--assistants <list>', 'Comma-separated assistant list (claude,codex,antigravity|gemini,opencode,cursor,all). Defaults to user-level assistants only; cursor is explicit.')
  .option('--figma-url <url>', 'Figma file URL')
  .option('--token-file <path>', 'Design tokens file path')
  .option('--no-test', 'Skip connection test')
  .option('--pull', 'Pull recommended Ollama model if missing')
  .option('--ollama-model <model>', 'Override the recommended Ollama model')
  .addHelpText('after', '\nSubcommands: figma, assistants, ollama')
  .action(async (tool: string, options) => {
    if (tool === 'figma') return (await C()).setupFigma(options);
    if (tool === 'assistants') return (await C()).setupAssistants(options);
    if (tool === 'ollama') return (await C()).setupOllama(options);
    logger.error(`Unknown tool: ${tool}. Available: figma, assistants, ollama`);
  });

program
  .command('doctor')
  .description('System health check and diagnostics')
  .option('--fix', 'Attempt to auto-fix issues')
  .option('--live', 'Run live connectivity checks for providers, upstreams, registries, and Figma MCP')
  .action((...a: unknown[]) => void C().then(c => (c.doctor as (...x: unknown[]) => unknown)(...a)));

program
  .command('dashboard')
  .description('Launch progress dashboard (local HTML, auto-closes in 5 min)')
  .option('--port <number>', 'Port to serve on', '4242')
  .action((...a: unknown[]) => void C().then(c => (c.dashboard as (...x: unknown[]) => unknown)(...a)));

program
  .command('spark [goal]')
  .description(`Alias: plan --level light. Zero-token planning preset: ${SPARK_PLANNING_TEXT}`)
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--skip-tech-decide', 'Skip the tech-decide step when the stack is already decided')
  .action(async (goal, opts) => (await C()).spark(goal, {
    prompt: opts.prompt,
    skipTechDecide: opts.skipTechDecide,
  }));

program
  .command('ember [goal]')
  .description('Alias: build --level light. Very low-token preset for quick features and light checkpoints')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .action(async (goal, opts) => (await C()).ember(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
  }));

program
  .command('canvas [goal]')
  .description(`Design-first frontend preset: ${CANVAS_PRESET_TEXT}`)
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--design-prompt <text>', 'Override the prompt passed to the design step')
  .action(async (goal, opts) => (await C()).canvas(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
    designPrompt: opts.designPrompt,
  }));

program
  .command('magic [goal]')
  .alias('improve')
  .description('Alias: build --level standard. Balanced preset and default hero command for most follow-up work')
  .option('--level <level>', 'spark | ember | canvas | magic | blaze | nova | inferno', 'magic')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--skip-ux', 'Skip UX refinement')
  .option('--host <type>', 'Specify host editor for MCP', 'auto')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--worktree', 'Run heavy preset execution inside an isolated git worktree')
  .option('--isolation', 'Use isolation when a preset escalates into party mode')
  .option('--max-repos <n>', 'Maximum repos for inferno OSS discovery', '12')
  .option('--yes', 'Skip competitive matrix confirmation gate')
  .action(async (goal, opts) => (await C()).magic(goal, {
    level: opts.level,
    profile: opts.profile,
    skipUx: opts.skipUx,
    host: opts.host,
    prompt: opts.prompt,
    worktree: opts.worktree,
    isolation: opts.isolation,
    maxRepos: parseInt(opts.maxRepos, 10),
    yes: opts.yes,
  }));

program
  .command('blaze [goal]')
  .description('Alias: build --level deep. High-power preset: full party + strong autoforge + synthesize + retro + self-improve')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--worktree', 'Run in an isolated git worktree')
  .option('--isolation', 'Run party with isolation enabled')
  .option('--with-design', 'Add design + ux-refine steps to the pipeline')
  .option('--design-prompt <text>', 'Prompt to pass to the design step')
  .option('--yes', 'Skip competitive matrix confirmation gate')
  .action(async (goal, opts) => (await C()).blaze(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
    worktree: opts.worktree,
    isolation: opts.isolation,
    withDesign: opts.withDesign,
    designPrompt: opts.designPrompt,
    yes: opts.yes,
  }));

program
  .command('nova [goal]')
  .description('Alias: build --level deep --planning-prefix. Very-high-power preset: planning prefix + blaze execution + inferno polish (no OSS)')
  .option('--profile <type>', 'quality | balanced | budget', 'budget')
  .option('--prompt', 'Generate the preset plan without executing')
  .option('--worktree', 'Run in an isolated git worktree')
  .option('--isolation', 'Run party with isolation enabled')
  .option('--tech-decide', 'Add a tech-decide step after the planning prefix')
  .option('--with-design', 'Add design + ux-refine steps to the pipeline')
  .option('--design-prompt <text>', 'Prompt to pass to the design step')
  .option('--yes', 'Skip competitive matrix confirmation gate')
  .action(async (goal, opts) => (await C()).nova(goal, {
    profile: opts.profile,
    prompt: opts.prompt,
    worktree: opts.worktree,
    isolation: opts.isolation,
    withTechDecide: opts.techDecide,
    withDesign: opts.withDesign,
    designPrompt: opts.designPrompt,
    yes: opts.yes,
  }));

program
  .command('inferno [goal]')
  .description('Alias: build --level deep --with-harvest. Maximum-power preset: OSS mining + full implementation + evolution')
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
  .option('--yes', 'Skip competitive matrix confirmation gate')
  .action(async (goal, opts) => (await C()).inferno(goal, {
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
    yes: opts.yes,
  }));

program
  .command('workflow')
  .description('Show the 12-stage pipeline with your current position highlighted')
  .action(async () => {
    const { workflow } = await import('./commands/workflow.js');
    await workflow();
  });

program
  .command('help [query]')
  .description('Context-aware guidance — shows essential commands by default, --all for full list')
  .option('--all', 'Show all 100+ commands instead of the essential 8')
  .action(async (query, opts) => (await C()).helpCmd(query, { all: opts.all }));

program
  .command('docs')
  .description('Generate or update the command reference documentation')
  .action((...a: unknown[]) => void C().then(c => (c.docs as (...x: unknown[]) => unknown)(...a)));

program
  .command('update-mcp')
  .description('Manual MCP self-healing - check for protocol updates and apply safely')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--apply', 'Apply recommended updates after review')
  .option('--check', 'Check-only mode (no changes)')
  .action((...a: unknown[]) => void C().then(c => (c.updateMcp as (...x: unknown[]) => unknown)(...a)));

program
  .command('tech-decide')
  .description('Guided tech stack selection - 3-5 options per category with pros/cons')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--auto', 'Accept all recommended defaults without interactive review')
  .action((...a: unknown[]) => void C().then(c => (c.techDecide as (...x: unknown[]) => unknown)(...a)));

program
  .command('lessons [correction]')
  .description('Self-improving lessons - capture corrections, view rules, auto-compact')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--compact', 'Force compaction of lessons file')
  .action((...a: unknown[]) => void C().then(c => (c.lessons as (...x: unknown[]) => unknown)(...a)));

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
  .option('--confirm', 'Pause for human approval before executing (policy gate)')
  .action(async (goal, opts) => (await C()).autoforge(goal, {
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
    confirm: opts.confirm,
  }));

program
  .command('resume')
  .description('Resume a paused autoforge loop from the last checkpoint')
  .action(async () => (await C()).resumeAutoforge());

program
  .command('awesome-scan')
  .description('Discover, classify, and import skills across all sources')
  .option('--source <path>', 'Scan an external directory for skills')
  .option('--domain <type>', 'Filter by domain (security|fullstack|devops|ux|backend|frontend|data|testing|architecture|general)')
  .option('--install', 'Import compatible external skills')
  .action((...a: unknown[]) => void C().then(c => (c.awesomeScan as (...x: unknown[]) => unknown)(...a)));

program
  .command('profile [subcommand] [arg]')
  .description('Model personality profiles — view learned behavioral patterns per model')
  .option('--prompt', 'Generate a copy-paste prompt instead of displaying')
  .addHelpText('after', '\nSubcommands: (none)=summary, compare, report, weakness <model>, recommend <task>')
  .action(async (subcommand, arg, opts) => (await C()).profile(subcommand, arg, { prompt: opts.prompt }));

program
  .command('retro')
  .description('Project retrospective with metrics, delta scoring, and trend tracking')
  .option('--summary', 'Print trend summary of last 5 retros')
  .option('--cwd <path>', 'Project directory')
  .action((...a: unknown[]) => void C().then(c => (c.retro as (...x: unknown[]) => unknown)(...a)));

program
  .command('maturity')
  .description('Assess current code maturity level with founder-friendly quality report')
  .option('--preset <level>', 'Target preset level (spark|ember|canvas|magic|blaze|nova|inferno)')
  .option('--json', 'Output JSON instead of plain text')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => (await C()).maturity({
    preset: opts.preset,
    json: opts.json,
    cwd: opts.cwd,
  }));

program
  .command('ship')
  .description('Paranoid release guidance + version bump plan + changelog draft')
  .option('--dry-run', 'Run checks and generate guidance without changing the audit intent')
  .option('--skip-review', 'Skip pre-landing review (emergency only, logged to audit)')
  .action((...a: unknown[]) => void C().then(c => (c.ship as (...x: unknown[]) => unknown)(...a)));

program
  .command('oss')
  .description('Auto-detect project, search OSS, clone, license-gate, scan, extract patterns, report')
  .option('--prompt', 'Generate a copy-paste research plan prompt instead of executing')
  .option('--dry-run', 'Show what would be searched without cloning')
  .option('--max-repos <n>', 'Maximum repos to clone and analyze (default: 8)', '8')
  .action(async (opts) => (await C()).ossResearcher({
    prompt: opts.prompt,
    dryRun: opts.dryRun,
    maxRepos: opts.maxRepos,
  }));

program
  .command('oss-deep [url-or-path]')
  .description('Deep systematic extraction from a single OSS repo (persistent cache, full src read)')
  .option('--prompt', 'Show extraction plan without executing')
  .option('--include-git-log', 'Include commit history analysis for top 5 files (slower)')
  .option('--max-files <n>', 'Max critical files to read in full (default: 20)', '20')
  .action(async (urlOrPath, opts) => {
    const { ossDeepCommand } = await import('./commands/oss-deep.js');
    await ossDeepCommand(urlOrPath ?? '', {
      prompt: opts.prompt,
      includeGitLog: opts.includeGitLog,
      maxFiles: opts.maxFiles,
    });
  });

program
  .command('oss-intel')
  .description('Multi-repo systematic harvest — builds ADOPTION_QUEUE.md from harvest-queue.json')
  .option('--max-repos <n>', 'Max repos to deep-extract per run (default: 5)', '5')
  .option('--prompt', 'Show harvest plan without executing')
  .action(async (opts) => {
    const { ossIntel } = await import('./commands/oss-intel.js');
    await ossIntel({ maxRepos: parseInt(opts.maxRepos, 10), promptMode: opts.prompt });
  });

program
  .command('oss-clean')
  .description('Purge OSS clone cache (.danteforge/oss-repos/ and oss-deep/)')
  .option('--dry-run', 'Show what would be deleted without deleting')
  .action(async (opts) => {
    const { ossClean } = await import('./commands/oss-clean.js');
    await ossClean({ dryRun: opts.dryRun });
  });

program
  .command('harvest-forge')
  .description('Compounding OSS intelligence loop: discover → extract → implement → verify → repeat')
  .option('--max-cycles <n>', 'Max iteration cycles (default: 10)', '10')
  .option('--target <score>', 'Target convergence score 0-10 (default: 9.0)', '9.0')
  .option('--auto', 'Auto-approve all cycles without human checkpoint')
  .option('--prompt', 'Show the loop plan without executing')
  .option('--max-hours <h>', 'Max wall-clock hours before stopping with budget-exhausted')
  .action(async (opts) => {
    const { harvestForge } = await import('./commands/harvest-forge.js');
    await harvestForge({
      maxCycles: parseInt(opts.maxCycles, 10),
      targetScore: parseFloat(opts.target),
      autoApprove: opts.auto,
      promptMode: opts.prompt,
      maxHours: opts.maxHours ? parseFloat(opts.maxHours) : undefined,
    });
  });

program
  .command('universe-scan')
  .description('Scan competitive universe, derive dimensions, score codebase with evidence')
  .option('--prompt', 'Show scan plan without executing')
  .action(async (opts) => {
    const { universeScan } = await import('./commands/universe-scan.js');
    await universeScan({ promptMode: opts.prompt });
  });

program
  .command('set-goal')
  .description('Set convergence goal: category, competitors, budget, oversight level')
  .option('--prompt', 'Show goal template without writing')
  .option('--no-scan', 'Skip auto universe-scan after goal is set')
  .action(async (opts) => {
    const { setGoal } = await import('./commands/set-goal.js');
    await setGoal({ promptMode: opts.prompt, autoScan: opts.scan !== false });
  });

program
  .command('status')
  .description('Show convergence dashboard: dimensions, cost, OSS harvest stats, next cycle plan')
  .action(async () => {
    const { status, renderStatus } = await import('./commands/status.js');
    const report = await status();
    console.log(renderStatus(report));
  });

program
  .command('local-harvest [paths...]')
  .description('Harvest patterns from local private repos, folders, and zip archives')
  .option('--config <path>', 'YAML config file listing sources (.danteforge/local-sources.yaml)')
  .option('--depth <level>', 'shallow | medium | full (default: medium)', 'medium')
  .option('--prompt', 'Show harvest plan without executing')
  .option('--dry-run', 'Detect source types without reading')
  .option('--max-sources <n>', 'Maximum sources to analyze (default: 5)', '5')
  .action(async (paths, opts) => (await C()).localHarvest(paths ?? [], {
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
  .option('--measurement-command <command>', 'Explicit command that prints the metric as a number')
  .option('--time <budget>', 'Time budget (e.g., "4h", "30m")', '4h')
  .option('--prompt', 'Generate a copy-paste prompt instead of executing')
  .option('--dry-run', 'Show the experiment plan without running')
  .option('--allow-dirty', 'Allow execution on a dirty git working tree (unsafe; disabled by default)')
  .action(async (goal, opts) => (await C()).autoResearch(goal, {
    metric: opts.metric,
    measurementCommand: opts.measurementCommand,
    time: opts.time,
    prompt: opts.prompt,
    dryRun: opts.dryRun,
    allowDirty: opts.allowDirty,
  }));

program
  .command('harvest [goal]')
  .description('Discover and learn from OSS patterns. --level selects depth: light=focused pattern, standard=bounded OSS pass, deep=OSS+local+universe refresh.')
  .option('--level <level>', 'Canonical intensity: light | standard | deep')
  .option('--source <type>', 'Source type: oss | local | mixed (default: oss)')
  .option('--max-repos <n>', 'Max repos for OSS harvest', '8')
  .option('--depth <level>', 'Local harvest depth: shallow | medium | full', 'medium')
  .option('--until-saturation', 'deep only: loop OSS cycles until new-feature yield drops (two consecutive lean cycles stops the loop)')
  .option('--max-cycles <n>', 'Max cycles for --until-saturation (default: 5)', '5')
  .option('--saturation-threshold <n>', 'Min new features per cycle before cycle is "lean" (default: 3)', '3')
  .option('--prompt', 'Display the 5-step copy-paste template without calling the LLM')
  .option('--lite', 'Run in SEP-LITE mode (Steps 1-3 + 5 only, 2-3 donors, 2-4 organs)')
  .action(async (goal, opts) => {
    if (opts.level) {
      return (await C()).canonicalHarvest(goal as string | undefined, {
        level: opts.level as string,
        source: opts.source as string | undefined,
        maxRepos: opts.maxRepos ? parseInt(opts.maxRepos as string, 10) : undefined,
        prompt: opts.prompt as boolean | undefined,
        depth: opts.depth as string | undefined,
        untilSaturation: opts.untilSaturation as boolean | undefined,
        maxCycles: opts.maxCycles ? parseInt(opts.maxCycles as string, 10) : undefined,
        saturationThreshold: opts.saturationThreshold ? parseInt(opts.saturationThreshold as string, 10) : undefined,
      });
    }
    return (await C()).harvest(goal as string ?? '', { prompt: opts.prompt as boolean | undefined, lite: opts.lite as boolean | undefined });
  });

program
  .command('premium [subcommand]')
  .description('Manage premium tier, license, and audit trail')
  .option('--key <key>', 'License key for activation')
  .option('--tier <tier>', 'License tier for keygen: pro or enterprise', 'pro')
  .option('--days <n>', 'Days until expiry for keygen (default: 365)', '365')
  .action(async (subcommand, opts) => (await C()).premium(subcommand ?? 'status', { key: opts.key, tier: opts.tier, days: opts.days }));

program
  .command('mcp-server')
  .description('Start DanteForge MCP server over stdio — for Claude Code, Codex, Cursor')
  .action(async () => (await C()).mcpServer());

program
  .command('publish-check')
  .description('Pre-publish validation gate — 12 parallel checks before npm publish')
  .option('--json', 'Output machine-readable JSON')
  .action(async (opts) => (await C()).publishCheck({ json: opts.json }));

program
  .command('proof')
  .description('Proof of value — raw prompt vs structured artifacts, or pipeline/convergence evidence report')
  .option('--prompt <text>', 'Raw prompt to compare against structured artifacts')
  .option('--pipeline', 'Generate structured pipeline execution evidence report')
  .option('--convergence', 'Generate structured convergence & self-healing evidence report')
  .option('--verify <file>', 'Verify an evidence-chain receipt, bundle, chain, or proof-bearing JSON file')
  .option('--verify-all <dir>', 'Recursively verify every receipt under <dir>; report corpus integrity stats')
  .option('--skip-git', 'Skip current git SHA binding check during proof verification')
  .option('--strict-git-binding', 'Require manifest gitSha to equal HEAD (snapshot mode); default is ancestor continuity')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .option('--semantic', 'LLM-enhanced PDSE scoring')
  .option('--since <date>', 'Score arc since date or git SHA (e.g. "yesterday", "2026-04-01", a commit SHA)')
  .action(async (opts) => (await C()).proof({ prompt: opts.prompt, pipeline: opts.pipeline, convergence: opts.convergence, verify: opts.verify, verifyAll: opts.verifyAll, skipGit: opts.skipGit, strictGitBinding: opts.strictGitBinding, cwd: opts.cwd, semantic: opts.semantic, since: opts.since }));

const timeMachineCommand = program
  .command('time-machine')
  .description('Local tamper-evident, restorable evidence snapshots');

timeMachineCommand
  .command('commit')
  .description('Commit one file or directory into the local Time Machine object store')
  .requiredOption('--path <path>', 'File or directory to snapshot', (v: string, prev: string[] = []) => prev.concat(v), [] as string[])
  .option('--label <label>', 'Human-readable snapshot label', 'manual')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action(async (opts) => (await C()).timeMachine({ action: 'commit', cwd: opts.cwd, path: opts.path, label: opts.label }));

timeMachineCommand
  .command('verify')
  .description('Verify Time Machine commit manifests, blobs, refs, and proof envelopes')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action(async (opts) => (await C()).timeMachine({ action: 'verify', cwd: opts.cwd }));

timeMachineCommand
  .command('restore')
  .description('Restore a commit into an output directory or the working tree')
  .requiredOption('--commit <id>', 'Time Machine commit id')
  .option('--out <path>', 'Output directory (default: .danteforge/time-machine/restores/<commit>)')
  .option('--to-working-tree', 'Restore directly into the working tree (cwd) instead of an isolated outDir')
  .option('--confirm', 'Required with --to-working-tree to confirm overwriting working tree files')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action(async (opts) => (await C()).timeMachine({ action: 'restore', cwd: opts.cwd, commit: opts.commit, out: opts.out, toWorkingTree: opts.toWorkingTree, confirm: opts.confirm }));

timeMachineCommand
  .command('query')
  .description('Query minimal causal links from Time Machine commits')
  .requiredOption('--kind <kind>', 'evidence | dependents | file-history | counterfactual')
  .option('--commit <id>', 'Time Machine commit id (defaults to head where applicable)')
  .option('--path <path>', 'Path for file-history queries')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action(async (opts) => (await C()).timeMachine({ action: 'query', cwd: opts.cwd, commit: opts.commit, kind: opts.kind, path: opts.path }));

timeMachineCommand
  .command('validate')
  .description('Run Time Machine validation classes A-G and write proof-backed reports')
  .option('--class <classes>', 'Comma-separated validation classes: A,B,C,D,E,F,G')
  .option('--scale <scale>', 'smoke | prd | prd-real | benchmark (prd uses logical chains; prd-real uses on-disk fs at PRD scale)', 'smoke')
  .option('--out <path>', 'Output directory (default: .danteforge/time-machine/validation/<runId>)')
  .option('--delegate52-mode <mode>', 'harness | import | live', 'harness')
  .option('--delegate52-dataset <pathOrUrl>', 'Public DELEGATE-52 JSON/JSONL dataset or imported result file')
  .option('--budget-usd <n>', 'Budget ceiling for live DELEGATE-52 runs', parseFloat)
  .option('--resume-from <path>', 'Resume live DELEGATE-52 from an existing validation output directory')
  .option('--prior-spend-usd <n>', 'Prior live spend to count against --budget-usd during resumed validation', parseFloat)
  .option('--max-domains <n>', 'Maximum DELEGATE-52 domains to include', parseInt)
  .option('--max-commits <n>', 'Maximum Class F benchmark commits; explicit value overrides DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS', parseInt)
  .option('--benchmark-time-budget-minutes <n>', 'Class F benchmark wall-clock budget; exhausted budget emits a partial report', parseFloat)
  .option('--round-trips <n>', 'Round-trips per domain for live DELEGATE-52 (PRD spec: 10)', parseInt)
  .option('--mitigate-divergence', 'Restore and retry when a DELEGATE-52 round-trip diverges')
  .option('--retries-on-divergence <n>', 'Retry attempts per divergence when mitigation is enabled', parseInt)
  .option('--mitigation-strategy <s>', 'substrate-restore-retry (default) | prompt-only-retry | no-mitigation | smart-retry | edit-journal | surgical-patch')
  .option('--json', 'Output machine-readable JSON')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action(async (opts) => (await C()).timeMachine({
    action: 'validate',
    cwd: opts.cwd,
    classes: opts.class,
    scale: opts.scale,
    out: opts.out,
    delegate52Mode: opts.delegate52Mode,
    delegate52Dataset: opts.delegate52Dataset,
    budgetUsd: opts.budgetUsd,
    delegate52ResumeFrom: opts.resumeFrom,
    priorSpendUsd: opts.priorSpendUsd,
    maxDomains: opts.maxDomains,
    maxCommits: opts.maxCommits,
    benchmarkTimeBudgetMinutes: opts.benchmarkTimeBudgetMinutes,
    roundTripsPerDomain: opts.roundTrips,
    mitigateDivergence: opts.mitigateDivergence,
    retriesOnDivergence: opts.retriesOnDivergence,
    mitigationStrategy: opts.mitigationStrategy,
    json: opts.json,
  }));

const timeMachineNodeCommand = timeMachineCommand
  .command('node')
  .description('Inspect and trace DecisionNodes in the JSONL store');

timeMachineNodeCommand
  .command('list')
  .description('List DecisionNodes filtered by session or timeline')
  .option('--session <id>', 'Filter by session id')
  .option('--timeline <id>', 'Filter by timeline id')
  .option('--store <path>', 'Path to decision-nodes JSONL store', '.danteforge/decision-nodes.jsonl')
  .option('--json', 'Output full JSON array')
  .action(async (opts) => (await C()).timeMachine({
    action: 'node-list',
    session: opts.session,
    timeline: opts.timeline,
    store: opts.store,
    json: opts.json,
  }));

timeMachineNodeCommand
  .command('trace <nodeId>')
  .description('Print the full ancestor chain for a DecisionNode (root→leaf)')
  .option('--store <path>', 'Path to decision-nodes JSONL store', '.danteforge/decision-nodes.jsonl')
  .option('--json', 'Output full chain as JSON')
  .action(async (nodeId: string, opts) => (await C()).timeMachine({
    action: 'node-trace',
    nodeId,
    store: opts.store,
    json: opts.json,
  }));

timeMachineCommand
  .command('replay <nodeId>')
  .description('Run a counterfactual replay from a DecisionNode with an altered prompt')
  .requiredOption('--input <prompt>', 'The altered prompt to replay from the branch point')
  .option('--store <path>', 'Path to decision-nodes JSONL store', '.danteforge/decision-nodes.jsonl')
  .option('--session <id>', 'Session id for querying the original path (default: "default")')
  .option('--dry-run', 'Print the replay plan without executing LLM calls')
  .option('--pipeline-mode', 'Run the full DanteForge magic pipeline instead of a single LLM call')
  .option('--json', 'Output full CounterfactualReplayResult as JSON')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action(async (nodeId: string, opts) => (await C()).timeMachine({
    action: 'replay',
    nodeId,
    alteredInput: opts.input,
    store: opts.store,
    session: opts.session,
    dryRun: opts.dryRun,
    pipelineMode: opts.pipelineMode,
    json: opts.json,
    cwd: opts.cwd,
  }));

timeMachineNodeCommand
  .command('attribute <nodeId>')
  .description('Run causal attribution on a DecisionNode — classify downstream nodes as independent/dependent-adaptable/dependent-incompatible')
  .option('--store <path>', 'Path to decision-nodes JSONL store', '.danteforge/decision-nodes.jsonl')
  .option('--session <id>', 'Session id for querying the original timeline (default: "default")')
  .option('--with-llm', 'Escalate low-confidence attributions to the LLM for a second opinion')
  .option('--json', 'Output full CausalAttributionResult as JSON')
  .action(async (nodeId: string, opts) => (await C()).timeMachine({
    action: 'node-attribute',
    nodeId,
    store: opts.store,
    session: opts.session,
    withLlm: opts.withLlm,
    json: opts.json,
  }));

timeMachineNodeCommand
  .command('eval-attribution')
  .description('Evaluate causal attribution precision/recall against a labeled DecisionNode corpus')
  .requiredOption('--labels <file>', 'JSON label file with branchPointId and expected classifications')
  .option('--store <path>', 'Path to decision-nodes JSONL store', '.danteforge/decision-nodes.jsonl')
  .option('--out <file>', 'Write the evaluation report JSON to this path')
  .option('--json', 'Output full evaluation report as JSON')
  .action(async (opts) => (await C()).timeMachine({
    action: 'node-eval-attribution',
    labelsFile: opts.labels,
    store: opts.store,
    out: opts.out,
    json: opts.json,
  }));

timeMachineNodeCommand
  .command('build-corpus')
  .description('Build Time Machine replay-session corpus artifacts and human label drafts from DecisionNodes')
  .option('--store <path>', 'Path to decision-nodes JSONL store', '.danteforge/decision-nodes.jsonl')
  .option('--out <dir>', 'Output corpus directory (default: .danteforge/evidence/time-machine-corpus/<timestamp>)')
  .option('--min-sessions <n>', 'Minimum replayed sessions required by the evidence gate', parseInt)
  .option('--min-labels <n>', 'Minimum downstream labels required by the evidence gate', parseInt)
  .option('--json', 'Output full corpus manifest as JSON')
  .action(async (opts) => (await C()).timeMachine({
    action: 'node-build-corpus',
    store: opts.store,
    out: opts.out,
    minSessions: opts.minSessions,
    minLabels: opts.minLabels,
    json: opts.json,
  }));

timeMachineNodeCommand
  .command('timeline')
  .description('Render a side-by-side ASCII timeline diff of two replay branches')
  .option('--result <file>', 'Path to a stored CounterfactualReplayResult JSON file')
  .option('--store <path>', 'Path to decision-nodes JSONL store', '.danteforge/decision-nodes.jsonl')
  .option('--session <id>', 'Session id (for store-reconstruction mode)')
  .option('--original <timelineId>', 'Original timeline id (for store-reconstruction mode)')
  .option('--alternate <timelineId>', 'Alternate timeline id (for store-reconstruction mode)')
  .option('--width <n>', 'Terminal width for rendering', '120')
  .option('--json', 'Output raw CounterfactualReplayResult JSON instead of ASCII')
  .action(async (opts) => (await C()).timeMachine({
    action: 'timeline',
    resultFile: opts.result,
    store: opts.store,
    session: opts.session,
    originalTimeline: opts.original,
    alternateTimeline: opts.alternate,
    timelineWidth: opts.width ? parseInt(opts.width, 10) : 120,
    json: opts.json,
  }));

program
  .command('cost')
  .description('Display token usage and cost breakdown from this session')
  .option('--by-agent', 'Break down by agent role')
  .option('--by-tier', 'Break down by model tier')
  .option('--savings', 'Show token savings from routing and compression')
  .option('--history', 'Show all sessions in chronological order')
  .action(async (opts) => (await C()).cost({
    byAgent: opts.byAgent,
    byTier: opts.byTier,
    savings: opts.savings,
    history: opts.history,
  }));

program
  .command('economy')
  .description('Context Economy report — token savings by filter, top passthroughs, sacred bypasses (Article XIV)')
  .option('--json', 'Machine-readable JSON output for scripting and scorer')
  .option('--since <date>', 'Date-windowed report (YYYY-MM-DD)')
  .option('--organ <organ>', 'Filter by organ (forge|code|agents)')
  .option('--fail-below <score>', 'Exit non-zero when economy score is below threshold', parseFloat)
  .action(async (opts) => {
    const { scoreContextEconomy } = await import('../core/context-economy/runtime.js');
    const { formatLedgerReport } = await import('../core/context-economy/economy-ledger.js');
    const report = await scoreContextEconomy(process.cwd(), {
      since: opts.since,
      organ: opts.organ,
    });

    if (opts.json) {
      process.stdout.write(JSON.stringify({
        score: report.score,
        subscores: report.subscores,
        recordsInWindow: report.recordsInWindow,
        since: report.since,
        organ: report.organ,
        ...report.summary,
        summary: report.summary,
      }, null, 2) + '\n');
    } else {
      process.stdout.write(`Context Economy Score: ${report.score}/100\n\n`);
      process.stdout.write(formatLedgerReport(report.summary, false) + '\n');
    }

    if (opts.failBelow !== undefined && report.score < opts.failBelow) {
      process.exit(1);
    }
  });

program
  .command('audit-export')
  .description('Export audit trail to JSON, CSV, or Markdown for compliance reporting')
  .option('--format <type>', 'Output format: json, csv, markdown (default: json)', 'json')
  .option('--since <date>', 'Filter entries since ISO date (e.g., 2026-01-01)')
  .option('--output <path>', 'Write to file instead of stdout')
  .option('--json', 'Machine-readable JSON output')
  .action(async (opts) => {
    const { auditExport } = await import('./commands/audit-export.js');
    await auditExport(opts);
  });

program
  .command('causal-status')
  .description('Show per-dimension prediction accuracy from the causal weight matrix (Article XV)')
  .option('--json', 'Output raw causal weight matrix as JSON')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    try {
      const { causalStatus } = await import('./commands/causal-status.js');
      await causalStatus({ json: opts.json, cwd: opts.cwd });
    } catch (err) {
      formatAndLogError(err, 'causal-status');
      process.exitCode = 1;
    }
  });

program
  .command('assess')
  .description('Harsh self-assessment: score all 20 dimensions, benchmark vs 27 competitors, generate masterplan')
  .option('--no-harsh', 'Use normal PDSE thresholds instead of harsh mode')
  .option('--no-competitors', 'Skip competitor benchmarking')
  .option('--min-score <n>', 'Target score threshold (default: 9.0)', '9.0')
  .option('--json', 'Output machine-readable JSON')
  .option('--preset <level>', 'Preset for target maturity level')
  .option('--set-baseline', 'Reset the session baseline score to the current score')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    try {
      await (await C()).assess({
        harsh: opts.harsh !== false,
        competitors: opts.competitors !== false,
        minScore: parseFloat(opts.minScore),
        json: opts.json,
        preset: opts.preset,
        setBaseline: opts.setBaseline as boolean | undefined,
        cwd: opts.cwd,
      });
    } catch (err) {
      formatAndLogError(err, 'assess');
      process.exitCode = 1;
    }
  });

program
  .command('benchmark')
  .description('18-dimension scorecard — real scores across all quality dimensions with optional competitor comparison')
  .option('--dimension <dim>', 'Score only one named dimension')
  .option('--compare', 'Show gap vs CHL matrix competitor scores')
  .option('--format <fmt>', 'Output format: table or json (default: table)', 'table')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    try {
      await (await C()).benchmark({
        dimension: opts.dimension,
        compare: opts.compare,
        format: opts.format,
        cwd: opts.cwd,
      });
    } catch (err) {
      formatAndLogError(err, 'benchmark');
      process.exitCode = 1;
    }
  });

program
  .command('showcase')
  .description('Score any project with the full harsh scorer and generate docs/CASE_STUDY.md — reproducible external proof')
  .option('--project <path>', 'Path to project directory (default: examples/todo-app)')
  .option('--format <fmt>', 'Output format: markdown or json (default: markdown)', 'markdown')
  .option('--cwd <path>', 'Working directory')
  .action(async (opts) => {
    try {
      await (await C()).showcase({
        project: opts.project,
        format: opts.format as 'markdown' | 'json' | undefined,
        cwd: opts.cwd,
      });
    } catch (err) {
      formatAndLogError(err, 'showcase');
      process.exitCode = 1;
    }
  });

program
  .command('next')
  .description('Strategic advisor: reads all project state and recommends the highest-ROI next action')
  .option('--cwd <path>', 'Project directory')
  .option('--prompt', 'Print prompt without calling LLM')
  .action(async (opts) => {
    try {
      const { runNext } = await import('./commands/next.js');
      await runNext({ cwd: opts.cwd, promptMode: opts.prompt });
    } catch (err) {
      formatAndLogError(err, 'next');
      process.exitCode = 1;
    }
  });

program
  .command('frontier-gap [dimension]')
  .description('Frontier Gap Engine: rank skeptic objections, classify gap types, prescribe smallest proof')
  .option('--raise-ready', 'Synthesize investor raise-readiness verdict')
  .option('--matrix <path>', 'Path to competitive matrix (default: .danteforge/compete/matrix.json)')
  .option('--project', 'Scope analysis to flagship workflow dimensions only')
  .option('--cwd <path>', 'Project directory')
  .action(async (dimension, opts) => {
    try {
      const { frontierGap } = await import('./commands/frontier-gap.js');
      await frontierGap({
        dimension,
        raiseReady: opts.raiseReady,
        matrix: opts.matrix,
        project: opts.project,
        cwd: opts.cwd,
      });
    } catch (err) {
      formatAndLogError(err, 'frontier-gap');
      process.exitCode = 1;
    }
  });

program
  .command('demo [fixture]')
  .description('Side-by-side demo: raw prompt quality vs DanteForge-structured quality')
  .option('--all', 'Run all demo fixtures')
  .option('--cwd <path>', 'Project directory')
  .action(async (fixture, opts) => {
    try {
      const { demo: demoCmd } = await import('./commands/demo.js');
      await demoCmd({ fixture, all: opts.all, cwd: opts.cwd });
    } catch (err) {
      formatAndLogError(err, 'demo');
      process.exitCode = 1;
    }
  });

program
  .command('explain [term]')
  .description('Plain-English glossary — explain any DanteForge term, command, or concept')
  .option('--list', 'List all available terms')
  .action(async (term, opts) => {
    try {
      const { explain: explainFn } = await import('./commands/explain.js');
      explainFn({ term, list: opts.list });
    } catch (err) {
      formatAndLogError(err, 'explain');
      process.exitCode = 1;
    }
  });

program
  .command('certify')
  .description('Generate a tamper-evident quality certificate (evidenceFingerprint) from convergence state')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    try {
      const { runCertify } = await import('./commands/certify.js');
      await runCertify({ cwd: opts.cwd });
    } catch (err) {
      formatAndLogError(err, 'certify');
      process.exitCode = 1;
    }
  });

program
  .command('outcome-check')
  .description('Re-measure quality scores to validate pattern adoption outcomes (lagging indicators)')
  .option('--cwd <path>', 'Project directory')
  .option('--days <n>', 'Days threshold for outcome check (default: 7)', '7')
  .action(async (opts) => {
    try {
      const { runOutcomeCheck } = await import('./commands/outcome-check.js');
      await runOutcomeCheck({ cwd: opts.cwd, daysThreshold: parseInt(opts.days, 10) });
    } catch (err) {
      formatAndLogError(err, 'outcome-check');
      process.exitCode = 1;
    }
  });

program
  .command('chart')
  .description('Show ASCII sparklines of convergence quality score history per dimension')
  .option('--cwd <path>', 'Project directory')
  .option('--dimension <name>', 'Show only this dimension')
  .option('--cycles <n>', 'How many recent cycles to show (default: 20)', '20')
  .action(async (opts) => {
    try {
      const { runChart } = await import('./commands/chart.js');
      await runChart({ cwd: opts.cwd, dimension: opts.dimension, cycles: parseInt(opts.cycles, 10) });
    } catch (err) {
      formatAndLogError(err, 'chart');
      process.exitCode = 1;
    }
  });

program
  .command('sprint-plan')
  .description('Generate next sprint plan from project state + auto-critique it before you build')
  .option('--max-cycles <n>', 'Max harvest-forge cycles in the generated plan (default: 5)', '5')
  .option('--stakes <level>', 'Critique depth: low|medium|high|critical (default: high)', 'high')
  .option('--skip-critique', 'Skip running plan critic after generation')
  .option('--auto-approve', 'Accept plan even if blocking gaps found (CI use)')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    void (async () => {
      try {
        const { runSprintPlan } = await import('./commands/sprint-plan.js');
        await runSprintPlan({
          maxCycles: parseInt(opts.maxCycles, 10),
          stakes: opts.stakes,
          skipCritique: opts.skipCritique,
          autoApprove: opts.autoApprove,
          cwd: opts.cwd,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'sprint-plan');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('critique-plan [plan-file]')
  .description('Adversarial pre-build plan review: 7 critique categories, LLM + deterministic, blocking/high/medium gaps')
  .option('--stakes <level>', 'Critique depth: low|medium|high|critical (default: medium)', 'medium')
  .option('--diff <file>', 'Also review a git diff against the plan (--diff path/to/diff.txt)')
  .option('--deterministic-only', 'Skip LLM augmentation — deterministic regex checks only')
  .option('--fail-on-blocking', 'Exit non-zero if any blocking gap is found (default: true)', true)
  .option('--cwd <path>', 'Project directory')
  .action(async (planFile, opts) => {
    void (async () => {
      try {
        const { runCritiquePlan } = await import('./commands/critique-plan.js');
        await runCritiquePlan({
          planFile,
          stakes: opts.stakes,
          diffFile: opts.diff,
          deterministicOnly: opts.deterministicOnly,
          failOnBlocking: opts.failOnBlocking,
          cwd: opts.cwd,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'critique-plan');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('self-improve [goal]')
  .description('Autonomous quality loop: assess → forge gaps → verify → repeat until 9+/10')
  .option('--min-score <n>', 'Target score threshold (default: 9.0)', '9.0')
  .option('--max-cycles <n>', 'Safety limit on loop cycles (default: 20)', '20')
  .option('--focus <dimension>', 'Focus on a specific dimension')
  .option('--preset <level>', 'Preset for target maturity level')
  .option('--cwd <path>', 'Project directory')
  .action(async (goal, opts) => { void (await C()).selfImprove({
    goal,
    minScore: parseFloat(opts.minScore),
    maxCycles: parseInt(opts.maxCycles, 10),
    focusDimensions: opts.focus ? [opts.focus] : undefined,
    preset: opts.preset,
    cwd: opts.cwd,
  }); });

program
  .command('define-done')
  .description('Define what "9+" means — sets the completion target used by assess and self-improve')
  .option('--reset', 'Clear existing target and re-prompt')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => { void (await C()).defineDone({
    reset: opts.reset,
    cwd: opts.cwd,
  }); });

program
  .command('universe')
  .description('View the competitive feature universe — all unique capabilities across competitors, scored')
  .option('--refresh', 'Force rebuild of feature universe from competitors')
  .option('--json', 'Output machine-readable JSON')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => { void (await C()).universe({
    refresh: opts.refresh,
    json: opts.json,
    cwd: opts.cwd,
  }); });

program
  .command('workspace <subcommand> [args...]')
  .description('Manage workspaces for multi-user projects')
  .option('--role <role>', 'Member role: owner, editor, reviewer', 'editor')
  .action(async (subcommand: string, args: string[], options: { role?: string }) => {
    await (await C()).workspace(subcommand, args ?? [], options);
  });

// First-run detection — suggest init when no .danteforge/ exists
program.hook('preAction', (_thisCommand, actionCommand) => {
  const skip = new Set(['init', 'config', 'doctor', 'help', 'setup', 'skills', 'docs', 'premium', 'workflow', 'mcp-server', 'publish-check', 'proof']);
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
Canonical Commands (use --level light|standard|deep):
  plan      "What should we build?"         light=review+specify, standard=full planning, deep=+tech-decide+tasks+critique
  build     "How do we make progress?"      light=forge, standard=magic, deep=inferno+OSS harvest
  measure   "How good is the project?"      light=score, standard=score+maturity+proof, deep=verify+adversary
  compete   "Where do we lag the market?"   light=assess, standard=assess+universe, deep=full CHL loop
  harvest   "What can we learn from OSS?"   light=focused pattern, standard=OSS pass, deep=OSS+local+universe

Preset Aliases:
  spark → plan --level light        (zero-token planning entry)
  magic → build --level standard    (balanced daily-driver)
  blaze → build --level deep        (high-power push)
  nova  → build --level deep --planning-prefix
  inferno → build --level deep --with-harvest  (maximum power)

Command Groups:
  Pipeline:        init, constitution, specify, clarify, tasks, forge, verify, synthesize
  Automation:      autoforge, autoresearch, party, ascend, self-improve
  Design:          design, ux-refine, browse, qa
  Intelligence:    tech-decide, debug, lessons, profile, retro, oss, local-harvest
  Self-Assessment: assess, maturity, score, quality
  Tools:           config, setup, doctor, dashboard, compact, import, skills, ship, premium, publish-check, mcp-server
  Meta:            help, review, feedback, update-mcp, awesome-scan, docs, workflow

Run "danteforge help <command>" for detailed help on any command.
Run "danteforge init" to set up a new project.

Common flags:
  --level <l>      Canonical intensity: light | standard | deep
  --light          Skip hard gates (constitution, spec, plan, tests)
  --prompt         Generate copy-paste prompt instead of auto-executing
  --profile <name> Use a specific quality profile
  --worktree       Run in isolated git worktree
  --verbose        Show debug output
`);

program
  .command('wiki-ingest')
  .description('Ingest raw source files into compiled wiki entity pages')
  .option('--bootstrap', 'Seed wiki from existing .danteforge/ artifacts')
  .option('--prompt', 'Show the command without executing')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => { void (await C()).wikiIngestCommand({
    bootstrap: opts.bootstrap,
    prompt: opts.prompt,
    cwd: opts.cwd,
  }); });

program
  .command('wiki-lint')
  .description('Run self-evolution scan: contradictions, staleness, link integrity, pattern synthesis')
  .option('--heuristic-only', 'Skip LLM calls (zero-cost mode)')
  .option('--prompt', 'Show the command without executing')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => { void (await C()).wikiLintCommand({
    heuristicOnly: opts.heuristicOnly,
    prompt: opts.prompt,
    cwd: opts.cwd,
  }); });

program
  .command('wiki-query <topic>')
  .description('Search wiki for entity pages, decisions, and patterns relevant to a topic')
  .option('--json', 'Output machine-readable JSON')
  .option('--cwd <path>', 'Project directory')
  .action(async (topic, opts) => { void (await C()).wikiQueryCommand({
    topic,
    json: opts.json,
    cwd: opts.cwd,
  }); });

program
  .command('wiki-status')
  .description('Display wiki health metrics: pages, link density, staleness, lint pass rate, anomalies')
  .option('--json', 'Output machine-readable JSON')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => { void (await C()).wikiStatusCommand({
    json: opts.json,
    cwd: opts.cwd,
  }); });

program
  .command('wiki-export')
  .description('Export compiled wiki as Obsidian vault or static HTML')
  .option('--format <type>', 'Export format: obsidian or html (default: obsidian)', 'obsidian')
  .option('--out <dir>', 'Output directory path')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => { void (await C()).wikiExportCommand({
    format: opts.format as 'obsidian' | 'html',
    out: opts.out,
    cwd: opts.cwd,
  }); });

program
  .command('self-assess')
  .description('Capture machine-verifiable quality metrics for this project and diff against previous baseline')
  .option('--llm-score <n>', 'LLM-assigned quality score to blend with objective metrics (default: 7.0)', '7.0')
  .option('--no-compare', 'Skip comparison against previous baseline')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    (async () => {
      try {
        const { runSelfAssess } = await import('./commands/self-assess.js');
        await runSelfAssess({
          llmScore: parseFloat(opts.llmScore ?? '7.0'),
          compareBaseline: opts.compare !== false,
          cwd: opts.cwd,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'self-assess');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('share-patterns')
  .description('Export anonymised pattern attribution data as a portable bundle for team sharing')
  .option('--min-samples <n>', 'Minimum adoption samples to include a pattern (default: 1)', '1')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    (async () => {
      try {
        const { runSharePatterns } = await import('./commands/share-patterns.js');
        await runSharePatterns({
          minSamples: parseInt(opts.minSamples ?? '1', 10),
          cwd: opts.cwd,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'share-patterns');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('import-patterns <bundle-file>')
  .description('Import a shared pattern bundle into the local global pattern library')
  .option('--trust-factor <n>', 'Trust weight for imported evidence (default: 0.5)', '0.5')
  .option('--cwd <path>', 'Project directory')
  .action(async (bundleFile, opts) => {
    (async () => {
      try {
        const { runImportPatterns } = await import('./commands/import-patterns.js');
        await runImportPatterns(bundleFile, {
          trustFactor: parseFloat(opts.trustFactor ?? '0.5'),
          cwd: opts.cwd,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'import-patterns');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('ci-report')
  .description('Run CI attribution gate: capture metrics, diff vs baseline, attribute regressions to recently adopted patterns')
  .option('--window <days>', 'Days back to attribute regressions', '7')
  .option('--threshold <score>', 'Score drop that triggers failure', '0.5')
  .option('--no-update', 'Do not update the baseline snapshot after running')
  .action(async (_opts) => {
    (async () => {
      try {
        const { runCIReportCommand } = await import('./commands/ci-report.js');
        await runCIReportCommand({
          cwd: process.cwd(),
          window: parseInt(_opts.window ?? '7'),
          threshold: parseFloat(_opts.threshold ?? '0.5'),
          noUpdate: !_opts.update,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'ci-report');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('external-validate <projects...>')
  .description('Validate DanteForge quality metrics against external open-source projects (calibration check)')
  .option('--tier <mapping>', 'Comma-separated label:tier pairs e.g. lodash:high,underscore:medium')
  .action(async (projectUrls: string[], _opts) => {
    (async () => {
      try {
        const { runExternalValidation } = await import('./commands/external-validate.js');
        const tierMap: Record<string, 'high' | 'medium' | 'low'> = {};
        if (_opts.tier) {
          for (const pair of (_opts.tier as string).split(',')) {
            const [label, tier] = pair.split(':');
            if (label && tier) tierMap[label.trim()] = tier.trim() as 'high' | 'medium' | 'low';
          }
        }
        const projects = projectUrls.map(url => {
          const label = url.split('/').pop() ?? url;
          return { label, url, expectedTier: tierMap[label] ?? 'medium' as const };
        });
        const report = await runExternalValidation(projects, { cwd: process.cwd() });
        for (const line of report.summary) {
          const { logger } = await import('../core/logger.js');
          logger.info(line);
        }
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'external-validate');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('self-mutate')
  .description('Run mutation testing on DanteForge\'s own core files to validate test quality. Reports per-file mutation score and overall gate pass/fail.')
  .option('--min-score <n>', 'Minimum mutation score to pass gate (0-1)', '0.6')
  .option('--max-mutants <n>', 'Max mutants tested per file', '10')
  .action(async (_opts) => {
    (async () => {
      try {
        const { runSelfMutate } = await import('./commands/self-mutate.js');
        const { logger } = await import('../core/logger.js');
        const result = await runSelfMutate({
          cwd: process.cwd(),
          minMutationScore: parseFloat(_opts.minScore ?? '0.6'),
          maxMutantsPerFile: parseInt(_opts.maxMutants ?? '10'),
        });
        logger.info(`\nSelf-Mutate Results:`);
        for (const f of result.perFile) {
          const icon = f.mutationScore >= 0.7 ? '✓' : f.mutationScore >= 0.5 ? '~' : '✗';
          logger.info(`  ${icon} ${f.file}: ${(f.mutationScore * 100).toFixed(0)}% (${f.killed}/${f.total} killed)`);
        }
        logger.info(`\nOverall mutation score: ${(result.overallScore * 100).toFixed(0)}%`);
        logger.info(`Gate: ${result.gatePass ? 'PASS' : 'FAIL'} (min ${(result.minMutationScore * 100).toFixed(0)}%)`);
        logger.info(`Report: ${result.reportPath}`);
        if (!result.gatePass) process.exitCode = 1;
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'self-mutate');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('refused-patterns')
  .description('List, add, or remove patterns from the refused (blocklist) store')
  .option('--add <name>', 'Manually block a pattern by name')
  .option('--remove <name>', 'Unblock a pattern by name')
  .option('--clear', 'Clear the entire refused-patterns blocklist')
  .action(async (opts) => {
    void (async () => {
      try {
        const { runRefusedPatterns } = await import('./commands/refused-patterns.js');
        await runRefusedPatterns({
          add: opts.add as string | undefined,
          remove: opts.remove as string | undefined,
          clear: opts.clear as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'refused-patterns');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('respec')
  .description('Re-run specification with lessons learned and refused patterns injected')
  .action(async () => {
    void (async () => {
      try {
        const { runRespec } = await import('./commands/respec.js');
        const result = await runRespec();
        if (!result.revised) process.exitCode = 1;
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'respec');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('cross-synthesize')
  .description('Synthesize winning patterns from attribution history to escape a plateau')
  .option('--window <n>', 'Number of recent attribution records to analyze (default: 10)', '10')
  .action(async (opts) => {
    void (async () => {
      try {
        const { runCrossSynthesize } = await import('./commands/cross-synthesize.js');
        const result = await runCrossSynthesize({ window: parseInt(opts.window as string, 10) });
        if (!result.written) process.exitCode = 1;
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'cross-synthesize');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('flow')
  .description('Show the 5 DanteForge workflows and what to run next')
  .option('--interactive', 'Get a personalized workflow recommendation')
  .action(async (opts) => {
    void (async () => {
      try {
        const { runFlow } = await import('./commands/flow.js');
        await runFlow({ interactive: opts.interactive as boolean | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'flow');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('guide')
  .description('Generate a project-specific guide at .danteforge/GUIDE.md')
  .action(async () => {
    void (async () => {
      try {
        const { runGuide } = await import('./commands/guide.js');
        const result = await runGuide();
        logger.info(`Guide written: ${result.guidePath}`);
        logger.info('Load in Claude Code: @.danteforge/GUIDE.md');
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'guide');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('compete')
  .description('Benchmark against peers and close competitive gaps. --level selects depth: light=assess, standard=assess+universe, deep=full CHL loop.')
  .option('--level <level>', 'Canonical intensity: light | standard | deep')
  .option('--refresh', 'Force rebuild of feature universe after assessment')
  .option('--init', 'Bootstrap CHL matrix from a competitor scan (Phase 1: INVENTORY)')
  .option('--sprint', 'Identify top gap and generate /inferno masterplan (Phase 3: SOURCE)')
  .option('--rescore <score>', 'Update dimension score after a sprint, e.g. "ux_polish=7.5" or "ux_polish=7.5,sha"')
  .option('--report', 'Generate full CHL report at .danteforge/compete/COMPETE_REPORT.md')
  .option('--json', 'Machine-readable output')
  .option('--skip-verify', 'Skip verify receipt check (use when certifying without running verify)')
  .option('--validate', 'Cross-check matrix self-scores against latest harsh-scorer assessment')
  .option('--sync-scores', 'Sync all matrix self-scores from the live strict scorer (eliminates drift automatically)')
  .option('--auto', 'Run autonomous sprint+rescore loop (up to 5 cycles, stops when all gaps closed)')
  .option('--remove-competitor <name>', 'Remove a competitor from the matrix and recompute gaps')
  .option('--drop-dimension <id>', 'Remove a scoring dimension from the matrix')
  .option('--edit', 'Interactive matrix amendment session')
  .option('--yes', 'Skip the confirmation gate in --auto mode')
  .action(async (opts) => {
    if (opts.level) {
      return (await C()).canonicalCompete({
        level: opts.level as string,
        json: opts.json as boolean | undefined,
        refresh: opts.refresh as boolean | undefined,
        yes: opts.yes as boolean | undefined,
      });
    }
    void (async () => {
      try {
        const { compete } = await import('./commands/compete.js');
        const result = await compete({
          init: opts.init as boolean | undefined,
          sprint: opts.sprint as boolean | undefined,
          rescore: opts.rescore as string | undefined,
          report: opts.report as boolean | undefined,
          json: opts.json as boolean | undefined,
          skipVerify: opts.skipVerify as boolean | undefined,
          validate: opts.validate as boolean | undefined,
          syncScores: opts.syncScores as boolean | undefined,
          auto: opts.auto as boolean | undefined,
          removeCompetitor: opts.removeCompetitor as string | undefined,
          dropDimension: opts.dropDimension as string | undefined,
          edit: opts.edit as boolean | undefined,
          yes: opts.yes as boolean | undefined,
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        }
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'compete');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('cofl')
  .description('Competitive Operator Forge Loop: 10-phase disciplined system to learn from OSS operator tools, forge improvements, and prove progress vs closed-source leaders')
  .option('--universe', 'Phases 1-2: refresh + partition competitor universe into roles (direct_peer / specialist_teacher / reference_teacher)')
  .option('--harvest', 'Phase 3: extract operator patterns from teacher set (requires LLM)')
  .option('--prioritize', 'Phase 5: rank opportunities by operator leverage score')
  .option('--guards', 'Run all 7 anti-failure guardrail checks')
  .option('--reframe', 'Phase 10: assess strategic position (preferred? coherent? inflating rows?)')
  .option('--report', 'Write COFL_REPORT.md to .danteforge/cofl/')
  .option('--auto', 'Run all phases in sequence (advisory — forge step prints recommendation)')
  .option('--dry-run', 'Print plan without executing')
  .option('--json', 'Machine-readable output')
  .action((opts) => {
    void (async () => {
      try {
        const { cofl } = await import('./commands/cofl.js');
        const result = await cofl({
          universe: opts.universe as boolean | undefined,
          harvest: opts.harvest as boolean | undefined,
          prioritize: opts.prioritize as boolean | undefined,
          guards: opts.guards as boolean | undefined,
          reframe: opts.reframe as boolean | undefined,
          report: opts.report as boolean | undefined,
          auto: opts.auto as boolean | undefined,
          dryRun: opts.dryRun as boolean | undefined,
          json: opts.json as boolean | undefined,
        });
        if (opts.json && result) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        }
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'cofl');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('ascend')
  .alias('auto-improve')
  .description('Autonomous quality ascent: drives all achievable competitive dimensions to target (default 9.0/10)')
  .option('--target <n>', 'target score for all dimensions (0-10)', parseFloat, 9.0)
  .option('--max-cycles <n>', 'max total improvement cycles', parseInt, 60)
  .option('--dry-run', 'print plan without executing')
  .option('--interactive', 'ask questions to define competitive universe (requires TTY)')
  .option('--forge-provider <provider>', 'LLM provider for forge cycles (e.g. claude, grok, openai)')
  .option('--scorer-provider <provider>', 'LLM provider for adversarial critique after each forge cycle')
  .option('--max-dim-retries <n>', 'max times to retry same dimension after critic is unsatisfied (default: 2)', parseInt, 2)
  .option('--adversarial-gating', 'require adversarial score agreement before declaring convergence')
  .option('--adversary-tolerance <n>', 'acceptable gap between self and adversarial score for convergence (default: 0.5)', parseFloat, 0.5)
  .option('--yes', 'Skip the competitive landscape confirmation gate')
  .option('--retro-interval <n>', 'cycles between automatic retro runs during loop (default: 5)', parseInt, 5)
  .option('--no-auto-harvest', 'skip OSS harvest receipt bootstrap at ascend start')
  .option('--no-verify-loop', 'skip mid-loop verify pass before first cycle')
  .option('--advisory', 'write guidance files per dimension without executing forge (preview mode)')
  .action((opts) => {
    void (async () => {
      try {
        const { ascend } = await import('./commands/ascend.js');
        await ascend({
          target: opts.target as number | undefined,
          maxCycles: opts.maxCycles as number | undefined,
          dryRun: opts.dryRun as boolean | undefined,
          interactive: opts.interactive as boolean | undefined,
          forgeProvider: opts.forgeProvider as string | undefined,
          scorerProvider: opts.scorerProvider as string | undefined,
          maxDimRetries: opts.maxDimRetries as number | undefined,
          adversarialGating: opts.adversarialGating as boolean | undefined,
          adversaryTolerance: opts.adversaryTolerance as number | undefined,
          yes: opts.yes as boolean | undefined,
          retroInterval: opts.retroInterval as number | undefined,
          autoHarvest: opts.autoHarvest as boolean | undefined,
          verifyLoop: opts.verifyLoop as boolean | undefined,
          executeMode: opts.advisory ? 'advisory' : 'forge',
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'ascend');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('measure')
  .alias('score')
  .description('Measure project quality. --level selects depth: light=quick score, full=all dimensions, standard=score+maturity+proof, deep=verify+adversary.')
  .option('--level <level>', 'Canonical intensity: light | full | standard | deep')
  .option('--full', 'Show all 19 dimensions (like assess)')
  .option('--strict', 'Use only code-derived signals — excludes mutable STATE.yaml fields for tamper-resistant scoring')
  .option('--adversary', 'Run a second independent LLM to challenge the self-score and detect inflation')
  .option('--json', 'Machine-readable JSON output')
  .action(async (opts) => {
    if (opts.level) {
      return (await C()).canonicalMeasure({
        level: opts.level as string,
        full: opts.full as boolean | undefined,
        strict: opts.strict as boolean | undefined,
        adversary: opts.adversary as boolean | undefined,
        json: opts.json as boolean | undefined,
      });
    }
    void (async () => {
      try {
        const { score } = await import('./commands/score.js');
        await score({
          full: opts.full as boolean | undefined,
          strict: opts.strict as boolean | undefined,
          adversary: opts.adversary as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'score');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('quality')
  .description('Visual quality scorecard: dimension bars, P0 gaps, and automation ceilings')
  .option('--json', 'Output machine-readable JSON with score, dimensions, P0 gaps, and badge markdown')
  .action((opts) => {
    void (async () => {
      try {
        const { quality } = await import('./commands/quality.js');
        await quality({ json: opts.json as boolean | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'quality');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('prime')
  .description('Generate .danteforge/PRIME.md — 200-word session brief for Claude Code')
  .option('--copy', 'Show clipboard copy hint after writing')
  .action((opts) => {
    void (async () => {
      try {
        const { prime } = await import('./commands/prime.js');
        await prime({ copy: opts.copy as boolean | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'prime');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('teach <correction>')
  .description('Capture an AI correction into lessons.md and auto-update PRIME.md')
  .action((correction) => {
    void (async () => {
      try {
        const { teach } = await import('./commands/teach.js');
        await teach({ correction });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'teach');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('go [goal]')
  .alias('start')
  .description('Smart entry point: shows project state on existing projects, setup wizard on first run')
  .option('--yes', 'Skip confirmation and run immediately')
  .option('--simple', 'Show only core project quality gaps (hides meta/ecosystem dimensions)')
  .action((goal, opts) => {
    void (async () => {
      try {
        const { go } = await import('./commands/go.js');
        await go({ goal: goal as string | undefined, yes: opts.yes as boolean | undefined, simple: opts.simple as boolean | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'go');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('quickstart [idea]')
  .description('Guided 5-minute setup: init → constitution → first spark → quality score')
  .option('--simple', 'Template-based setup — no LLM needed, under 90 seconds')
  .option('--non-interactive', 'Skip all prompts (for CI or scripted flows)')
  .action((idea, opts) => {
    void (async () => {
      try {
        const { quickstart } = await import('./commands/quickstart.js');
        await quickstart({
          idea: idea as string | undefined,
          simple: opts.simple as boolean | undefined,
          nonInteractive: opts.nonInteractive as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'quickstart');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('harvest-pattern <pattern>')
  .description('Focused OSS pattern harvest with Y/N confirmation per gap')
  .option('--max-repos <n>', 'Max repos to search (default: 5)', '5')
  .option('--url <github-url>', 'Target a specific GitHub repo URL directly (bypass search)')
  .action((pattern, opts) => {
    void (async () => {
      try {
        const { harvestPattern } = await import('./commands/harvest-pattern.js');
        await harvestPattern({
          pattern,
          maxRepos: parseInt(opts.maxRepos as string, 10),
          url: opts.url as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'harvest-pattern');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('build <spec>')
  .description('Execute product work. --level selects depth: light=forge, standard=magic, deep=inferno. Without --level runs the full spec-to-ship wizard.')
  .option('--level <level>', 'Canonical intensity: light | standard | deep')
  .option('--interactive', 'Confirm before each stage (wizard mode only)')
  .option('--profile <type>', 'quality | balanced | budget', 'balanced')
  .option('--prompt', 'Generate copy-paste prompt instead of executing')
  .option('--worktree', 'Run in an isolated git worktree')
  .option('--isolation', 'Use isolation when preset escalates into party mode')
  .option('--max-repos <n>', 'Max repos for deep OSS harvest', '12')
  .option('--yes', 'Skip competitive matrix confirmation gate')
  .action(async (spec, opts) => {
    if (opts.level) {
      return (await C()).canonicalBuild(spec as string, {
        level: opts.level as string,
        prompt: opts.prompt as boolean | undefined,
        profile: opts.profile as string | undefined,
        worktree: opts.worktree as boolean | undefined,
        isolation: opts.isolation as boolean | undefined,
        maxRepos: opts.maxRepos ? parseInt(opts.maxRepos as string, 10) : undefined,
        yes: opts.yes as boolean | undefined,
      });
    }
    void (async () => {
      try {
        const { build } = await import('./commands/build.js');
        await build({ spec: spec as string, interactive: opts.interactive as boolean | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'build');
        process.exitCode = 1;
      }
    })();
  });

// ── Dossier command group ─────────────────────────────────────────────────────
const dossierGroup = program
  .command('dossier')
  .description('Competitor dossier management — build source-backed evidence + scores');

dossierGroup
  .command('build [competitor]')
  .description('Build or refresh a competitor dossier')
  .option('--all', 'Rebuild all competitors in registry')
  .option('--sources <urls>', 'Comma-separated source URLs (override registry)')
  .option('--since <duration>', 'Skip if dossier fresher than duration (e.g. 7d)')
  .action((competitor, opts) => {
    void (async () => {
      try {
        const { dossierBuild } = await import('./commands/dossier.js');
        await dossierBuild(competitor as string | undefined, {
          all: opts.all as boolean | undefined,
          sources: opts.sources as string | undefined,
          since: opts.since as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'dossier build');
        process.exitCode = 1;
      }
    })();
  });

dossierGroup
  .command('diff <competitor>')
  .description('Show what changed since last dossier build')
  .action((competitor) => {
    void (async () => {
      try {
        const { dossierDiff } = await import('./commands/dossier.js');
        await dossierDiff(competitor as string);
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'dossier diff');
        process.exitCode = 1;
      }
    })();
  });

dossierGroup
  .command('show <competitor>')
  .description('Pretty-print a competitor dossier')
  .option('--dim <n>', 'Show single dimension evidence')
  .action((competitor, opts) => {
    void (async () => {
      try {
        const { dossierShow } = await import('./commands/dossier.js');
        await dossierShow(competitor as string, { dim: opts.dim as string | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'dossier show');
        process.exitCode = 1;
      }
    })();
  });

dossierGroup
  .command('list')
  .description('List all built dossiers with composite scores')
  .action(() => {
    void (async () => {
      try {
        const { dossierList } = await import('./commands/dossier.js');
        await dossierList();
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'dossier list');
        process.exitCode = 1;
      }
    })();
  });

// ── Landscape command group ───────────────────────────────────────────────────
const landscapeGroup = program
  .command('landscape')
  .description('Competitive landscape matrix assembled from all dossiers')
  .action(() => {
    void (async () => {
      try {
        const { landscapeBuild } = await import('./commands/landscape-cmd.js');
        await landscapeBuild();
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'landscape');
        process.exitCode = 1;
      }
    })();
  });

landscapeGroup
  .command('diff')
  .description('Show landscape staleness and last-generated metadata')
  .action(() => {
    void (async () => {
      try {
        const { landscapeDiff } = await import('./commands/landscape-cmd.js');
        await landscapeDiff();
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'landscape diff');
        process.exitCode = 1;
      }
    })();
  });

landscapeGroup
  .command('ranking')
  .description('Print sorted competitor rankings table')
  .action(() => {
    void (async () => {
      try {
        const { landscapeRanking } = await import('./commands/landscape-cmd.js');
        await landscapeRanking();
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'landscape ranking');
        process.exitCode = 1;
      }
    })();
  });

landscapeGroup
  .command('gap')
  .description('Show dimensions where DC lags the leader by >1.0')
  .option('--target <id>', 'Target competitor id (default: dantescode)')
  .action((opts) => {
    void (async () => {
      try {
        const { landscapeGap } = await import('./commands/landscape-cmd.js');
        await landscapeGap({ target: (opts as { target?: string }).target });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'landscape gap');
        process.exitCode = 1;
      }
    })();
  });

// ── Rubric command group ──────────────────────────────────────────────────────
const rubricGroup = program
  .command('rubric')
  .description('Scoring rubric management — frozen criteria for each dimension');

rubricGroup
  .command('show')
  .description('Print full rubric or single dimension criteria')
  .option('--dim <n>', 'Show criteria for one dimension')
  .action((opts) => {
    void (async () => {
      try {
        const { rubricShow } = await import('./commands/rubric-cmd.js');
        await rubricShow({ dim: (opts as { dim?: string }).dim });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'rubric show');
        process.exitCode = 1;
      }
    })();
  });

rubricGroup
  .command('init')
  .description('Initialize rubric.json (checks if already present)')
  .action(() => {
    void (async () => {
      try {
        const { rubricInit } = await import('./commands/rubric-cmd.js');
        await rubricInit();
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'rubric init');
        process.exitCode = 1;
      }
    })();
  });

rubricGroup
  .command('validate')
  .description('Check all dossiers have evidence for each rubric dimension')
  .action(() => {
    void (async () => {
      try {
        const { rubricValidate } = await import('./commands/rubric-cmd.js');
        await rubricValidate();
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'rubric validate');
        process.exitCode = 1;
      }
    })();
  });

rubricGroup
  .command('add-dim')
  .description('Add a new dimension to the rubric')
  .option('--name <name>', 'Dimension name')
  .action((opts) => {
    void (async () => {
      try {
        const { rubricAddDim } = await import('./commands/rubric-cmd.js');
        await rubricAddDim({ name: (opts as { name?: string }).name });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'rubric add-dim');
        process.exitCode = 1;
      }
    })();
  });

// ── rubric-score group ────────────────────────────────────────────────────────
const rubricScoreGroup = program
  .command('rubric-score')
  .description('Triple-rubric scoring: internal_optimistic, public_defensible, hostile_diligence');

rubricScoreGroup
  .option('--matrix <id>', 'Matrix ID (default: product-28)')
  .option('--subject <name>', 'Subject being scored (e.g. DanteCode)')
  .option('--evidence <path>', 'Path to JSON evidence file')
  .option('--rubrics <list>', 'Comma-separated rubric IDs (default: all three)')
  .option('--out <path>', 'Output path prefix (creates .md + .json)')
  .action((opts) => {
    void (async () => {
      try {
        const { rubricScore } = await import('./commands/score-rubric.js');
        await rubricScore({
          matrix: (opts as { matrix?: string }).matrix,
          subject: (opts as { subject?: string }).subject,
          evidence: (opts as { evidence?: string }).evidence,
          rubrics: (opts as { rubrics?: string }).rubrics,
          out: (opts as { out?: string }).out,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'rubric-score');
        process.exitCode = 1;
      }
    })();
  });

rubricScoreGroup
  .command('diff')
  .description('Compare two scoring snapshots and report changes')
  .requiredOption('--before <path>', 'Path to before JSON snapshot')
  .requiredOption('--after <path>', 'Path to after JSON snapshot')
  .option('--out <path>', 'Write diff report to file')
  .action((opts) => {
    void (async () => {
      try {
        const { rubricScoreDiff } = await import('./commands/score-rubric.js');
        await rubricScoreDiff({
          before: (opts as { before: string }).before,
          after: (opts as { after: string }).after,
          out: (opts as { out?: string }).out,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'rubric-score diff');
        process.exitCode = 1;
      }
    })();
  });

// ── dantecode ─────────────────────────────────────────────────────────────────
program
  .command('dantecode')
  .description('Install or update DanteCode VS Code extension, wired to the latest DanteForge build (PRD-26 + quality layer)')
  .option('--dantecode-path <path>', 'Path to DanteCode repo (default: ../DanteCode sibling)')
  .option('--dry-run', 'Print what would be done without executing')
  .action(async (opts) => {
    try {
      const { spawn } = await import('node:child_process');
      const { resolve, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const scriptDir = dirname(fileURLToPath(import.meta.url));
      const installerPath = resolve(scriptDir, '..', '..', 'scripts', 'install-dantecode.mjs');
      const args: string[] = [];
      if ((opts as { dantecodePath?: string }).dantecodePath) {
        args.push(`--dantecode-path=${(opts as { dantecodePath: string }).dantecodePath}`);
      }
      if ((opts as { dryRun?: boolean }).dryRun) {
        const { logger } = await import('../core/logger.js');
        logger.info(`Would run: node ${installerPath} ${args.join(' ')}`);
        return;
      }
      await new Promise<void>((res, rej) => {
        const child = spawn(process.execPath, [installerPath, ...args], { stdio: 'inherit' });
        child.on('close', (code) => (code === 0 ? res() : rej(new Error(`installer exited ${code}`))));
      });
    } catch (err) {
      const { formatAndLogError } = await import('../core/format-error.js');
      formatAndLogError(err, 'dantecode');
      process.exitCode = 1;
    }
  });

const stateWarmupCommand = process.argv.find((arg, index) => index > 1 && !arg.startsWith('-'));
if (!new Set(['economy', 'mcp-server']).has(stateWarmupCommand ?? '')) {
  loadState().catch(() => { /* state will be created on first write */ });
}

program.parse(process.argv);
