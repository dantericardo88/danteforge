#!/usr/bin/env node
// Main CLI entry
// Capture startup time as the very first statement so it includes
// all module-load cost. DANTEFORGE_PERF=1 prints it after parse().
const _startTime = Date.now();
import { Command } from 'commander';
import { existsSync } from 'node:fs';
// Lazy-load command implementations â€” deferred until action fires, not at startup
type Commands = Awaited<typeof import('./commands/index.js')>;
let _cmds: Commands | null = null;
const C = (): Promise<Commands> =>
  _cmds ? Promise.resolve(_cmds) : import('./commands/index.js').then(m => (_cmds = m as Commands));
import { loadState } from '../core/state.js';
import { logger } from '../core/logger.js';
import { enforceWorkflow } from '../core/workflow-enforcer.js';
import { formatAndLogError } from '../core/format-error.js';
import { logStructuredError } from '../core/error-log.js';
import { findCommandSuggestions, formatCommandSuggestions } from '../core/command-suggest.js';
import { registerLateCommands } from './register-late-commands.js';
import { registerDossierCommands } from './register-dossier-commands.js';
import { registerCoreCommands } from './register-core-commands.js';
// Matrix command modules are dynamically imported — they have a larger
// transitive dependency graph (matrix engines, adapters, courts) and should
// not bloat the startup cost for simple commands like --help or --version.
// The registerXxx functions are called synchronously here but the modules
// load lazily when Node.js resolves the dynamic import promises below.
import { registerMatrixCommands } from './register-matrix-commands.js';
import { applyCommandTags } from './command-tags.js';
import { registerMatrixOrchestrationCommands } from './register-matrix-orchestration-commands.js';

const program = new Command();
program
  .name('danteforge')
  .description('Agentic development CLI - structured specs, execution waves, multi-agent orchestration')
  .version(process.env.DANTEFORGE_VERSION ?? '0.0.0-dev')
  .option('--quiet', 'Suppress all output except errors')
  .option('--verbose', 'Enable verbose/debug output');
registerCoreCommands(program, C);

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
  .description('Query causal links from Time Machine commits')
  .requiredOption('--kind <kind>', 'evidence | dependents | file-history | counterfactual | line-provenance | session-graph')
  .option('--commit <id>', 'Time Machine commit id (defaults to head where applicable)')
  .option('--path <path>', 'Path for file-history and line-provenance queries')
  .option('--line <n>', '1-based line number for line-provenance queries', parseInt)
  .option('--session <id>', 'Session UUID for session-graph queries')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action(async (opts) => (await C()).timeMachine({ action: 'query', cwd: opts.cwd, commit: opts.commit, kind: opts.kind, path: opts.path, line: opts.line, session: opts.session }));

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
  .description('Print the full ancestor chain for a DecisionNode (rootâ†’leaf)')
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
  .description('Run causal attribution on a DecisionNode â€” classify downstream nodes as independent/dependent-adaptable/dependent-incompatible')
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
  .command('label')
  .description('Interactively adjudicate causal attribution labels from a label-candidates.json corpus file')
  .option('--candidates <file>', 'Path to label-candidates.json (from build-corpus). Defaults to .danteforge/evidence/time-machine-corpus/label-candidates.json')
  .option('--out <file>', 'Output labels.json path (default: .danteforge/labels.json)')
  .option('--auto', 'Accept all suggested labels automatically without prompting (for automation/testing)')
  .option('--limit <n>', 'Max candidates to label in this session', parseInt)
  .option('--json', 'Output result summary as JSON')
  .action(async (opts) => (await C()).timeMachine({
    action: 'node-label',
    candidatesFile: opts.candidates,
    out: opts.out,
    autoLabel: opts.auto,
    labelLimit: opts.limit,
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
  .option('--efficiency', 'Show per-command token spend efficiency from the token ledger')
  .option('--reset', 'Clear the token ledger (.danteforge/token-ledger.jsonl)')
  .action(async (opts) => (await C()).cost({
    byAgent: opts.byAgent,
    byTier: opts.byTier,
    savings: opts.savings,
    history: opts.history,
    efficiency: opts.efficiency,
    reset: opts.reset,
  }));

program
  .command('economy')
  .description('Context Economy report â€” token savings by filter, top passthroughs, sacred bypasses (Article XIV)')
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
  .addHelpText('after', `
Examples:
  danteforge assess                  Full harsh assessment + competitor benchmark + masterplan
  danteforge assess --no-competitors Score only — skip the competitor comparison table
  danteforge assess --json           Machine-readable JSON (useful for CI gates)
  danteforge assess --min-score 8.5  Override the 9.0 victory threshold
  danteforge assess --set-baseline   Pin current score as the session baseline for delta tracking
  danteforge assess --preset magic   Assess against magic-tier maturity expectations
`)
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
  .description('18-dimension scorecard, or external benchmark suite (SWE-bench / Exercism)')
  .option('--dimension <dim>', 'Score only one named dimension')
  .option('--compare', 'Show gap vs CHL matrix competitor scores')
  .option('--compare-tool <name>', 'Compare external benchmark result vs a competitor (e.g. aider)')
  .option('--format <fmt>', 'Output format: table or json (default: table)', 'table')
  .option('--suite <suite>', 'External benchmark suite: swe-bench or exercism')
  .option('--instances <n>', 'Max tasks to run for external suite (default: 10)', '10')
  .option('--assert-min-passrate <rate>', 'Exit 1 if pass rate < this threshold (0–1)')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    try {
      await (await C()).benchmark({
        dimension: opts.dimension,
        compare: opts.compareTool ?? opts.compare,
        format: opts.format,
        cwd: opts.cwd,
        suite: opts.suite,
        instances: opts.instances ? parseInt(opts.instances, 10) : undefined,
        assertMinPassRate: opts.assertMinPassrate ? parseFloat(opts.assertMinPassrate) : undefined,
      });
    } catch (err) {
      formatAndLogError(err, 'benchmark');
      process.exitCode = 1;
    }
  });

program
  .command('showcase')
  .description('Score any project with the full harsh scorer and generate docs/CASE_STUDY.md â€” reproducible external proof')
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
  .description('Plain-English glossary â€” explain any DanteForge term, command, or concept')
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
  .option('--deterministic-only', 'Skip LLM augmentation â€” deterministic regex checks only')
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
  .description('Autonomous quality loop: assess â†’ forge gaps â†’ verify â†’ repeat until 9+/10')
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
  .description('Define what "9+" means â€” sets the completion target used by assess and self-improve')
  .option('--reset', 'Clear existing target and re-prompt')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => { void (await C()).defineDone({
    reset: opts.reset,
    cwd: opts.cwd,
  }); });

