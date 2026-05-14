import type { Command } from 'commander';
import { logger } from '../core/logger.js';
import { formatAndLogError } from '../core/format-error.js';
import { CANVAS_PRESET_TEXT } from '../core/workflow-surface.js';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerCoreCommands(program: Command, C: () => Promise<Commands>): void {
program
  .command('init')
  .description('Interactive first-run wizard â€” detect project, check health, show next steps')
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
  .option('--mode <mode>', 'sprint | define-done â€” dispatch to a specialized planning mode')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .option('--ceo-review', 'Apply CEO-level strategic review before writing PLAN.md')
  .option('--refine', 'Inject PDSE score as context for iterative improvement')
  .option('--skip-critique', 'Skip adversarial critique gate after plan generation')
  .option('--stakes <level>', 'Critique depth: low|medium|high|critical (default: medium)')
  .action(async (goal, opts) => {
    if (opts.level || opts.mode || opts.skipCritique) {
      return (await C()).canonicalPlan(goal as string | undefined, {
        level: opts.level as string | undefined,
        prompt: opts.prompt as boolean | undefined,
        light: opts.light as boolean | undefined,
        mode: opts.mode as 'sprint' | 'define-done' | undefined,
        skipCritique: opts.skipCritique as boolean | undefined,
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
  .description('Adversarial critique of a plan â€” finds gaps before they become bugs')
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
  .command('design [prompt-or-action]')
  .description('Design artifacts via OpenPencil. Pass natural language, or use actions: tokens | canvas | diff')
  .option('--level <level>', 'Depth: light (tokens only) | standard (render+push) | deep (full UX loop)')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--light', 'Skip hard gates')
  .option('--format <type>', 'Export format: jsx | vue | html', 'jsx')
  .option('--parallel', 'Enable spatial parallel decomposition')
  .option('--worktree', 'Run in isolated git worktree')
  .option('--seed', 'Write a high-quality canvas seed document to DESIGN.op without LLM (scores 7/7 quality dims)')
  .option('--cwd <path>', 'Working directory')
  .action((promptOrAction, opts) => {
    void (async () => {
      try {
        const knownActions = new Set(['tokens', 'canvas', 'diff']);
        if (opts.level || knownActions.has(promptOrAction ?? '')) {
          const { canonicalDesign } = await import('./commands/canonical.js');
          return await canonicalDesign({
            action: (knownActions.has(promptOrAction ?? '') ? promptOrAction : undefined) as 'canvas' | 'diff' | 'tokens' | undefined,
            level: opts.level as 'light' | 'standard' | 'deep' | undefined,
            cwd: opts.cwd as string | undefined,
          });
        }
        // Fall through to natural language design command
        const { design } = await import('./commands/design.js');
        await design(promptOrAction as string, {
          prompt: opts.prompt,
          light: opts.light,
          format: opts.format,
          parallel: opts.parallel,
          worktree: opts.worktree,
          seed: opts.seed,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'design');
        process.exitCode = 1;
      }
    })();
  });

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
  .description('Browser automation â€” navigate, screenshot, inspect live apps')
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
    .description(`Run the ${skillName} Dante-native skill (Phase 2 / PRD-MASTER Â§7).`)
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
  .description('Run a magic-level skill chain end-to-end (Phase 3 / PRD-MASTER Â§8). Levels: spark/ember/canvas/magic/blaze/nova/inferno/ascend')
  .option('--input-file <path>', 'JSON file with workflow inputs')
  .option('--inputs-json <json>', 'Inline JSON with workflow inputs')
  .option('--budget-usd <amount>', 'USD budget â€” orchestration halts on overrun')
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
  .description('Run the truth loop reconciliation pipeline (PRD-26 Â§5.3)');

truthLoopCommand
  .command('run')
  .description('Execute one truth-loop run: collect â†’ import critiques â†’ reconcile â†’ verdict â†’ next-action')
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
  .command('hygiene')
  .description('Check and repair agent cache ignores; optionally clean generated agent state')
  .option('--fix', 'Write ignore files and safe local Git config')
  .option('--clean', 'Clean generated caches and stale agent worktrees')
  .option('--dry-run', 'Preview cleanup without deleting generated caches')
  .option('--no-dry-run', 'Delete generated cleanup candidates when used with --clean')
  .option('--force', 'Remove registered generated worktrees even when tracked changes are present')
  .option('--size-report', 'Report source files above the 500 LOC target')
  .option('--size-plan', 'Write a maintainable split plan for oversized source files')
  .action((...a: unknown[]) => void C().then(c => (c.hygiene as (...x: unknown[]) => unknown)(...a)));

program
  .command('dashboard')
  .description('Launch progress dashboard (local HTML, auto-closes in 5 min)')
  .option('--port <number>', 'Port to serve on', '4242')
  .action((...a: unknown[]) => void C().then(c => (c.dashboard as (...x: unknown[]) => unknown)(...a)));

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
  .option('--skip-tech-decide', 'Skip tech-decide step during planning phase')
  .option('--with-design', 'Include OpenPencil design phase in this wave')
  .option('--local-sources <path>', 'Local sources directory for harvest phase')
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
  .command('workflow')
  .description('Show the 12-stage pipeline with your current position highlighted')
  .action(async () => {
    const { workflow } = await import('./commands/workflow.js');
    await workflow();
  });

program
  .command('help [query]')
  .description('Context-aware guidance â€” shows essential commands by default, --all for full list')
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
  .option('--score-only', 'Score existing artifacts and write AUTOFORGE_GUIDANCE.md â€” no execution')
  .option('--auto', 'Run autonomous loop until 95% completion or BLOCKED state')
  .option('--force', 'Override one BLOCKED artifact for one cycle (logged to audit trail)')
  .option('--pause-at <score>', 'Pause the loop when average PDSE score reaches this value')
  .option('--confirm', 'Pause for human approval before executing (policy gate)')
  .option('--no-predictor', 'Disable Article XV forward prediction layer (saves ~$0.03/wave, loses causal coherence signal)')
  .option('--target <score>', 'Loop until displayScore >= target (default: 9.0 when --auto)')
  .option('--dimension <name>', 'Focus improvement on one scoring dimension')
  .option('--resume', 'Resume from .danteforge/checkpoint.json')
  .option('--adversarial', 'Enable adversarial score gate between cycles')
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
    noPredictor: opts.predictor === false,
    target: opts.target !== undefined ? parseFloat(opts.target as string) : undefined,
    dimension: opts.dimension as string | undefined,
    resume: opts.resume as boolean | undefined,
    adversarial: opts.adversarial as boolean | undefined,
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
  .description('Model personality profiles â€” view learned behavioral patterns per model')
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
  .command('ship [action]')
  .description('Release guidance: verify â†’ QA â†’ publish preflight pipeline (action: ci-setup)')
  .option('--level <level>', 'Depth: light (verify only) | standard (default) | deep (+ publishCheck)')
  .option('--dry-run', 'Run full pipeline without publishing')
  .option('--browse', 'Open browser preview during QA')
  .option('--skip-review', 'Skip pre-landing review (emergency only, logged to audit)')
  .option('--cwd <path>', 'Working directory')
  .action((action, opts) => {
    void (async () => {
      try {
        const { canonicalShip } = await import('./commands/canonical.js');
        await canonicalShip({
          action: action as 'ci-setup' | undefined,
          level: opts.level as 'light' | 'standard' | 'deep' | undefined,
          dryRun: opts.dryRun as boolean | undefined,
          withBrowse: opts.browse as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'ship');
        process.exitCode = 1;
      }
    })();
  });

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
  .description('Multi-repo systematic harvest â€” builds ADOPTION_QUEUE.md from harvest-queue.json')
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
  .description('Compounding OSS intelligence loop: discover â†’ extract â†’ implement â†’ verify â†’ repeat')
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
  .command('goal-loop')
  .description('Autonomous cross-project loop: runs compete --auto on each project until all dimensions reach target (9.0). Pairs with Claude Code /goal for fully automated builds.')
  .option('--projects <paths>', 'Comma-separated project paths (defaults to registered projects)')
  .option('--target <score>', 'Victory threshold per dimension (default: 9.0)', parseFloat)
  .option('--max-cycles <n>', 'Total cycle limit across all projects (default: 120)', parseInt)
  .option('--max-cycles-per-project <n>', 'Max cycles on one project before rotating (default: 15)', parseInt)
  .option('--rotation <mode>', 'round-robin | greedy (default: greedy — most gaps first)', 'greedy')
  .option('--yes', 'Skip all confirmation gates (fully autonomous)')
  .option('--prompt', 'Show usage and /goal integration instructions')
  .action(async (opts) => {
    try {
      const { goalLoop } = await import('./commands/goal-loop.js');
      const projects = opts.projects ? (opts.projects as string).split(',').map((p: string) => p.trim()) : [];
      await goalLoop({
        projects,
        target: opts.target as number | undefined,
        maxCycles: opts.maxCycles as number | undefined,
        maxCyclesPerProject: opts.maxCyclesPerProject as number | undefined,
        rotationMode: (opts.rotation as 'round-robin' | 'greedy' | undefined) ?? 'greedy',
        yes: opts.yes as boolean | undefined,
        promptMode: opts.prompt as boolean | undefined,
      });
    } catch (err) {
      const { formatAndLogError } = await import('../core/format-error.js');
      formatAndLogError(err, 'goal-loop');
      process.exitCode = 1;
    }
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
  .description('Autonomous metric-driven optimization loop â€” plan, rewrite, execute, evaluate, keep winners')
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
  .option('--optimize <metric>', 'Metric-driven mode: run autoresearch targeting this metric (noise-margin aware)')
  .option('--prompt', 'Display the 5-step copy-paste template without calling the LLM')
  .option('--lite', 'Run in SEP-LITE mode (Steps 1-3 + 5 only, 2-3 donors, 2-4 organs)')
  .action(async (goal, opts) => {
    if (opts.level || opts.optimize) {
      return (await C()).canonicalHarvest(goal as string | undefined, {
        level: opts.level as string | undefined,
        source: opts.source as string | undefined,
        maxRepos: opts.maxRepos ? parseInt(opts.maxRepos as string, 10) : undefined,
        prompt: opts.prompt as boolean | undefined,
        depth: opts.depth as string | undefined,
        untilSaturation: opts.untilSaturation as boolean | undefined,
        maxCycles: opts.maxCycles ? parseInt(opts.maxCycles as string, 10) : undefined,
        saturationThreshold: opts.saturationThreshold ? parseInt(opts.saturationThreshold as string, 10) : undefined,
        optimize: opts.optimize as string | undefined,
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
  .description('Start DanteForge MCP server over stdio â€” for Claude Code, Codex, Cursor')
  .action(async () => (await C()).mcpServer());

program
  .command('publish-check')
  .description('Pre-publish validation gate â€” 12 parallel checks before npm publish')
  .option('--json', 'Output machine-readable JSON')
  .action(async (opts) => (await C()).publishCheck({ json: opts.json }));

program
  .command('proof')
  .description('Proof of value â€” raw prompt vs structured artifacts, or pipeline/convergence evidence report')
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
}
