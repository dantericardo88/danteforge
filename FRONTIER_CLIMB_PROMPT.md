# Autonomous Frontier Climb — the never-stop generic prompt

Paste the block below into a fresh agent in ANY project that has a DanteForge matrix. It drives every
dimension up the honest ladder (0 → 7 → 8 → 9) and KEEPS LOOPING, cycle after cycle, until every
dimension is either court-validated at the frontier (9.0) or sitting at a DOCUMENTED honest ceiling
(a court ceiling receipt or a structural market cap). It never fabricates — the integrity gate caps
anything unearned, so the only way a number moves is real engineering.

> This prompt was hardened after an adversarial audit caught a fatal trap: the multi-session frontier
> proof collapses if you re-run outcomes with the default `validate` (which is `--force-cold`). The
> capture loop below uses `validate --preserve-sessions` and keeps HEAD stable — both are load-bearing.

---

You are an autonomous engineer driving this project to the competitive frontier with the DanteForge
honesty gate. Climb EVERY dimension as far up the honest ladder as its evidence allows, and KEEP
LOOPING over the dimensions — do not stop after one dim or one pass. Stop only when a full pass over
all non-DONE dimensions earns nothing new.

THE ONE RULE: a score is EARNED at the gate, never typed. A no-op pass is success; a fabricated number
is failure. If you cannot earn a dim honestly this cycle, log the real work it needs and move on.
Never relabel a decoupled/orphan outcome as real, never stub/mock/TODO — that is fabrication the gate
and the human audit queue will catch.

Run the CLI as `node <path-to>/dist/index.js <cmd>` (or `danteforge <cmd>` if globally linked).

## Orient (once per session)
1. `status` (the top-level dashboard). Its headline can be stale, so compute the GATE-CONFIRMED mean:
   `python -c "import io,json;m=json.load(io.open('.danteforge/compete/matrix.json',encoding='utf-8'));v=[(d.get('scores') or {}).get('derived') for d in m['dimensions']];v=[x for x in v if isinstance(x,(int,float))];print('derived mean',round(sum(v)/len(v),2))"`
2. `… ground-outcomes --apply` — self-heals known outcome bugs.
3. ALWAYS rank and select dims by `scores.derived` (the gate-confirmed score), NEVER `scores.self`
   (which may be fabricated fiction the gate never touched). A dim with self=9 but derived=5 is a
   derived-5 dim — climb it.

## The ladder — for each dim, climb the ONE rung that matches its current DERIVED state

### Rung 0 → 7  (wire + seam-free test) — derived 0, or a decoupled/orphan module
- Find the production-wired capability module. If it is an ORPHAN (no production importer), wire it
  GENUINELY into the live product first (a real consumer, not a token import).
- Write a SEAM-FREE test that genuinely exercises the wired module (no mocks, stubs, or `_cipCheck`).
- Declare the outcome at its accurate tier (T4). Confirm: `validate <dim> --force-cold` shows 0 → 7.0.

### Rung 7 → 8  (real product run) — derived 7.0 (wired unit tests)
- Author a `cli-smoke` outcome (kind: `cli-smoke`, with `cli_args[]` + `expected_stdout_patterns[]` +
  a wired `required_callsite`) that runs the REAL product (`node dist/index.js <cmd>`), NOT a test
  runner. Do NOT use `session-record` at this rung — it emits a T7 receipt, and a lone T7 is vetoed
  to no-credit (T7 needs 3+ for consensus). A single real product run is T5 → 8.0.
- Confirm: `validate <dim> --force-cold` shows 7 → 8.0.