program
  .command('universe')
  .description('View the competitive feature universe â€” all unique capabilities across competitors, scored')
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

// First-run detection â€” suggest init when no .danteforge/ exists
program.hook('preAction', (_thisCommand, actionCommand) => {
  const skip = new Set(['init', 'config', 'doctor', 'help', 'setup', 'skills', 'docs', 'premium', 'workflow', 'mcp-server', 'publish-check', 'proof']);
  if (skip.has(actionCommand.name())) return;
  if (!existsSync('.danteforge')) {
    logger.info('Tip: No .danteforge/ directory found. Run "danteforge init" to set up your project.');
  }
});

program.hook('preAction', () => {
  const opts = program.opts();
  if (opts.quiet) {
    logger.setLevel('error');
    process.env.DANTEFORGE_QUIET = '1';
  } else if (opts.verbose) {
    logger.setLevel('verbose');
    process.env.DANTEFORGE_VERBOSE = '1';
  }
});

program.hook('preAction', async (_thisCommand, actionCommand) => {
  const opts = actionCommand.optsWithGlobals?.() ?? actionCommand.opts();
  await enforceWorkflow(actionCommand.name(), undefined, Boolean(opts.light));
});

// Command group help for discoverability
program.addHelpText('after', `
The 12 canonical commands (each takes --level light|standard|deep where applicable):

  Start:    go          Smart entry point for any project state
            config      Configure LLM provider, MCP, skills, premium

  Build:    plan        Spec-to-tasks pipeline: specify â†’ clarify â†’ plan â†’ tasks
            build       Execute development waves (light=forge, standard=magic, deep=inferno)
            harvest     Learn from OSS patterns

  Quality:  measure     All quality scores in one consistent view (schema: measure.v1)
            compete     Competitive intelligence and gap analysis
            autoforge   Autonomous improvement loop

  Publish:  ship        Verify â†’ QA â†’ publish preflight (--dry-run safe)
            evidence    Proof chains, Time Machine, causal attribution

  Enhance:  knowledge   Lessons, synthesis, wiki, explain, pattern federation
            design      OpenPencil design-as-code, UX refinement, Figma push

Quick start:
  danteforge go              â€” new project wizard or status panel for existing
  danteforge measure         â€” see your project score (standard depth, consistent schema)
  danteforge measure --json  â€” machine-readable score for scripting/CI
  danteforge build           â€” one improvement wave
  danteforge autoforge --auto â€” autonomous loop to 9.0/10

Common flags:
  --level light|standard|deep   Select depth (default: standard)
  --json                         Machine-readable JSON output
  --prompt                       Generate copy-paste prompt (no API call)
  --worktree                     Isolated git worktree execution
  --verbose                      Debug output

Run "danteforge help" for the full command reference.
Run "danteforge init" to set up a new project.
`);

