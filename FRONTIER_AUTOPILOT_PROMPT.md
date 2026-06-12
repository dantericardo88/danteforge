# Frontier Autopilot Prompt — One Command, Any Repo, Honest to the Court

THE ultimate generic prompt to hand to ANY repo's own coding-agent session (v3, 2026-06-12 —
adds: mandatory REHEARSAL preflight, autonomous Score-Ladder research inside the push,
cause-aware ceiling re-opening, court-validated-is-terminal, court exit-code semantics,
council-merge conflict safety, session-usage budget windows). Built around the one-command chain:
`danteforge ascend-frontier` runs define(bootstrap) → setup(yardstick self-heal) → build-to-7 →
push-to-9 → frontier-review court, unattended. The agent's job is no longer to BE the climb loop —
it is to PREFLIGHT the environment, RUN the autopilot, TOP UP manually where honest T4 work
remains, and REPORT the truth (court verdicts AND ceilings, verbatim).

Relationship to HONEST_CLIMB_PROMPT.md (same directory): that file is the hardened MANUAL climb
cycle (A–G, six-box drift guard, tier discipline). Phase 3 below delegates to it. Keep both files.

Before pasting, fill `<danteforge-repo>` (e.g. X:\Projects\DanteForge) — or let the agent resolve
the CLI via `npm root -g`. Everything below the line is the paste block.

---

FRONTIER AUTOPILOT — RUN THIS REPO TO ITS HONEST FRONTIER (paste verbatim into the agent session)

You are a coding agent working in ONE repository (the repo whose root is your current working
directory). The DanteForge CLI is globally npm-linked: run it as `danteforge <cmd>`, or
`node <danteforge-repo>/dist/index.js <cmd>` if not on PATH. It operates on THIS repo's own
`.danteforge/` state. You have NO prior conversation context — everything you need is this prompt,
this repo, and (read-only) `<danteforge-repo>/HONEST_CLIMB_PROMPT.md` + `<danteforge-repo>/CLAUDE.md`.

YOUR JOB, in order: PREFLIGHT → AUTOPILOT → MANUAL TOP-UP → PUSH + REPORT. Do NOT improve or
modify the DanteForge tool itself — use it. A missing capability in the TOOL is a report line,
never something you patch mid-run.

═══════════════════════════════════════════════════════════════════════════════
THE ONE RULE (non-negotiable, identical to the climb prompt)
═══════════════════════════════════════════════════════════════════════════════
A score is EARNED, never typed. NEVER fabricate, relabel, stub, or guess to move a number. NEVER
hand-edit scores.self / scores.derived / declared_ceiling or any score field. NEVER stage
`.danteforge/compete/matrix.json` or any `.danteforge` score surface in a commit. NEVER use
`--no-verify`. NEVER set DANTEFORGE_MATRIX_MERGE_RECEIPT. An honest ceiling is a SUCCESS output —
the machine telling the truth — not a problem to engineer around.

═══════════════════════════════════════════════════════════════════════════════
PHASE 1 — PREFLIGHT (the autopilot now has a BUILT-IN pre-flight too — yours is for the report)
═══════════════════════════════════════════════════════════════════════════════
NOTE: ascend-frontier itself now fail-fasts a Node repo whose declared deps aren't installed,
exempts zero-dependency repos, counts live agent CLIs, and ledgers all of it. Your manual pass
exists so the REPORT carries the facts even if the run never starts.
1. CLI: `danteforge --version` resolves (else via `npm root -g`). If not runnable → STOP, report
   "DanteForge CLI not runnable" (setup failure, not dry).
2. THIS REPO BUILDS: install deps + build per the repo's own README (`npm ci && npm run build`,
   `cargo check`, `pip install -e .`, `go build ./...` — whatever fits). A checkout that cannot run
   its own tests derives 0 everywhere and the loop churns on phantoms. If the toolchain is broken →
   fix the environment first; if unfixable → STOP and report.
3. AGENT CLIs (the builders/judges): check which of `claude --version` and `codex --version`
   resolve. Record the count N in your report.
     • N=0 → the build phases will honestly fail/degrade; run Phase 2 anyway for the bootstrap +
       self-heal value, but expect build-to-7 to stall — say so in the report.
     • N=1 → build-to-7 works; 9.0 court verdicts and Score-Ladder research need ≥2 independent
       members, so expect RESEARCH_LADDER dims BLOCKED and push-to-9 court REJECTED/ceilinged —
       these are HONEST outcomes, report them verbatim.
     • N≥2 → full chain available (you may add `--parallel` in Phase 2).
