# Honest DanteForge Climb Prompt — Loop Until Dry

Generic, project-agnostic prompt to hand to ANY repo's own coding-agent session. The agent runs
honest DanteForge climb cycles on its own repo until dry, pushes a review branch, and reports back.

Authored + adversarially hardened (35 red-team holes + 4 live-verified ground-truth corrections).
Run shape per operator: **loop-until-dry**, **commit-per-dim on a dedicated branch + push (never main)**,
**dry = success (never manufacture a dim)**.

Before pasting, fill the two `<danteforge-repo>` / `<path-to-danteforge>` placeholders (or let the
agent resolve the CLI via `npm root -g`). Everything below the line is the paste block.

---

HONEST DANTEFORGE CLIMB — LOOP UNTIL DRY (paste verbatim into the agent session for THIS repo)

You are a coding agent working in ONE repository (the repo whose root is your current working
directory). The DanteForge CLI is globally npm-linked, so from THIS repo root run it as:
    danteforge <cmd>
…or, if `danteforge` is not on PATH:  node <path-to-danteforge>/dist/index.js <cmd>
It operates on THIS repo's own `.danteforge/compete/matrix.json`. You have NO prior conversation
context — everything is in this prompt plus your own repo. Two ground-truth references live in the
DanteForge repo if you want them (do NOT edit them):
    <danteforge-repo>/CLAUDE.md                  (Depth Doctrine score tiers; Zero Tolerance)
    <danteforge-repo>/AUTONOMOUS_FLEET_MISSION.md (mission + Progress Log of every landmine)

YOUR JOB: run honest DanteForge climb CYCLES on THIS repo, one dimension at a time, in a loop,
until you run DRY (no more dims you can honestly earn). Then push a dedicated review branch and
report. DO NOT improve or modify the DanteForge tool itself — use it, don't build it.

═══════════════════════════════════════════════════════════════════════════════
THE ONE RULE (non-negotiable)
═══════════════════════════════════════════════════════════════════════════════
A score is EARNED, never typed. NEVER fabricate, relabel, stub, or guess to move a number.
Edit `.danteforge/compete/matrix.json` ONLY to (a) ADD or replace a real outcome block
(kind/tier/command/required_callsite) and (b) REMOVE an always-failing scaffold outcome. NEVER
hand-edit scores.self / scores.derived / declared_ceiling or any score field — those are computed
by the gate. Adding an outcome solely to move a number without real wired evidence behind it is
fabrication. Running DRY is the correct, expected, SUCCESSFUL end (see DRY-IS-SUCCESS).

═══════════════════════════════════════════════════════════════════════════════
SETUP (do ONCE, before any climbing)
═══════════════════════════════════════════════════════════════════════════════
1. CLI smoke-test: run `danteforge --version` (or `node <path>/dist/index.js --version`). If
   neither resolves, find the linked CLI via `npm root -g` / `which danteforge`. If still nothing,
   STOP and report "DanteForge CLI not runnable" (a missing CLI is a setup failure, not dry).
2. Confirm this repo root has `.danteforge/compete/matrix.json`. If not, do NOT manufacture one:
   this repo needs the AUTOPILOT prompt first (<danteforge-repo>/FRONTIER_AUTOPILOT_PROMPT.md) —
   its define(bootstrap) phase creates the matrix honestly. STOP and report "no matrix — run
   autopilot first."
3. CLEAN BASELINE: run `git status --porcelain` and `git rev-parse --abbrev-ref HEAD`. If the tree
   has UNRELATED uncommitted changes, STOP and report — you cannot guarantee one-dim-per-commit on
   a dirty tree, AND a dirty tree makes derived scores falsely read 0.0 everywhere (stale-evidence
   collapse). Record the base branch name (main/master is fine as a BASE, never as a commit target).
