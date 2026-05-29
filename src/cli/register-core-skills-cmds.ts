import type { Command } from 'commander';
import { logger } from '../core/logger.js';
import { formatAndLogError } from '../core/format-error.js';
import { CANVAS_PRESET_TEXT } from '../core/workflow-surface.js';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerCoreSkillsCmds(program: Command, C: () => Promise<Commands>): void {
const truthLoopCommand = program
  .command('truth-loop')
  .description('Run the truth loop reconciliation pipeline (PRD-26 Â§5.3)');

truthLoopCommand
  .command('run')
  .description("Execute one truth-loop run: collect â†’ import critiques â†’ reconcile â†’ verdict â†’ next-action")
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
  .option('--provider <name>', 'Set default provider: grok, claude, openai, gemini, ollama (API/local), or claude-code, codex (subscription CLI, no key)')
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
  .command('complexity')
  .description('Analyze cyclomatic complexity and LOC metrics across src/ — exits 1 if any file exceeds --threshold')
  .option('--threshold <score>', 'Exit 1 if any file complexity score exceeds this value', '20')
  .option('--json', 'Output machine-readable JSON')
  .option('--watch', 'Re-run analysis every 5 seconds (poll mode)')
  .option('--cwd <path>', 'Working directory')
  .action(async (opts) => {
    try {
      const { complexity } = await import('./commands/complexity.js');
      await complexity({
        threshold: opts.threshold !== undefined ? parseFloat(opts.threshold as string) : undefined,
        json: opts.json as boolean | undefined,
        watch: opts.watch as boolean | undefined,
        cwd: opts.cwd as string | undefined,
      });
    } catch (err) {
      formatAndLogError(err, 'complexity');
      process.exitCode = 1;
    }
  });

program
  .command('test-coverage')
  .description('Detect uncovered src/core modules and report mutation scores')
  .option('--json', 'Output machine-readable JSON')
  .option('--fail-below <percent>', 'Exit 1 if coverage % is below this value (default: 70)', '70')
  .action(async (opts) => {
    try {
      const { testCoverage } = await import('./commands/test-coverage.js');
      await testCoverage({
        json: opts.json as boolean | undefined,
        failBelow: opts.failBelow !== undefined ? parseFloat(opts.failBelow as string) : undefined,
      });
    } catch (err) {
      formatAndLogError(err, 'test-coverage');
      process.exitCode = 1;
    }
  });

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
  .action(async (goal, opts) => {
    // Direct dynamic import: magic.ts pulls in all preset levels (spark through
    // inferno) and the magic-presets configuration — not needed for other cmds.
    const { magic } = await import('./commands/magic.js');
    return magic(goal, {
      level: opts.level,
      profile: opts.profile,
      skipUx: opts.skipUx,
      host: opts.host,
      prompt: opts.prompt,
      worktree: opts.worktree,
      isolation: opts.isolation,
      maxRepos: parseInt(opts.maxRepos, 10),
      yes: opts.yes,
    });
  });


program
  .command('workflow')
  .description('Show the 12-stage pipeline with your current position highlighted')
  .action(async () => {
    const { workflow } = await import('./commands/workflow.js');
    await workflow();
  });

program
  .command('help [query]')
  .description('Context-aware guidance â€" shows essential commands by default, --all for full list')
  .option('--all', 'Show all 100+ commands instead of the essential 8')
  .action(async (query, opts) => (await C()).helpCmd(query, { all: opts.all }));

program
  .command('docs')
  .description('Generate or update the command reference and API documentation')
  .option('--output <path>', 'Output file path (default: docs/API.md or docs/api.json)')
  .option('--format <fmt>', 'Output format: md (default) or json', 'md')
  .option('--coverage', 'Report JSDoc coverage for src/core/ exports; exits 1 if below 60%')
  .addHelpText('after', `
Examples:
  danteforge docs                     Generate docs/COMMAND_REFERENCE.md + docs/API.md
  danteforge docs --coverage          Report JSDoc coverage percentage for src/core/
  danteforge docs --format json       Generate docs/api.json (machine-readable)
  danteforge docs --output docs/REF.md  Write to a custom path
`)
  .action(async (opts) => {
    const { docs: docsCmd } = await import('./commands/docs.js');
    await docsCmd({
      output: opts.output as string | undefined,
      format: opts.format as 'md' | 'json' | undefined,
      coverage: opts.coverage as boolean | undefined,
    });
  });

program
  .command('update-mcp')
  .description('Manual MCP self-healing - check for protocol updates and apply safely')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--apply', 'Apply recommended updates after review')
  .option('--check', 'Check-only mode (no changes)')
  .action((...a: unknown[]) => void C().then(c => (c.updateMcp as (...x: unknown[]) => unknown)(...a)));
}