4. CLEAN TREE + DEDICATED BRANCH (collision-safe, same rules as the climb prompt): a dirty tree
   makes derived scores read falsely low AND breaks one-commit-per-change auditability. If the tree
   has unrelated uncommitted changes → STOP and report. Then create + assert a unique branch:
   `git switch -c danteforge/frontier-autopilot-<repo>-YYYYMMDD-NN` (verify free first; never
   main/master).
5. ORIENT: run `danteforge ascend-frontier --dry-run` and paste its planned next action into your
   notes. On a cold repo it must say `define(bootstrap)`; on a warm one, setup/build/push. If
   dry-run CRASHES, stop and report the stack — do not improvise.
6. REHEARSE (new, MANDATORY): run `danteforge ascend-frontier --rehearse`. This drives the FULL
   coordination layer (real planner, ledgers, ceiling receipts, re-opening, evidence novelty)
   against a scripted scratch repo — ~90 seconds, zero LLM cost, 12 invariants. PASS → proceed.
   FAIL → STOP: the coordination layer itself is broken and a live run would burn budget the same
   way; paste the failing invariant lines into your report as a CRITICAL finding. (This preflight
   caught a real planner bug the day it was built — that is its job.)
7. BUDGET WINDOW (operational, learned twice on 2026-06-11): the agent CLIs share a session usage
   limit that resets on a clock (the error names the reset time, e.g. "resets 7:10pm"). A campaign
   started near the limit dies mid-flight: builders/judges fail with the limit error, courts can't
   convene (<2 judges), and work stalls silently. If you see that error in ANY sub-command output,
   note the reset time, let the current run finish its non-LLM phases, and schedule the next run
   inside a fresh window. Never count limit-killed phases as build failures in your report —
   label them "session-limit".

═══════════════════════════════════════════════════════════════════════════════
PHASE 2 — AUTOPILOT (the one command)
═══════════════════════════════════════════════════════════════════════════════
Run, foregrounded, with a bounded cycle budget:

    danteforge ascend-frontier --max-cycles 30          # N≥2 agent CLIs: optionally add --parallel

What it does (so you SUPERVISE instead of interfering):
  define(bootstrap)  — no matrix? Creates one non-interactively (seeded from matrix-orchestrate
                       detect/discover artifacts when present).
  setup              — evidence-scaffold → migrate-outcomes → `capability-test conduct --execute
                       --max-actions 3` (the conductor: audits every dim's capability_test, probes
                       the "REAL" ones dynamically, REPAIRS or RE-AUTHORS self-fulfilling yardsticks
                       via the examiner agent, researches missing Score Ladders via the council) →
                       ground-outcomes.
  build-to-7         — harden-crusade loop, one dim at a time, 7-check harden gate.
  push-to-9          — per dim: `frontier-spec init` (AUTO-COMPLETES run_command /
                       realistic_inputs / observable_artifacts from real recorded evidence, now
                       VIABILITY-CHECKED: derived run_commands must really take ≥1s and write a
                       real artifact, or the completer says so loudly — never invents) → freeze →
                       session-record × N variants → `validate --preserve-sessions` →
                       frontier-review court (≥3 real-user-path receipts, ≥2 distinct sessions,
                       independent judges, builder excluded).
                       AUTONOMOUS LADDER RESEARCH (new): a dim whose spec fails ONLY because its
                       competitive bar was never researched (zero Score Ladder rows → the seeded
                       leader_target stays unauthored) now triggers ONE single-dim council
                       research inside the same push, re-seeds the bar VERBATIM from the new
                       ladder, and re-checks. Research that produces no usable rows fails loudly
                       and the honest ceiling stands — the bar is researched, never invented.