registerLateCommands(program, C);
registerDossierCommands(program, C);
registerMatrixCommands(program);
registerMatrixOrchestrationCommands(program);

// `danteforge war-room` — portable terminal TUI for the matrix kernel.
program
  .command('war-room')
  .description('Live terminal dashboard for the matrix kernel run state (any TTY)')
  .option('--cwd <path>', 'Project root')
  .option('--once', 'Render one snapshot and exit (no file watcher; suitable for CI)')
  .action(async (opts) => {
    try {
      const { warRoom } = await import('./commands/war-room.js');
      await warRoom({
        cwd: opts.cwd as string | undefined,
        once: opts.once as boolean | undefined,
      });
    } catch (err) {
      const { formatAndLogError } = await import('../core/format-error.js');
      formatAndLogError(err, 'war-room');
      process.exitCode = 1;
    }
  });

// Hide non-canonical commands from default --help.
// The 12 canonical commands + utility commands stay visible.
// All other commands still work â€” just not shown in the default listing.
const VISIBLE_COMMANDS = new Set([
  'go', 'plan', 'build', 'measure', 'compete', 'harvest', 'autoforge',
  'evidence', 'knowledge', 'ship', 'design', 'config',
  'doctor', 'init', 'help',
]);
for (const cmd of program.commands) {
  if (!VISIBLE_COMMANDS.has(cmd.name())) {
    (cmd as unknown as { _hidden: boolean })._hidden = true;
  }
}

// Curation convention (V2-by-subtraction): tag non-core commands so a reader knows what each is —
// supported core (visible above), an experiment, or a deprecated alias. Non-destructive: tagging
// only annotates the help text + hides; nothing is removed. The full curated inventory and the
// candidate deprecations (incl. the matrix-layer triple, which is load-bearing and needs a
// dedicated migration — NOT a tag) live in docs/COMMAND_SURFACE.md.
const EXPERIMENTAL_COMMANDS = new Map<string, string | undefined>([
  ['war-room', 'Phase 14 — deferred'],
]);
const DEPRECATED_COMMANDS = new Map<string, string>([
  // (none yet — `matrix` claim/propose/merge is still the canonical gated score path; see
  //  docs/COMMAND_SURFACE.md for the matrix-kernel / matrix-orchestrate consolidation plan)
]);
applyCommandTags(program, EXPERIMENTAL_COMMANDS, DEPRECATED_COMMANDS);

const stateWarmupCommand = process.argv.find((arg, index) => index > 1 && !arg.startsWith('-'));
if (!new Set(['economy', 'mcp-server']).has(stateWarmupCommand ?? '')) {
  loadState().catch(() => { /* state will be created on first write */ });
}

// "Did you mean?" handler for unknown top-level commands
program.on('command:*', (operands: string[]) => {
  const unknown = operands[0] ?? '';
  const knownNames = program.commands.map(c => c.name());
  const suggestions = findCommandSuggestions(unknown, knownNames)
    .map((suggestion) => suggestion.command);
  logger.error(formatCommandSuggestions(unknown, suggestions));
  process.exitCode = 1;
});

// Process-level error boundary — catch any unhandled rejection or exception
// that escapes command action handlers and Commander's own try/catch.
process.on('uncaughtException', (err: Error) => {
  logStructuredError(err, { command: 'cli', phase: 'uncaughtException' });
  formatAndLogError(err, 'cli');
  if (!process.env.DANTEFORGE_VERBOSE) {
    logger.error('  Run with --verbose for the full stack trace.');
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logStructuredError(err, { command: 'cli', phase: 'unhandledRejection' });
  formatAndLogError(err, 'cli');
  if (!process.env.DANTEFORGE_VERBOSE) {
    logger.error('  Run with --verbose for the full stack trace.');
  }
  process.exit(1);
});

program.parse(process.argv);

// DANTEFORGE_PERF=1 — print wall-clock startup cost to stderr after parsing.
// Usage: DANTEFORGE_PERF=1 danteforge <cmd>
if (process.env.DANTEFORGE_PERF) {
  process.stderr.write(`[perf] startup: ${Date.now() - _startTime}ms\n`);
}