### Rung 8 → 9  (the frontier — real-user-path receipts + the court) — derived 8.0
This rung cannot be faked; the gate enforces every step. Do these IN ORDER.
1. `frontier-spec init <dim> --write` — auto-SEEDS the 9.0 bar (`observed_capability` +
   `category_delta`) VERBATIM from the competitor-grounded Score Ladder. **If the dim has no Score
   Ladder** (`spec-incomplete`), STOP this dim and log it as blocked — build the universe first
   (`compete --init` / universe synthesis); do NOT hand-write an easy bar (the gate rejects a
   `category_delta` that doesn't contain the documented ladder bar).
2. Fill the remaining `real_user_path` fields: `required_callsite` (the production file the run
   exercises), `run_command` (the real product command using a `{input}` token), `observable_artifacts`
   (a real file the run produces), and `realistic_inputs[]` — **≥2 genuinely DIFFERENT realistic
   inputs** (required; sessions must differ by more than a process UUID).
3. `frontier-spec check <dim>` must pass; then `frontier-spec freeze <dim> --write`.
4. **COMMIT the feature code now, and keep HEAD STABLE through steps 4–5.** Evidence is SHA-scoped and
   the session cache only holds at one HEAD — a commit between capture and court orphans the receipts
   (the court then sees 0). Capture ≥3 receipts across ≥2 DISTINCT sessions, one per realistic input —
   substitute each input into the command BY HAND (session-record does not read `realistic_inputs[]`):
   ```
   session-record <dim> --run "<real cmd on input #1>" --callsite <file> --artifact <path> --write
   validate <dim> --preserve-sessions        #  <-- session 1
   session-record <dim> --run "<real cmd on input #2>" --callsite <file> --artifact <path> --write
   validate <dim> --preserve-sessions        #  <-- session 2 (different input)
   session-record <dim> --run "<real cmd on input #3>" --callsite <file> --artifact <path> --write
   validate <dim> --preserve-sessions        #  <-- session 3
   ```
   **Use `--preserve-sessions` on EVERY validate here, and NEVER `--force-cold` (nor the bare default,
   which IS `--force-cold`).** Plain/`--force-cold` validate re-runs all outcomes and re-stamps them
   with ONE session_id, collapsing the proof — the score kernel then vetoes it and 9.0 can never land.
   `--preserve-sessions` runs only the new receipt (its own session) and serves the priors from cache.
5. `frontier-review <dim> --write` — a deterministic receipt gate runs first (≥3 passing T5+ receipts
   across ≥2 distinct sessions); only then do independent judges decide whether the artifact genuinely
   matches/beats the named competitor. VALIDATED → 9.0. REJECTED with an agreed ceiling → an honest
   ceiling: it writes a ceiling receipt; log it and move on.
6. NOW append the Progress-Log line and commit (the per-cycle commit happens AFTER the court, never
   during capture).

## A dim is DONE (stop climbing it) only when ONE of these is true — never by self-declaration
- Court-VALIDATED at 9.0.
- A court-WRITTEN ceiling receipt exists (frontier-review REJECTED with an agreed ceiling). An "honest
  ceiling" you merely *believe* in does NOT count — only a written receipt does.
- It is a STRUCTURAL market cap: `token_economy`, `enterprise_readiness`, `community_adoption` are
  permanently capped at 5.0 (they need real external adoption/telemetry you cannot fabricate).
- `spec-incomplete` because there is no Score Ladder → blocked on universe research; log it.
Stale receipts (evidence aged out) are NOT done → RE-VALIDATE (re-run the real product); never re-type.

## Each cycle
1. Pick the lowest `scores.derived` non-DONE dim; climb the ONE matching rung above.
2. Gate-confirm the honest gain. If the gate refuses, the work is not done — never commit a fake.
3. Safety: run the project's typecheck (`tsc --noEmit` / `cargo check` / …). Never commit broken code.
   Never run the full test suite (it stalls). Leave `matrix.json` local; commit the real CODE.
4. LOOP to the next dim. Keep cycling.

## Termination (so the loop ends honestly, not by churn)
- Stop when a FULL pass over all non-DONE dims earns nothing new (every remainder is DONE or logged-blocked).
- Hard backstop: if you complete ~10 cycles with zero derived-mean movement, STOP and report the
  blocked list (which dims need universe ladders / a built capability / external adoption).
- To recompute the true derived mean across all dims WITHOUT destroying frontier proofs, use
  `validate --all --preserve-sessions` — NEVER `validate --all --force-cold` (it re-runs every dim in
  one process and collapses every validated dim's sessions, reverting them below the frontier).

## Never
Fabricate · relabel a decoupled/orphan outcome as real · stub / mock / TODO · use `--force-cold` (or
the bare default) inside the frontier session loop · `validate --all --force-cold` after dims are
validated · commit during the receipt-capture → court window · commit broken code · run the full test
suite · `git reset --hard` / `clean` · declare a dim DONE without a court verdict or a structural cap.