SUPERVISION RULES while it runs / after it terminates:
  • LIVE OUTPUT + HEARTBEAT (new): every sub-command's output streams with a `[label]` prefix, and
    when a child goes quiet you get `[label] … still running (Xm elapsed, no output for Ym)` every
    minute. A heartbeat means ALIVE — do NOT kill a run for looking silent (fleet run 1's "stalls"
    were healthy runs with invisible output; that class is fixed). Long phases self-limit: every
    sub-command is hard-capped at 30 minutes, then tree-killed with exit 124 recorded in the
    ledger and the loop CONTINUES — that is designed behavior, not a crash.
  • ISOLATION (new): builds run in throwaway git worktrees and merge back through a gate. Your
    checkout must NEVER switch branches or lose uncommitted work during a run — if it does, that
    is a bug: capture `git status` + the run ledger and report it as a CRITICAL finding.
  • EARNS ARE NOW DURABLE: gate-confirmed declarations persist in the declarations ledger
    (`danteforge declarations list`), survive git resets/branch switches, and are restored into
    the matrix automatically on load. Removal is sanctioned-only: `danteforge declarations drop
    <dim> <outcomeId> --reason "<why>"`. Never hand-delete ledger files.
  • Do NOT edit matrix.json scores, specs, or ceilings by hand — ever.
  • When it terminates, read the run bundle: `.danteforge/runs/<runId>/` (summary.md,
    commands.json, gates.json, receipts.json). The runId is in the final log line. Quote the
    terminal state (done / stalled / max-cycles / failed) and the per-cycle actions in your report.
  • CEILING RECEIPTS ARE RESULTS. spec-incomplete (names the exact unfilled field), build-failed
    (environment/toolchain — fixable, re-attemptable), generator-ceiling (no novel evidence),
    market-cap (done at cap), RESEARCH_LADDER-blocked. Report each verbatim with its cause.
    Re-run after fixing an environment cause; NEVER after relabeling.
  • CEILINGS RE-OPEN THEMSELVES (new): a spec-incomplete ceiling is a receipt for NAMED missing
    work — once that work is verifiably done (the spec is frozen), the next state read RESOLVES
    the ceiling and re-opens the push automatically ("ceiling RESOLVED — re-opening" in the log).
    Never hand-delete a ceiling receipt to force a re-attempt.
  • COURT-VALIDATED IS TERMINAL (new): once the frontier-review court VALIDATES a dim, the loop
    stops pushing it — even while its derived score sits below 9 (receipt decay / T7 consensus
    pending is validate/depth work, not push work). A validated dim being re-pushed, or carrying
    a "attempts failed the court" ceiling, is a planner bug — report it CRITICAL.
  • COURT EXIT CODES (new): `frontier-review` exits 1 on an honest REJECTED by design. The
    orchestrator reads the structured verdict, so a rejection is recorded as a real court attempt
    (feeding the novelty ledger), never as "court didn't run". In your own report, REJECTED with
    judge reasons is a verdict; only a crash with no verdict JSON is a failure.
  • COUNCIL MERGES NEVER WRECK THE TREE (new): a conflicted council patch rolls back cleanly
    (candidate work stays on its council/<round>/<member> branch), and the merge REFUSES to patch
    over local modifications. Conflict markers or unmerged (UU) index entries appearing in YOUR
    tree after a run is a CRITICAL finding — capture `git status` + the run ledger.
  • Expected honest behaviors (report, don't patch): Score-Ladder research needs ≥2 live council
    members AND a researchable domain — on thin/unknown repos the FIRST research failure
    short-circuits the rest of that pass (BLOCKED with "short-circuited" reasons is correct, not
    broken; later cycles retry). The conductor's budgets (3 expensive actions, 6 probes per pass)
    mean big matrices converge over MULTIPLE cycles by design. exit-127/spawn errors mean a
    missing CLI on PATH (fix environment, re-run).
  • STOPPING A RUN (operator note from fleet run 2): the autopilot is a detached node process —
    TaskStop/killing the launching shell does NOT stop it. Use `taskkill /pid <pid> /T /F` on the
    ascend-frontier node process (find it via the run ledger's commands-live.jsonl or process
    tree). The SIGINT path finalizes the bundle when you Ctrl-C a foreground run.
  • ENGINE BUDGETS (fixed after fleet run 2): build-to-7 runs with an 18-minute inner budget and
    a 55-minute wall-clock checkpoint under a 60-minute phase cap — a long build phase that exits
    CLEANLY having advanced 1-2 dims and hands back to the orchestrator is the DESIGNED rhythm.
    Multiple cycles per dim-set is normal; zero dims advanced across 2+ identical cycles is not
    (report it).
  • If every cycle errors or the run terminates `failed`, paste the last 30 lines of output + the
    ledger summary and go to Phase 3 anyway — manual climbing may still be possible.

═══════════════════════════════════════════════════════════════════════════════
PHASE 3 — MANUAL TOP-UP (the hardened climb loop, for what the autopilot left)
═══════════════════════════════════════════════════════════════════════════════
Run `danteforge gap --all`. For every dim still below 7.0 whose blocker is genuinely earnable
(missing-outcome / orphan-callsite / wired-but-untested — NOT market-cap, NOT
needs-real-product-run), execute the MANUAL HONEST CLIMB CYCLE exactly as written in
`<danteforge-repo>/HONEST_CLIMB_PROMPT.md`: its A–G cycle, EXISTENCE TEST + SUBSTANCE FLOOR, the
six-box drift-guard checklist EVERY cycle, TIER DISCIPLINE (test runners are T4 LITERALLY, every
language), one dim per commit, loop until dry, DRY-IS-SUCCESS with the closed-set dry ledger.
Skip that file's SETUP section (you already did the equivalent in Phase 1) — start at its cycle
step A. Its NEVER list applies here in full.

Current market-cap facts (also live-printed by `gap`): community_adoption, enterprise_readiness,
AND token_economy are hard-capped at 5.0 — token_economy stopped being earnable on 2026-06-10
(the old 7.0 reading was a cap leak, fixed). A capped dim at its cap is DONE.

═══════════════════════════════════════════════════════════════════════════════
REPO-LOCAL INFRASTRUCTURE EXCEPTION (new — the DanteCode hook class)
═══════════════════════════════════════════════════════════════════════════════
When THIS repo's own commit infrastructure (pre-commit hook / CI wiring) blocks ALL commits for a
reason UNRELATED to your work — e.g. the hook runs a test pipeline containing a pre-existing
broken package (DanteCode: `turbo run test` dies on its `@dantecode/danteforge` binary-shim
package with "Unexpected end of JSON input") — you ARE authorized to repair that repo-local
infrastructure: fix or exclude the broken package from the hook's pipeline, as its own clearly
labeled commit (`fix(infra): unblock pre-commit — <what>`), BEFORE the autopilot run. Constraints:
the fix must not weaken any honesty gate, must not touch the DanteForge tool itself, and
`--no-verify` remains forbidden. An unblocked hook is environment repair; a bypassed hook is fraud.

═══════════════════════════════════════════════════════════════════════════════
PHASE 4 — PUSH (never main) + REPORT
═══════════════════════════════════════════════════════════════════════════════
Push rules are the climb prompt's verbatim: only if ≥1 honest commit exists; re-assert the branch
name starts with `danteforge/` and is not main/master; `git push -u origin "$BR"`; record a push
failure rather than working around it. Then paste back:

FRONTIER AUTOPILOT REPORT
PROJECT: <repo>   BRANCH: <branch>   PUSH: <pushed / failed: why / local-only / nothing-to-push>
PREFLIGHT: danteforge <version> | repo builds: <yes/how / no: why> | agent CLIs: N=<0|1|2+> (<which>)
  | rehearsal: <PASS (12/12) / FAIL: <invariant lines> — run stopped> | budget window: <clear / limit hit, resets <time>>
AUTOPILOT: terminal=<done|stalled|max-cycles|failed>  cycles=<n>  runId=<.danteforge/runs/...>
  actions: <the per-cycle action list from the result/ledger>
  court verdicts: <dim: VALIDATED/REJECTED (judges) — or "court never convened: <cause>">
  ceilings: <dim: cause — verbatim receipt detail>   (one line per ceilinged dim)
SCORES (gap --all, derived): <before-mean> -> <after-mean>; per-dim table for movers only
DECLARATIONS LEDGER (`danteforge declarations list`): <N dims durable / tombstones, or "empty">
MANUAL EARNS: <one block per dim in the HONEST_CLIMB report format — integrityCap MUST be absent>
DRY LEDGER: <every remaining sub-ceiling dim: closed-set tag — one line each>
LANDMINES: <tool bugs (e.g. all-pass-but-0.0 = NEW derived bug: paste validate --json), hook
  blocks (quote the check), checkout moved/work lost during a run (CRITICAL — see isolation rule),
  spawn failures, anything you correctly refused to do. "None" if clean.>

NEVER (the union of both prompts): fabricate · relabel · stub/mock/TODO · hand-edit scores · stage
matrix.json or .danteforge score surfaces · --no-verify · DANTEFORGE_MATRIX_MERGE_RECEIPT ·
`validate --all --force-cold` · full test suite · `git add .`/`-A` · `git reset --hard`/`git clean`
· edit the DanteForge tool · commit/push main/master · declare a test runner T5+ · "fix" an honest
ceiling by lowering the bar.
