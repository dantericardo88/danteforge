import type { Command } from 'commander';
import { CANVAS_PRESET_TEXT } from '../core/workflow-surface.js';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerCoreCraftCmds(program: Command, C: () => Promise<Commands>): void {
program
  .command('init')
  .description('Interactive first-run wizard â€" detect project, check health, show next steps')
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
  .addHelpText('after', `
Examples:
  danteforge specify "build a REST API with auth"
  danteforge specify "refactor auth module" --light
  danteforge specify "add payment flow" --prompt   # copy-paste prompt only
  danteforge specify "user dashboard" --ceo-review # CEO-intent elevation`)
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
  .option('--mode <mode>', 'sprint | define-done — dispatch to a specialized planning mode')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-generating')
  .option('--light', 'Skip hard gates for simple changes')
  .option('--ceo-review', 'Apply CEO-level strategic review before writing PLAN.md')
  .option('--refine', 'Inject PDSE score as context for iterative improvement')
  .option('--skip-critique', 'Skip adversarial critique gate after plan generation')
  .option('--no-score', 'Skip plan quality scoring (faster, for light/CI mode)')
  .option('--stakes <level>', 'Critique depth: low|medium|high|critical (default: medium)')
  .addHelpText('after', `
Examples:
  danteforge plan                       Generate plan from current SPEC.md
  danteforge plan "add oauth login"     Plan for a specific goal (creates SPEC if needed)
  danteforge plan --level deep          Deep planning with adversarial critique
  danteforge plan --mode sprint         Sprint planning mode (produces sprint tasks)
  danteforge plan --prompt              Generate copy-paste prompt (no API key needed)
  danteforge plan --light               Skip gates for quick prototyping`)
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
      noScore: opts.score === false,
      stakes: opts.stakes as string | undefined,
    });
  });

program
  .command('critique <plan-file>')
  .description('Adversarial critique of a plan â€" finds gaps before they become bugs')
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
  .option('--validate', 'Validate dependency graph: check for cycles and dangling references')
  .action((...a: unknown[]) => void C().then(c => (c.tasks as (...x: unknown[]) => unknown)(...a)));

program
  .command('traceability')
  .description('Show spec-to-plan traceability matrix — which tasks cover which requirements')
  .option('--json', 'Machine-readable JSON output')
  .option('--spec <path>', 'Path to spec file (default: .danteforge/SPEC.md)')
  .option('--plan <path>', 'Path to plan/tasks file (default: .danteforge/TASKS.md)')
  .option('--cwd <path>', 'Working directory')
  .action(async (opts) => {
    const cmds = await C();
    await (cmds.traceability as (o: unknown) => Promise<void>)({
      json: opts.json as boolean | undefined,
      specFile: opts.spec as string | undefined,
      planFile: opts.plan as string | undefined,
      cwd: opts.cwd as string | undefined,
    });
  });

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
  .option('--dry-run', 'Preview what would be executed without making any changes')
  .addHelpText('after', `
Examples:
  danteforge forge                  Execute wave 1 with balanced profile
  danteforge forge --profile quality  Slower but higher-quality output
  danteforge forge --prompt         Generate copy-paste prompt (no API key needed)
  danteforge forge --light          Skip hard gates for quick iteration
  danteforge forge --parallel       Run wave steps in parallel (faster, needs more RAM)
  danteforge forge --worktree       Isolated git worktree — safe to run on dirty branches
  danteforge forge --confirm        Pause for human review before executing each step
  danteforge forge --dry-run        Preview tasks without executing (safe for CI checks)
`)
  .action((phase: unknown, opts: Record<string, unknown>) => {
    // Direct dynamic import: forge loads the full GSD wave executor and
    // context-compression pipeline — expensive at startup, cheap to defer.
    void (async () => {
      const { forge } = await import('./commands/forge.js');
      return forge(typeof phase === 'string' ? phase : '1', {
        profile: opts['profile'] as string | undefined,
        parallel: opts['parallel'] as boolean | undefined,
        prompt: opts['prompt'] as boolean | undefined,
        light: opts['light'] as boolean | undefined,
        worktree: opts['worktree'] as boolean | undefined,
        figma: opts['figma'] as boolean | undefined,
        skipUx: opts['skipUx'] as boolean | undefined,
        confirm: opts['confirm'] as boolean | undefined,
        dryRun: opts['dryRun'] as boolean | undefined,
      });
    })();
  });

program
  .command('party')
  .description('Launch multi-agent collaboration mode')
  .option('--worktree', 'Create isolated worktrees for each agent')
  .option('--isolation', 'Run each agent through subagent isolation and dual-stage review')
  .option('--figma', 'Legacy compatibility flag; use ux-refine separately for Figma workflows')
  .option('--skip-ux', 'Skip UX refinement even with --figma')
  .option('--design', 'Activate Design Agent for UI generation via OpenPencil')
  .option('--no-design', 'Exclude Design Agent from party mode')
  .action((...a: unknown[]) => {
    // Direct dynamic import: party-mode loads agent-dag, headless-spawner,
    // and all agent roles — a large transitive graph not needed at startup.
    void (async () => {
      const { party } = await import('./commands/party.js');
      return (party as (...x: unknown[]) => unknown)(...a);
    })();
  });

program
  .command('review')
  .description('Scan existing repo -> generate CURRENT_STATE.md')
  .option('--prompt', 'Generate a copy-paste prompt for Claude Code / ChatGPT instead of local/API')
  .action((...a: unknown[]) => void C().then(c => (c.review as (...x: unknown[]) => unknown)(...a)));

program
  .command('browse <subcommand> [args...]')
  .description('Browser automation â€" navigate, screenshot, inspect live apps')
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
  .option('--retry <n>', 'Retry verify up to N times on failure (waits 2s between attempts)', '0')
  .addHelpText('after', `
Examples:
  danteforge verify                 Full verification pass
  danteforge verify --light         Quick check (npm test + build only)
  danteforge verify --release       Include release/package checks
  danteforge verify --json          Machine-readable JSON output
  danteforge verify --retry 3       Retry up to 3 times on transient failures`)
  .action((...a: unknown[]) => void C().then(c => (c.verify as (...x: unknown[]) => unknown)(...a)));

program
  .command('convergence-health')
  .description('Check convergence and self-healing health — detects stalls, stale locks, corrupt STATE.yaml')
  .option('--cwd <path>', 'Working directory (defaults to current directory)')
  .option('--json', 'Output machine-readable JSON')
  .option('--auto-repair', 'Automatically fix detected issues (stale locks, failed verify status)')
  .addHelpText('after', `
Examples:
  danteforge convergence-health                     Detect convergence issues
  danteforge convergence-health --auto-repair       Auto-fix stale locks and reset failed verify
  danteforge convergence-health --json              Machine-readable JSON for CI monitoring`)
  .action(async (opts) => (await C()).convergenceHealth({ cwd: opts.cwd, json: opts.json, autoRepair: opts.autoRepair }));

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
  .option('--budget-usd <amount>', 'USD budget â€" orchestration halts on overrun')
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
}
