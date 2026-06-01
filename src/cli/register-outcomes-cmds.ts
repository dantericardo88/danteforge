import type { Command } from 'commander';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerOutcomesCmds(program: Command, _C: () => Promise<Commands>): void {
program
  .command('outcomes')
  .description('Run declared outcomes per dimension. Score = derived from evidence (Phase F+G). Replaces writable scores entirely once dims migrate.')
  .option('--dim <id>', 'Run only on this dimension')
  .option('--tier <name>', 'Run only outcomes of this tier (T0..T6)')
  .option('--force-cold', 'Force re-execution even when cached evidence exists for this SHA')
  .option('--status', 'Report current evidence + derived scores without re-running')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
The outcome system replaces writable scores. Each dim declares outcomes — shell
commands that must exit 0 to "prove" a tier. The derived score is computed from
which outcomes pass, never written. Inflation becomes structurally impossible.

Examples:
  danteforge outcomes                Run all outcomes across all dims
  danteforge outcomes --status       Show current derived scores from cached evidence
  danteforge outcomes --dim security Run only the security dim
  danteforge outcomes --tier T1      Run only T1 (compiles-cold) outcomes
  danteforge outcomes --force-cold   Bypass gitSha cache

Evidence is written to .danteforge/outcome-evidence/<sha>-<dim>-<outcome>.json.
See ~/.claude/plans/dapper-hatching-aurora.md for the design.
`)
  .action((opts) => {
    void (async () => {
      try {
        const { runOutcomesCli } = await import('./commands/outcomes.js');
        await runOutcomesCli({
          dim: opts.dim as string | undefined,
          tier: opts.tier as string | undefined,
          forceCold: opts.forceCold as boolean | undefined,
          status: opts.status as boolean | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'outcomes');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('validate [dimId]')
  .description('Depth Doctrine: run dimension outcomes and report whether the score ceiling was lifted. Code without a receipt is a hypothesis, not a feature.')
  .option('--all', 'Run outcomes for all dimensions (ignores [dimId])')
  .option('--quick', 'Run only T1/T2 outcomes (fast checks only)')
  .option('--force-cold', 'Bypass gitSha cache and re-execute all outcomes')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Depth doctrine: dims without passing outcomes are structurally capped at 7.0.
Run \`danteforge validate <dim>\` to lift the ceiling by providing execution receipts.

Score tiers:
  ≤7.0  no outcomes declared or no outcome passing (legacy ceiling)
  ≤8.5  outcome evidence exists, passed=true (T6 tier cap)
  ≤9.5  fresh evidence ≤7 days

Examples:
  danteforge validate testing              Run outcomes for the testing dimension
  danteforge validate testing --quick      Only T1/T2 (typecheck + unit tests)
  danteforge validate --all                Run all dims with declared outcomes
  danteforge validate --all --json         Machine-readable result for CI

This command exits 1 if any outcome fails (CI gate).
`)
  .action((dimId: string | undefined, opts) => {
    void (async () => {
      try {
        const { runValidateCli } = await import('./commands/validate.js');
        const result = await runValidateCli({
          dimId,
          all: opts.all as boolean | undefined,
          quick: opts.quick as boolean | undefined,
          forceCold: opts.forceCold as boolean | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
        if (!result.allPassed) process.exitCode = 1;
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'validate');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('gap [dimId]')
  .description('Gap analyzer — shows exactly what\'s needed to reach the next score tier. The depth doctrine roadmap for any dimension.')
  .option('--all', 'Analyze all dimensions')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((dimId: string | undefined, opts) => {
    void (async () => {
      try {
        const { runGapCli } = await import('./commands/gap.js');
        await runGapCli({
          dimId,
          all: opts.all as boolean | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'gap');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('migrate-outcomes')
  .description('Backfill structured input_source provenance onto legacy outcomes. Can only lower/hold scores, never raise them. Dry-run by default.')
  .option('--write', 'Apply the synthetic-fixture / external-benchmark annotations (default: dry-run)')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Classifies every outcome lacking input_source:
  • structural file check (readFileSync/existsSync)  → synthetic-fixture (caps 7.0)
  • test suite (npx tsx --test, npm test, jest, …)    → synthetic-fixture (caps 7.0)
  • registered external suite (swe-bench, exercism…)  → external-benchmark (keeps 9.5)
  • genuine CLI/runtime/e2e invocation                → CANDIDATE (left undeclared, caps 8.0)

real-user-path is NEVER auto-assigned — that is a human judgement, and auto-assigning it
would silently raise scores. Candidates are reported for you to confirm by hand.

Examples:
  danteforge migrate-outcomes              Dry-run: show what would change
  danteforge migrate-outcomes --write      Apply synthetic/external annotations
  danteforge migrate-outcomes --json       Machine-readable result for CI
`)
  .action((opts) => {
    void (async () => {
      try {
        const { runMigrateOutcomes } = await import('./commands/migrate-outcomes.js');
        await runMigrateOutcomes({
          write: opts.write as boolean | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'migrate-outcomes');
        process.exitCode = 1;
      }
    })();
  });

const hardenCmd = program
  .command('harden')
  .description('Deterministic hardening checks (Phase C of Capability Ladder). Catches orphan modules, claim/reality mismatches, hardcoded fallbacks. Cannot be gamed by LLM agents.')
  .option('--dim <id>', 'Run only on this dimension')
  .option('--check <id>', 'Run only this check: orphan-audit | claim-auditor | hardcoded-fallback | import-resolves | functional-diff')
  .option('--gate', 'Exit 1 if any dimension above the 7.0 threshold fails (CI mode)')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge harden                              All checks, all dims above 7.0
  danteforge harden --dim security               One dim only
  danteforge harden --check orphan-audit         One check across all dims
  danteforge harden --gate                       CI mode — exits 1 on any fail
  danteforge harden migrate                      Dry-run: infer capability_callsite per dim
  danteforge harden migrate --apply              Write inferred callsites to matrix.json

The harden gate fires automatically inside mergeScoreProposals at score ≥ 7.0.
This command is the operator-facing entry point and the CI gate.
`)
  .action((opts) => {
    void (async () => {
      try {
        const { runHardenCommand } = await import('./commands/harden.js');
        await runHardenCommand({
          dim: opts.dim as string | undefined,
          check: opts.check as undefined,
          gate: opts.gate as boolean | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'harden');
        process.exitCode = 1;
      }
    })();
  });

hardenCmd
  .command('audit-orphans')
  .description('Three Pillars P2: list every dimension whose capability_callsite is only imported by tests. Caps each at 6.0.')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((_opts, cmd) => {
    // optsWithGlobals merges parent `harden` flags (--json, --cwd) with this subcommand's own.
    const opts = cmd.optsWithGlobals();
    void (async () => {
      try {
        const { runHardenAuditOrphans } = await import('./commands/harden.js');
        await runHardenAuditOrphans({
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'harden audit-orphans');
        process.exitCode = 1;
      }
    })();
  });

hardenCmd
  .command('audit-recency')
  .description('Three Pillars P3: list every dimension whose production importer is older than N days OR does not trace to an entry point. Caps each at 7.0.')
  .option('--threshold-days <n>', 'Days threshold (default 30; can be overridden in .danteforge/config/entry-points.json)', '30')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((_opts, cmd) => {
    const opts = cmd.optsWithGlobals();
    void (async () => {
      try {
        const { runHardenAuditRecency } = await import('./commands/harden.js');
        await runHardenAuditRecency({
          thresholdDays: parseInt(opts.thresholdDays as string, 10),
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'harden audit-recency');
        process.exitCode = 1;
      }
    })();
  });

hardenCmd
  .command('migrate')
  .description('Infer capability_callsite + test_callsite for each dim from its capability_test command. Dry-run by default; use --apply to write.')
  .option('--apply', 'Write inferred callsites to matrix.json (default: dry-run only)')
  .option('--accept-low', 'Also apply low-confidence inferences (default: high+medium only)')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runHardenMigrateCommand } = await import('./commands/harden.js');
        const acceptConfidence: Array<'high' | 'medium' | 'low'> = opts.acceptLow
          ? ['high', 'medium', 'low']
          : ['high', 'medium'];
        await runHardenMigrateCommand({
          apply: opts.apply as boolean | undefined,
          acceptConfidence,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'harden migrate');
        process.exitCode = 1;
      }
    })();
  });

// ── harden-crusade ───────────────────────────────────────────────────────────
//
// Crusade variant: autoresearch per-dim + the 7-check harden gate as verifier.
// Differs from /crusade in that autoresearch is the PRIMARY driver (not a
// stall fallback). Useful when inferno's Ollama-dependent OSS-harvest sub-step
// is unreliable. The harden gate caps any honestly-unsupportable score.

program
  .command('harden-crusade')
  .description('Autonomous crusade-like loop: autoresearch per dim + 7-check harden gate verification. Reaches target or the natural ceiling honestly.')
  .option('--goal <goal>', 'Mission statement passed to each autoresearch wave', 'Push every dim toward its honest ceiling')
  .option('--parallel <n>', 'Number of dimensions to push simultaneously (default 4)', '4')
  .option('--target <n>', 'Score target per dimension (default 9.0)', '9')
  .option('--max-dim-cycles <n>', 'Per-dim cycle cap (default 6)', '6')
  .option('--time <m>', 'Autoresearch time budget per cycle in minutes (default 30)', '30')
  .option('--loop', 'Outer loop: re-rank + re-run until ALL_DONE (max 10 passes)', false)
  .option('--dimension <id>', 'Promote this dimension to the front of every work queue (intel-driven targeting)')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge harden-crusade                                Single pass, 4 weakest dims, 30m autoresearch each
  danteforge harden-crusade --loop                         Re-rank + repeat until ALL_DONE
  danteforge harden-crusade --time 60 --parallel 2         Longer budget, fewer parallel dims
  danteforge harden-crusade --target 8 --goal "stability"  Custom target + goal

Per dim per cycle:
  1. danteforge autoresearch --metric <dim> --time Nm
  2. Re-score the dim
  3. danteforge harden --dim <dim> (in-process)
  4. FRONTIER_REACHED if score >= target AND gate clean
  5. AT_CEILING if gate caps below target (legitimate)
  6. GATE_BLOCKED / MAX_CYCLES otherwise

Honors regrade-cadence + autonomy rules (R1-R6) like /crusade.
Excludes dims whose declared_ceiling cap is below target.
Writes report to HARDEN_CRUSADE_REPORT.md.
`)
  .action((opts) => {
    void (async () => {
      try {
        const { runHardenCrusade } = await import('./commands/harden-crusade.js');
        const result = await runHardenCrusade({
          goal: opts.goal as string,
          parallel: parseInt(opts.parallel as string, 10),
          target: parseFloat(opts.target as string),
          maxDimCycles: parseInt(opts.maxDimCycles as string, 10),
          timeMinutes: parseInt(opts.time as string, 10),
          loop: opts.loop as boolean,
          cwd: opts.cwd as string | undefined,
          focusDimension: opts.dimension as string | undefined,
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        }
        if (result.status !== 'ALL_DONE') process.exitCode = 1;
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'harden-crusade');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('probe')
  .description('Cold-build runtime probe — the T1 gate of the Capability Ladder. Auto-detects turbo/pnpm/lerna/npm.')
  .option('--tier <name>', 'Probe tier (T0|T1|T2|T3-T6). Default T1 (cold compile).', 'T1')
  .option('--json', 'Machine-readable JSON output')
  .option('--no-cache', 'Force cold run even if cached evidence exists for this SHA', true)
  .option('--timeout-ms <n>', 'Probe timeout (default 15 min)')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .option('--quick-check', 'M.7 fast-fail: scan src/ for broken relative imports in <1s. Skips the full build.')
  .addHelpText('after', `
Examples:
  danteforge probe                             Cold T1 build at repo root
  danteforge probe --tier T2                   Run tests cold
  danteforge probe --quick-check               Fast import-resolves pre-scan (no build)
  danteforge probe --json > probe.json         Machine-readable output
  danteforge probe --cwd ../DanteAgents        Probe a sibling project

Evidence is written to .danteforge/runtime-evidence/<sha>-<tier>.json.
The Capability Ladder gate caps any dimension score above:
  T0=1.0  T1=4.0  T2=5.0  T3=6.0  T4=7.0  T5=8.0  T6=8.5
`)
  .action((opts) => {
    void (async () => {
      try {
        const { runProbeCommand } = await import('./commands/probe.js');
        await runProbeCommand({
          tier: opts.tier as string | undefined,
          json: opts.json as boolean | undefined,
          forceCold: opts.noCache !== false,
          noCache: opts.noCache !== false,
          cwd: opts.cwd as string | undefined,
          timeoutMs: opts.timeoutMs ? parseInt(opts.timeoutMs as string, 10) : undefined,
          quickCheck: opts.quickCheck as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'probe');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('honest-rescore')
  .description('Reality-check the competitive matrix against runtime evidence. Writes a .honest.json file, never mutates matrix.json.')
  .option('--json', 'Machine-readable JSON output')
  .option('--regrade', 'Mandatory skeptic regrade: run harden gate against every dim, reset wavesSinceLastRegrade')
  .option('--index-fresh', 'Force fresh search index for regrade (Phase M.5; default: true)', true)
  .option('--no-index-fresh', 'Skip fresh-indexing for forensic replay against historical SHA')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge honest-rescore                          Reality-check the current matrix
  danteforge honest-rescore --json                   Machine-readable output for CI
  danteforge honest-rescore --regrade                Skeptic regrade (default index-fresh)
  danteforge honest-rescore --regrade --no-index-fresh   Skip fresh index (forensic replay)
  danteforge honest-rescore --cwd ../DanteAgents

Reads .danteforge/runtime-evidence/<sha>-<tier>.json files (run danteforge probe
first) and applies the Capability Ladder tier caps. Writes:
  .danteforge/compete/matrix.honest.json    Copy with self scores clamped
  .danteforge/compete/matrix.honest.diff.md Per-dimension diff report
--regrade (Phase M.5): rebuilds the SearchEngine index fresh on every run so
the skeptic regrade sees the current SHA's code without cached lookups from
prior waves. The whole point of regrade is a skeptic look — caching is
hostile to that.

matrix.json itself is NEVER modified. Operator must copy if satisfied.
`)
  .action((opts) => {
    void (async () => {
      try {
        const { runHonestRescoreCommand } = await import('./commands/honest-rescore.js');
        await runHonestRescoreCommand({
          json: opts.json as boolean | undefined,
          regrade: opts.regrade as boolean | undefined,
          indexFresh: opts.indexFresh as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'honest-rescore');
        process.exitCode = 1;
      }
    })();
  });
}