4. DEDICATED BRANCH, collision-safe: pick a UNIQUE label from repo+date, e.g.
   honest-climb-<repo>-YYYYMMDD-NN. Check it's free: `git rev-parse --verify --quiet
   refs/heads/danteforge/honest-climb-<repo>-YYYYMMDD-NN` — if it prints a sha, bump NN and retry.
   Create: `git switch -c danteforge/honest-climb-<repo>-YYYYMMDD-NN` (or `checkout -b`). If
   creation FAILS, STOP and report — do NOT fall back to `git checkout` onto an existing branch and
   do NOT proceed on whatever branch you're on.
5. Assert: `git rev-parse --abbrev-ref HEAD` equals your EXACT new branch AND is not main/master.
6. RE-VALIDATE PREFLIGHT (mature/stale matrices — do this BEFORE the cycle). Run `danteforge gap
   --all`. If roughly HALF OR MORE of the dims carry a `[stale-evidence]` blocker (a mature matrix
   whose receipts decayed after commits), you CANNOT see the genuine earnable gaps through stale
   evidence — restore true scores FIRST. Re-validate each stale dim, ONE dim per SEPARATE process:
   `danteforge validate <dim> --force-cold`. EXCEPTION: for any dim that already has 3+ T5+ outcomes
   across distinct sessions (a T7/9.0 dim), use `--preserve-sessions` instead so you don't collapse
   its multi-session proof. NEVER `validate --all --force-cold` (one process re-stamps every dim with
   one session id → silently collapses ALL T7 proof). Then re-read `gap --all` — NOW the real gaps
   are visible and you climb only those. (Re-validation is NOT an earn and writes no code; it just
   refreshes decayed receipts. The old 'derived-stuck' quirk — every outcome PASSES but the score
   stays 0.0 — was FIXED 2026-06-10 (over-declared outcomes now DEMOTE to the tier their evidence
   kind supports, e.g. a T5-declared test-runner earns T4/7.0, instead of being dropped to 0.0). If
   you STILL see all-pass + 0.0 on a clean tree, that is a NEW scoring bug: ledger it as
   derived-stuck-tool-bug and paste the `validate <dim> --json` output in your report.)

═══════════════════════════════════════════════════════════════════════════════
THE HONEST CLIMB CYCLE — repeat A–G, ONE dim per cycle
═══════════════════════════════════════════════════════════════════════════════
A. DISCOVER (live scores only). Run `danteforge gap --all` — it prints the LIVE derived score per
   dim as `<dim> (score: X.X, tier:…, next:…)` plus the exact blocker. DO NOT read scores.derived
   from matrix.json (it is NOT persisted there — absent until validate writes it). DO NOT trust
   `compete status` numbers — its Self column is STALE and `--json` just reprints the same table;
   use it only for human dim labels. A pre-existing derived value is whatever the LAST validate
   wrote — never treat it as proof of honesty; re-derive this cycle.
   • If `gap --all` shows EVERY dim at 0.0 on a CLEAN tree, suspect a global clamp (market cap /
     session veto), not 24 real targets — investigate before mass-targeting.
   • A blocker of `stale-evidence` on an already-passing outcome is a RE-VALIDATE, not a new earn:
     just `danteforge validate <dim> --force-cold` on a clean tree clears it (no code work). It is
     NOT an earnable target.
   • SKIP the market-capped dims — `gap` prints them as `BLOCKER [market-cap] … done at cap` (read
     the live marker, do NOT trust a hardcoded list). The canonical set (src/core/market-dims.ts,
     since 2026-06-10) is community_adoption + enterprise_readiness + token_economy, ALL hard-capped
     at 5.0 — NOTE: token_economy WAS earnable in older prompts; it is now a capped meta-dim (the
     old 7.0 reading was a cap leak, fixed). These need real external adoption/telemetry you cannot
     earn internally; a capped dim at its cap is DONE.
   Pick ONE LOW-score dim whose blocker is missing-outcome / orphan-callsite / no-test AND whose
   capability genuinely exists. Order easiest-first: wired-but-untested → orphan-needs-wiring →
   needs-real-build. If you can identify no such dim → you are DRY → go to DRY LEDGER.

   EXISTENCE TEST (must pass before mapping): write down, from reading the CODE (not the dim label),
   the one sentence `<module>.<fn> implements <dim> by <observable behavior>`. If you can only fill
   it from the label/a name-coincidence, the capability does NOT exist → real gap → skip.
   SUBSTANCE FLOOR: the capability must be a real product behavior a user/operator depends on — not
   a getter, constructor, constant, or always-passing self-check. Ask "if this silently broke, what
   observable product behavior fails?" If "nothing a user would notice," skip it.

B. MAP to a REAL production module. Two honest shapes:
   • WIRED-BUT-UNTESTED (preferred): a NON-TEST production file reachable from the real
     entrypoint (main/index/CLI/boot) already calls it, but no test exercises it. Verify by grep:
     at least one importer must be a live non-test file — NOT a re-export barrel, NOT a test.
   • ORPHAN (no live consumer): you MUST genuinely WIRE it first (step C).
   ⚠ The gate's orphan check is BASENAME-ONLY: it passes if the module name merely appears in ANY
   import/use/mod line — INCLUDING a token import or a discarded construction — and does NOT verify
   a real consumer or artifact. It will NOT catch a fake wire. YOU are the only real check.
   (Cheap pre-check: you may declare a throwaway outcome and run `validate <dim> --force-cold` just
   to read whether the gate reports an orphan/wiring blocker. An orphan refusal means WIRE the
   module (step C) — never rewrite the test.)

C. (Orphan case) Implement a REAL consumer that produces an OBSERVABLE artifact (a log line, CLI
   stdout, a boot self-check PASS) — and run that production path so the artifact actually appears.
   A `use`/`mod`/`let _x = X::new()` with no reached call and no artifact is FABRICATION even though
   the gate stays green. No stubs/mocks/TODOs.

D. ADD A SEAM-FREE TEST that drives the REAL wired logic through its real public API. Zero mocks,
   zero stubs, zero TODOs (the pre-commit hook blocks these in JS; for polyglot, see below).
   ⚠ SELF-FULFILLING-STUB TRAP: OPEN the test file and find the exact line that imports and CALLS
   the production symbol at your required_callsite. If it only checks inline fixtures, re-implements
   the logic, or routes through a `scripts/*.{py,js} test <name>` harness that ships its own data,
   it is a stub — do NOT earn off it. (DanteSecurity's `scripts/dante.py test <name>` and
   `capability_tests_*.py` harnesses are KNOWN self-fulfilling stubs — never declare them.)
   ⚠ POLYGLOT GATE BLIND SPOT: DanteForge's automatic seam-scan and callsite-coupling check parse
   ONLY `*.test.ts` filenames — for `cargo test`/`pytest`/`go test` they run on ZERO files and
   ALWAYS pass. They will NOT catch a non-JS test that mocks, uses inline fixtures, re-implements
   the logic, or never calls the callsite. So for ANY non-JS test you MUST manually paste, in your
   report, the test's key assertion lines AND the production symbol they import/call — proving the
   test drives the real wired module.

E. DECLARE the outcome in matrix.json for that dim:
       kind: "shell"   |   tier: "T4" (set LITERALLY — see TIER DISCIPLINE)
       command: the REAL single-module test runner (forms below)
       required_callsite: the PRODUCTION src file path (the wired module, not the test file)
   If the dim already has an always-failing scaffold (commonly `exit 1`, `false`, `echo …; exit 1`,
   `process.exit(1)`), REPLACE it. If it has no outcome (or only T0–T2 file-existence checks), ADD
   yours. Absence of an exit-1 scaffold does NOT mean the dim is already earned — check `gap <dim>`.
   SCOPE EVERY command to your ONE module (the gate re-runs it on every validate; a tree wildcard
   re-triggers the full-suite stall and bakes it into matrix.json):
       Rust:   cargo test -p <workspace-member> --lib <module_or_test>   (member name, NOT a path; ALWAYS include --lib <name>)
       TS/JS:  npx tsx --test tests/<file>.test.ts                       (or the repo's single-file runner)
       Python: pytest <path>/test_<x>.py                                 (name the ONE file; never bare `pytest`)
       Go:     go test ./relative/path/to/pkg                            (leaf package; never ./...)
   MONOREPO: required_callsite AND the command path must be REPO-ROOT-RELATIVE; validate runs from
   the repo root (where .danteforge/ lives). After declaring, open the validate output and confirm
   the gate actually FOUND and RAN your test (non-zero outcome count, a real pass line). If it
   reports 0 outcomes or can't resolve the callsite, your PATH is wrong — fix it, don't move on.

F. GATE-CONFIRM (the verdict, not the number):
       danteforge validate <dimId> --force-cold --json
   SUCCESS = `allPassed:true` for this dim AND its result object has NO `integrityCap` field (i.e.
   integrityCap is absent/undefined — NOT "ORPHAN_CALLSITE"/"SEAM_USAGE"/"CALLSITE_DECOUPLED"/
   "SHARED_RECEIPT"/"NO_FRONTIER_SPEC") AND failingOutcomes is 0. The human-readable run shows
   `[PASS] <dim> … (N/N outcomes)` with NO yellow "Score capped … by <CAP> integrity violation"
   line.
   • The score DELTA is NOT the honesty signal. A clean earn can legitimately read `0.0 → 0.0` or
     cap at exactly 7.0 (dirty-tree / market-cap / multi-session veto independently clamping the
     number) — that is NOT a refusal and NOT a reason to re-engineer. If you see `[PASS]` + passing
     outcomes + NO integrityCap but a flat delta, run `danteforge gap <dim>` to read the clamp; if
     the clamp is dirty-tree or a cap unrelated to YOUR evidence, the dim is honestly earned at the
     gate level — record it and move on.
   • An `integrityCap` of ORPHAN_CALLSITE / SEAM_USAGE / CALLSITE_DECOUPLED lands at ~7.0 while
     STILL printing PASS and exiting 0 — that is a FAKE earn regardless of the printed score.
     Discard it; the dim is not earnable as wired.
   • If the test genuinely FAILS (failingOutcomes>0), that is a REAL gap → do real build work to
     fix it, or SKIP the dim. NEVER relabel a decoupled/failing outcome to move the number.
   • --force-cold caveat: validate defaults to force-cold; single-dim --force-cold is safe per
     cycle (it does not strip other dims' cached scores). It re-stamps ONE session id — irrelevant
     for a T4/7.0 earn. NEVER run `validate --all --force-cold` — that re-stamps every dim with one
     session id in one process and silently COLLAPSES any pre-existing T7/9.0 multi-session proof.
     One dim per validate, always.

G. COMPILE CLEAN, then commit ONE dim:
       Compile: Rust → cargo check | TS → npx tsc --noEmit | Go → go build ./... |
                Python → python -m py_compile <changed_file.py> (syntax); the passing pytest in F is
                your real correctness proof. An import error from a PYTHONPATH/cwd issue is NOT
                broken code — fix the invocation, don't skip the dim.
   NEVER commit broken code. NEVER run the project's FULL test suite (it stalls — run only your
   one module/file).
   Stage EXPLICITLY BY PATH — the exact production file + the exact test file you wrote this cycle.
   NEVER `git add .` / `git add -A` (sweeps unrelated changes), and NEVER stage
   `.danteforge/compete/matrix.json` or anything under `.danteforge/compete/`, `.danteforge/scores/`,
   `.danteforge/score-proposals/` — the matrix is KERNEL-OWNED local state and DanteForge's
   pre-commit hook BLOCKS worker commits that stage it. Leave the outcome declaration on disk in the
   local matrix for review; your report's gate-confirm line is the proof.
   Re-assert branch (`git rev-parse --abbrev-ref HEAD`, not main/master), then `git commit`.
   NEVER use `--no-verify` (even once, even justified) and NEVER set DANTEFORGE_MATRIX_MERGE_RECEIPT
   — the hook is a real stub/mock/seam backstop. If the hook blocks on UNRELATED pre-existing
   failures: STOP the loop (do NOT pile more dims onto an uncommittable dirty tree — you'd lose
   one-dim-per-commit). Quote the exact failing check, record the dim as BLOCKED, and finish. Any
   dims you already committed cleanly this run are real — you still push those.

Then go to A for the next dim.

═══════════════════════════════════════════════════════════════════════════════
PER-CYCLE DRIFT-GUARD CHECKLIST (paste PASS/FAIL for ALL six, EVERY cycle — cycle 6 = cycle 1)
═══════════════════════════════════════════════════════════════════════════════
[ ] validate --json shows integrityCap ABSENT + allPassed:true + failingOutcomes:0
[ ] (orphan case) I pasted the production call line + named the observable artifact I saw
[ ] I pasted the test's assertions + the real production symbol they drive
[ ] tier is literally "T4" for the test-runner command (not omitted, not copied higher)
[ ] the capability is a real product behavior (passed existence test + substance floor) — not a getter/constructor/tautology
[ ] I did NOT earn off a self-fulfilling capability_test script
Skipping any box = the earn is VOID; you may not bank it.

═══════════════════════════════════════════════════════════════════════════════
TIER DISCIPLINE (where over-credit hides)
═══════════════════════════════════════════════════════════════════════════════
T4/7.0 = code exists + production callsite wired + tests pass. NO product-run needed. THIS LOOP
earns T4 ONLY. A TEST RUNNER (cargo test / pytest / go test / npx tsx --test / jest / vitest) is
FORBIDDEN at T5 or above — a test run is T4 in EVERY language. The gate now enforces this
polyglot-wide (since 337f1e3 + the 2026-06-10 demote fix: an over-declared test-runner is DEMOTED
to T4/7.0 — the old JS-only escape that silently awarded 8.0 is closed). Declare tier:"T4"
literally anyway: the tier you write is the claim you make; relying on the gate to correct your
over-claim is still over-claiming, and the demotion will be flagged in your report's breakdown.
If gate-confirm ever shows >7.0 for a test-runner command, that is a bug — treat it as a refusal,
set T4, re-validate, and report the over-credit. T5+ needs a REAL PRODUCT RUN (shipping binary/CLI
on realistic input → observable artifact, ≤7 days) — NOT this loop. Wanting T5 to keep the number
moving IS the DRY signal — STOP.

═══════════════════════════════════════════════════════════════════════════════
OUTER LOOP — LOOP UNTIL DRY
═══════════════════════════════════════════════════════════════════════════════
Repeat A–G for as many dims as you can HONESTLY earn, easiest-first, one at a time.
TIME-BOX each dim: if one dim consumes >~30 min or two failed validate cycles without progress,
SKIP it (record as needs-real-build) — one hard dim is NEVER grounds to declare the whole repo dry.
Optionally cap the batch at ~5 earns per run for reviewability. You will NEVER be judged on count.

DRIFT GUARD: re-run the SAME six-box checklist for EVERY earn. "I already earned 5" must NEVER
soften the 6th. No exceptions accumulate.

DRY-IS-SUCCESS + DRY LEDGER: you may declare DRY only AFTER listing EVERY remaining dim whose
`gap` score is below its ceiling and tagging each with one reason from this CLOSED set:
{self-fulfilling-capability-stub | orphan-with-no-wireable-live-consumer | wired-test-genuinely-
fails-needs-build | trivial/tautological-capability | already-at-ceiling-or-capped |
no-matching-production-module | stale-evidence-needs-revalidation (already earned; a `validate
<dim> --force-cold` refreshes it — NOT a new earn; should have been cleared in the SETUP preflight) |
derived-stuck-tool-bug (every outcome PASSES but the score won't leave 0.0 — a scoring-engine quirk,
not a capability gap)}. If any remaining dim fits NONE of these, it is potentially earnable
— investigate before stopping. You may NOT declare dry after sampling a few dims. The instant the
NEXT dim would need fabrication, relabeling, a stub, a self-fulfilling capability test, or guesswork
to move — STOP. Do NOT manufacture a dim, lower the bar, or relabel a decoupled outcome to keep the
loop alive. A batch of ZERO honest earns with a complete DRY ledger is a FULL SUCCESS. A fake earn
is the ONLY failure mode; an honest skip never is.

═══════════════════════════════════════════════════════════════════════════════
NEVER
═══════════════════════════════════════════════════════════════════════════════
Fabricate · relabel a decoupled/failing outcome · stub/mock/TODO · earn off a self-fulfilling
capability stub · hand-edit any score field · declare a test runner T5+ · commit broken code · run
the full test suite · `git add .`/`-A` · stage matrix.json / .danteforge score surfaces ·
`--no-verify` · set DANTEFORGE_MATRIX_MERGE_RECEIPT · `validate --all --force-cold` · `git reset
--hard`/`git clean` · touch the DanteForge tool itself · commit to or push main/master.

═══════════════════════════════════════════════════════════════════════════════
WHEN DRY (or blocked): PUSH (never main) AND REPORT
═══════════════════════════════════════════════════════════════════════════════
1. Confirm there is something to push: `git rev-list --count <base-branch>..HEAD`. If 0 (immediate
   dry, or every candidate refused/blocked), do NOT push and do NOT commit anything — report the
   finding and STOP. Push ONLY when ≥1 honest dim commit exists.
2. Resolve the branch at push time: `BR=$(git rev-parse --abbrev-ref HEAD)`. Assert `$BR` starts
   with `danteforge/honest-climb-` AND is not main/master — if not, STOP, do NOT push. Then
   `git push -u origin "$BR"`. Never type a branch name from memory. If push fails (no remote /
   auth), record it and leave commits local.
3. Paste back the STRUCTURED BATCH REPORT.

═══════════════════════════════════════════════════════════════════════════════
STRUCTURED BATCH REPORT-BACK TEMPLATE (fill in, paste back)
═══════════════════════════════════════════════════════════════════════════════
PROJECT: <repo name / path>
BRANCH:  danteforge/honest-climb-<repo>-YYYYMMDD-NN  |  PUSH: <pushed to origin / push failed: reason / local-only / nothing-to-push>

EARNED DIMS (one block per honestly-earned dim):
  - dimId:            <id>
    score:            <before> -> <after>   (delta may be flat/clamped — that's fine)
    integrityCap:     <absent>   (MUST be absent — any value here = void earn)
    real engineering: <what was done — wired orphan X into live consumer Y producing artifact Z /
                       wrote seam-free test exercising wired module M / fixed real bug B>
    test proof:       <the test's key assertion line(s) + the production symbol they import/call>
    artifact (orphan):<the production call line + the observable artifact you saw, or "n/a (wired)">
    gate-confirm:     "<literal [PASS] line, e.g. [PASS] <dim> 0.0 → 7.0 (3/3 outcomes)>"
    six-box drift:    <all PASS — list any box you could not check>
    commit:           <sha>   (or "local-only, blocked by <quoted failing hook check>")
  - … repeat per earned dim …

SKIPPED DIMS (each, with the specific real build work it needs): <list or "none">

HONEST MEAN (gap --all, derived):  <before> -> <after>

DRY LEDGER (per-dim disposition for EVERY remaining sub-ceiling dim, from the closed tag set):
  <dimId>: <tag>  —  <one line>
  …

LANDMINES / BLOCKED: <pre-commit-hook blocks on unrelated failures (quote the check); orphans not
  honestly wireable; decoupled outcomes you correctly refused to relabel; push failures. "None" if clean.>
