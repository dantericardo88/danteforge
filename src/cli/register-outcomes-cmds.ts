import type { Command } from 'commander';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerOutcomesCmds(program: Command, _C: () => Promise<Commands>): void {
program
  .command('declarations <action> [dimId] [outcomeId]')
  .description('Operate the gate-confirmed declarations ledger: list (durable snapshots + tombstones), drop <dim> <outcome> (sanctioned removal — tombstones the id so neither the overlay nor a re-record can resurrect it), prune <dim> (delete the dim\'s ledger file — durability lost)')
  .option('--reason <text>', 'Why the declaration is being dropped (recorded in the tombstone)')
  .option('--json', 'Machine-readable output (list)')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((action: string, dimId: string | undefined, outcomeId: string | undefined, opts) => {
    void (async () => {
      const { runDeclarationsCli } = await import('./commands/declarations.js');
      if (action !== 'list' && action !== 'drop' && action !== 'prune') {
        const { logger } = await import('../core/logger.js');
        logger.error(`[declarations] unknown action "${action}" — use list | drop | prune.`);
        process.exitCode = 1;
        return;
      }
      const r = await runDeclarationsCli({ action, dimId, outcomeId, reason: opts.reason as string | undefined, json: opts.json as boolean | undefined, cwd: opts.cwd as string | undefined });
      if (!r.ok) process.exitCode = 1;
    })();
  });

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
  .option('--force-cold', 'Bypass gitSha cache and re-execute all outcomes (the default)')
  .option('--preserve-sessions', 'Serve cached evidence: run ONLY outcomes without fresh evidence at this SHA, and PRESERVE prior outcomes\' session_ids. Required for the multi-session frontier capture loop — re-running re-stamps every outcome with one session_id and collapses the >=2-distinct-session proof.')
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
          // --preserve-sessions forces the cache-serving path (forceCold=false) so already-evidenced
          // outcomes keep their session_ids; otherwise the default is a cold re-run (forceCold=true).
          forceCold: opts.preserveSessions ? false : (opts.forceCold as boolean | undefined),
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

const frontierCmd = program
  .command('frontier-spec')
  .description('Define + track the per-dim "what would 9.0 mean?" contract (frontier_spec): the real-user-path run, observable artifact, and competitor to match. Frozen before implementation so the target cannot move.');

frontierCmd
  .command('init <dimId>')
  .description('Scaffold a draft frontier_spec from what the dimension already knows, then deterministically complete it from recorded evidence (product-run outcomes, declared artifacts, one probe run)')
  .option('--write', 'Write the draft to matrix.json (default: dry-run)')
  .option('--no-complete', 'Skip the evidence-grounded spec completer (scaffold + ladder seed only)')
  .option('--json', 'Machine-readable output')
  .option('--cwd <path>', 'Project directory')
  .action((dimId: string, opts) => runFrontierAction('init', dimId, opts));

frontierCmd
  .command('check <dimId>')
  .description('Run the honesty guardrails against the dim\'s frontier_spec')
  .option('--json', 'Machine-readable output')
  .option('--cwd <path>', 'Project directory')
  .action((dimId: string, opts) => runFrontierAction('check', dimId, opts));

frontierCmd
  .command('freeze <dimId>')
  .description('Lock the frontier_spec before implementation (check must pass; records hash + timestamp)')
  .option('--write', 'Apply the freeze (default: dry-run)')
  .option('--json', 'Machine-readable output')
  .option('--cwd <path>', 'Project directory')
  .action((dimId: string, opts) => runFrontierAction('freeze', dimId, opts));

frontierCmd
  .command('status [dimId]')
  .description('Show where each dim stands vs its frontier_spec (none / draft / frozen / stale / validated)')
  .option('--all', 'All dimensions (default when no dimId given)')
  .option('--json', 'Machine-readable output')
  .option('--cwd <path>', 'Project directory')
  .action((dimId: string | undefined, opts) => runFrontierAction('status', dimId, opts));

function runFrontierAction(
  action: 'init' | 'check' | 'freeze' | 'status',
  dimId: string | undefined,
  opts: { all?: boolean; write?: boolean; json?: boolean; cwd?: string; complete?: boolean },
): void {
  void (async () => {
    try {
      const { runFrontierSpec } = await import('./commands/frontier-spec.js');
      const r = await runFrontierSpec({
        action, dimId,
        all: opts.all, write: opts.write, json: opts.json, cwd: opts.cwd, complete: opts.complete,
      });
      if (!r.ok) process.exitCode = 1;
    } catch (err) {
      const { formatAndLogError } = await import('../core/format-error.js');
      formatAndLogError(err, `frontier-spec ${action}`);
      process.exitCode = 1;
    }
  })();
}

program
  .command('frontier-audit [dimId]')
  .description('Non-blocking human spot-audit of the autonomous loop. No dim: list pending court decisions. With a dim + --confirm/--fail: record your verdict (a --fail downgrades that dim to 8.0 and re-opens it next cycle).')
  .option('--confirm', 'Confirm the court was right (no change)')
  .option('--fail', 'Overrule: the 9.0 is not genuine — downgrade the dim to 8.0 (frozen) and re-open it')
  .option('--reviewer <name>', 'Who is auditing (required to resolve)')
  .option('--note <text>', 'Why — recorded as a lesson')
  .option('--json', 'Machine-readable output')
  .option('--cwd <path>', 'Project directory')
  .action((dimId: string | undefined, opts) => {
    void (async () => {
      try {
        const { runFrontierAudit } = await import('./commands/frontier-audit.js');
        await runFrontierAudit({
          dimId,
          confirm: opts.confirm as boolean | undefined,
          fail: opts.fail as boolean | undefined,
          reviewer: opts.reviewer as string | undefined,
          note: opts.note as string | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'frontier-audit');
        process.exitCode = 1;
      }
    })();
  });

// self-challenge / author-outcome / trust-report live in register-truth-cmds.ts (file-size split).

program
  .command('ascend-frontier')
  .description('Unattended autonomous frontier orchestrator: define → build-to-7 → push each dim to a court-validated 9.0, one at a time, until every dim is at the frontier OR an honest ceiling. NEVER prompts.')
  .option('--dry-run', 'Print the next action without executing')
  .option('--no-bootstrap', 'Cold repo: do NOT auto-create a missing compete matrix (Phase A define); fail cleanly naming the remedy instead')
  .option('--parallel', 'Fan the WHOLE pipeline out across the council: member-split research (define), worktree-isolated cross-judged build-to-7, and concurrent push-to-9 (builder-never-judges, reciprocity-audited)')
  .option('--max-cycles <n>', 'Global stop after N cycles (default 200)')
  .option('--max-attempts <n>', 'Novel push attempts per dim before an honest generator-ceiling (default 3)')
  .option('--max-build-attempts <n>', 'No-progress setup/build cycles before a stuck dim is ceilinged (default = max-attempts)')
  .option('--skip-dims <ids>', 'Comma-separated dim ids to EXCLUDE from the loop (e.g. code_generation, whose SWE-bench grade is cloud-only) — lets a local run drive the SAFE dims to a court-9 without the heavy Docker grade')
  .option('--slots-per-member <n>', 'With --parallel: sub-agents EACH council member spins up on its assigned dim (M members × N = M*N worktrees). Standard 4 (default)', parseInt)
  .option('--member-slots <spec>', 'With --parallel: per-member slot overrides, e.g. "claude-code:4,codex:4"')
  .option('--rehearse', 'Rehearsal: drive the FULL coordination layer against a scripted scratch repo (real planner/ledgers/ceilings, recorded work layer) — minutes, zero LLM cost; run before every live campaign')
  .option('--keep', 'With --rehearse: keep the scratch repo for inspection')
  .option('--json', 'Machine-readable result')
  .option('--cwd <path>', 'Project directory')
  .addHelpText('after', `
Phases (no human prompts at any point):
  A DEFINE     evidence-scaffold + migrate-outcomes + frontier-spec init (Prompt 1)
               COLD REPO: a missing compete matrix is first created via defineUniverse, seeded
               from matrix-orchestrate detect/discover artifacts when present (--no-bootstrap disables)
  B BUILD-TO-7 harden-crusade --loop --target 7 (Prompt 2)
  C PUSH-TO-9  per dim, weakest-first: freeze → council-crusade → session-record → validate ×2
               → frontier-review-court → record 9.0 if VALIDATED, else ceiling/retry-with-novel-evidence

"Complete" = every dim at a court-validated 9.0 OR a signed honest ceiling. A determined fixture can
still fool the court — sample 9.0s via the human-audit-queue (danteforge frontier-audit); that runs
out of band and never interrupts this loop.

No-spin guarantee: a dim that can't be scaffolded (setup) or built to 7.0 within --max-build-attempts
cycles is signed an honest ceiling so the loop ALWAYS advances and terminates (never spins to
--max-cycles on un-buildable market/environment/unimplemented dims).

PARALLEL PUSH requires the council CLIs on PATH: the --parallel push build spawns the member binaries
(claude, codex, grok). If a worktree subprocess can't find them (exit 127), set CLAUDE_BIN / CODEX_BIN
/ GROK_BIN or add them to PATH. If a member build fails, the loop stays correct — that dim just earns
a ceiling instead of a 9. Build-to-7 uses harden-crusade (no member-spawn), so it is unaffected.
`)
  .action((opts) => {
    void (async () => {
      try {
        if (opts.rehearse) {
          const { runAscendRehearsal } = await import('./commands/ascend-rehearse.js');
          const report = await runAscendRehearsal({ json: opts.json as boolean | undefined, keep: opts.keep as boolean | undefined });
          if (!report.ok) process.exitCode = 1;
          return;
        }
        const { runAscendFrontier } = await import('./commands/ascend-frontier.js');
        const r = await runAscendFrontier({
          dryRun: opts.dryRun as boolean | undefined,
          bootstrap: opts.bootstrap as boolean | undefined,
          parallel: opts.parallel as boolean | undefined,
          maxCycles: opts.maxCycles ? parseInt(opts.maxCycles as string, 10) : undefined,
          maxAttemptsPerDim: opts.maxAttempts ? parseInt(opts.maxAttempts as string, 10) : undefined,
          maxBuildAttempts: opts.maxBuildAttempts ? parseInt(opts.maxBuildAttempts as string, 10) : undefined,
          skipDims: opts.skipDims ? (opts.skipDims as string).split(',').map(s => s.trim()).filter(Boolean) : undefined,
          slotsPerMember: opts.slotsPerMember as number | undefined,
          memberSlots: opts.memberSlots as string | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
        if (r.terminal === 'stalled') process.exitCode = 1;
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'ascend-frontier');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('frontier-review <dimId>')
  .description('Run the frontier-review-court: independent council judges (builder-never-judges) confirm a dim genuinely matches its named competitor. VALIDATED is the ONLY way past 8.0.')
  .option('--write', 'Apply the verdict: set frontier_spec.status=validated on PASS, write a ceiling receipt on an agreed honest-ceiling')
  .option('--builder <memberId>', 'The member that built this dim — excluded from judging (parallel mode, builder-never-judges)')
  .option('--exclude-builders <ids>', 'Comma-separated members that ALL contributed to the build (sequential/multi-builder mode) — every one excluded from judging so a builder never judges its own dim')
  .option('--min-judges <n>', 'Minimum cross-member judges (default: min(2, available))')
  .option('--json', 'Machine-readable output')
  .option('--cwd <path>', 'Project directory')
  .action((dimId: string, opts) => {
    void (async () => {
      try {
        const { runFrontierReviewCli } = await import('./commands/frontier-review.js');
        const r = await runFrontierReviewCli({
          dimId,
          write: opts.write as boolean | undefined,
          builderMemberId: opts.builder as never,
          excludeBuilderIds: opts.excludeBuilders ? (opts.excludeBuilders as string).split(',').map(s => s.trim()).filter(Boolean) as never : undefined,
          // A 9.0 needs ≥2 independent judges — never honor --min-judges 1 (court-audit #6).
          minJudges: opts.minJudges ? Math.max(2, parseInt(opts.minJudges as string, 10)) : undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
        if (r.result.verdict !== 'VALIDATED') process.exitCode = 1;
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'frontier-review');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('session-record <dimId>')
  .description('Produce real-user-path evidence by running the REAL product on a realistic input. The honest path to 9.0 — captures a genuine product run + observable artifact and emits a real-user-path outcome.')
  .requiredOption('--run <command>', 'The real product command to execute (NOT a test runner), e.g. "node dist/index.js forge --project fixtures/sample"')
  .requiredOption('--callsite <file>', 'The production file this run exercises (recorded as required_callsite)')
  .requiredOption('--artifact <path>', 'Path to the observable artifact the run must produce/modify')
  .option('--description <text>', 'Human description of what the run proves')
  .option('--write', 'Add the real-user-path outcome to matrix.json (default: dry-run)')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Why this exists: 9.0 requires input_source: real-user-path, but a test suite cannot prove
it (the gate can't tell a real integration test from a mocked one). This command runs the
ACTUAL product and only emits the outcome if the run genuinely succeeded, took real time,
and produced an observable artifact — evidence an agent cannot fake without doing the work.

Rejects: test-runner commands, failed runs, instant runs (<1s), runs that produce no artifact.

Example:
  danteforge session-record forge \\
    --run "node dist/index.js forge --project fixtures/real-sample" \\
    --callsite src/core/forge-engine.ts \\
    --artifact fixtures/real-sample/.danteforge/forge-output.md \\
    --description "forge produces a real plan for a real sample project" --write
  # then: danteforge validate forge  (twice, across sessions) → 9.0
`)
  .action((dimId: string, opts) => {
    void (async () => {
      try {
        const { runSessionRecord } = await import('./commands/session-record.js');
        const r = await runSessionRecord({
          dimId,
          run: opts.run as string,
          callsite: opts.callsite as string,
          artifact: opts.artifact as string,
          description: opts.description as string | undefined,
          write: opts.write as boolean | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
        if (!r.accepted) process.exitCode = 1;
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'session-record');
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
  .option('--max-minutes <m>', 'Wall-clock budget for the WHOLE run: checkpoint-exit cleanly (exit 0, report written) before starting a cycle that cannot finish (default: unguarded)')
  .option('--loop', 'Outer loop: re-rank + re-run until ALL_DONE (max 10 passes)', false)
  .option('--resume', 'Auto re-entry: resume each dim from the WaveLedger\'s last successful wave (skip completed cycles of a crashed run) instead of restarting at wave 0', false)
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
          maxMinutes: opts.maxMinutes ? parseInt(opts.maxMinutes as string, 10) : undefined,
          loop: opts.loop as boolean,
          resume: opts.resume as boolean,
          cwd: opts.cwd as string | undefined,
          focusDimension: opts.dimension as string | undefined,
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        }
        // A --max-minutes checkpoint stop is SUCCESS (exit 0): the report is written, merged
        // progress persists, and the orchestrator's next cycle continues from the re-ranked queue.
        if (result.status !== 'ALL_DONE' && !result.budgetReached) process.exitCode = 1;
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
