# Grading integrity — what still stands in the way of accurate + fair scoring

Output of a 7-angle, 56-agent adversarial audit (2026-06-15). 44/48 candidate gaps confirmed real
against HEAD. The scoring kernel is genuinely honest *within its own frame* (min(self,derived),
market caps, demotions, the read-time frontier gate all do real work — which is why the headline
self-deflates to ~8 and independent re-grades land ~6.4–7.7 instead of fiction). What remains is
**one root with three faces.**

## The root
The grader and the graded are the same closed system, and **no gate verifies the MEANING of evidence —
only its mechanics.** The capability gate trusts exit-0 (not "does this exercise the capability"); T7
trusts distinct files/sessions (not distinct capabilities); the honesty gate trusts wiring/seam-freeness
(not "did this originate outside the project"); the court trusts K-of-M LLM agreement against a
self-authored rubric; "real-user-path" trusts a free-text declaration. The apparatus can certify
self-CONSISTENCY, never self-GROUNDING.

## What "perfect" grading would require (3 layers)
1. **Evidence the grader cannot author or trivially satisfy** — enforced propose≠accept, kernel-owned
   outcome-evidence, distinct-*command* (not file/session) T7, a capability gate that rejects --help probes.
2. **Gates that verify meaning, not mechanics** — tier credit bound to the competitor ladder rung; T7
   receipts must exercise the dim's own callsite; cli-smokes assert a computed result not a banner; a
   genuinely independent court with a robust verdict parser + calibration.
3. **At least one anchor outside the repo** — one real external-benchmark receipt; an independent grader
   scoring the named competitors; gap_to_leader vs honest derived; external telemetry for meta-dims.

## Progress (2026-06-15)
**Closed + proven (the 4 highest-leverage deterministic inflation paths):**
- ✅ **#1** capability gate now inspects meaning — `--help`/test-suite/structural pass → cap 7.0, green-forcing → 5.0, only a real product run → 10; merge court clamps on `>scoreCap` (commit 2e80fc3).
- ✅ **#2** T7 cloning hole closed — distinct-COMMAND consensus across derived-score + evidence-rescore + court gatherReceipts (commit 733aa19).
- ✅ **#5** verdict parser anchored to the LAST `VERDICT:` declaration — a reasoning FAIL no longer parses as PASS (commit 2e80fc3).
- ✅ **#8** gap_to_leader computed from the honest decision score, `derived` excluded from the competitor pool (commit 2e80fc3).

- ✅ **#4 (lock half)** kernel-own outcome-evidence — a build worker can no longer write the receipts the scorer trusts (commit a2ec29b). Remaining: route session-record through propose≠accept + derived-score consult isAccepted (the orchestrator-self-author half).
- ✅ **#6 (visibility half)** `danteforge grounding` + externalGroundingReport — surfaces the self-vs-world ratio (today 0%) (commit 219bd9a). Remaining: run ONE registered external benchmark end-to-end (needs compute/LLM) + decide the self-run→8.0 provenance cap (policy).
- ✅ **#7** cli-smoke `--help`/version/bare probes now cap at 7.0, not 8.5 — closed the 7→8 banner lift (commit b723739).
- ✅ **#11** honest-rescore defers to the canonical score when it has no probe data — ends the ~7pt false divergence between the two honesty tools (commit dd36228).

- ✅ **#9** unverified self>8 badged in `compete status` + derived no longer leaks as leader (commit eed9c03).
- ✅ **#3 (code, BOTH halves)** grok reserved as the JUDGE-ONLY third member (commit 00bff18) AND the sequential push now excludes ALL contributing builders, not just one (commit e58c664) — closing the multi-builder self-judge hole where council-crusade built with codex+claude and then let both judge their own work. The court takes `excludeMemberIds` (full builder roster) → judge pool = judge-only members only; <2 → honest throw, never a self-certified PASS. Parallel path: single builder excluded + grok = 2 independent judges of 3 model families. ✅ ACTIVATED (commit 067e9f9): the court was briefly dormant because a stale `DANTEFORGE_COUNCIL_MEMBERS=codex,claude-code` env var (from grok's builder era) hid a fully-working, logged-in grok (grok.exe → 0.2.51). Judge-only members now BYPASS that builder filter, so grok is always discovered as a judge. Proven live — `council --ask` seats 3 members ("✓ Grok Build (xAI — judge only)") and grok answers. The independent 9.0 court now convenes: codex + claude build, grok + the other builder judge (2 independent judges, 3 model families). ⚠ REDUNDANCY (CH-023): still only ONE judge-only member — grok down/conflicted ⇒ no independent court; a robust court wants ≥2 judge-only members (reinstate gemini-cli as judge-only or add a 4th model).

**10 of 13 closed (code).** The roster decision for #3 is made + built — grok is the reserved judge. Remaining: #10 (stale-evidence/HEAD badge — display, needs scored-SHA vs HEAD), #12 (author ux_polish ladder + missing-ladder gate — needs competitive research), #4-full (propose/accept routing — large), #13 (semantic relevance + meta-dim split — large), #6-run (external benchmark — needs COMPUTE), and #3-activation (a reliably-available grok-build CLI so the independent court actually convenes). The internal-trust layer (a loop can't inflate its own number) is complete; the autonomy finish line is now a RESOURCE line, not a code line: a working grok CLI (#3 activation) and/or one real external benchmark run (#6) — both need compute/auth, not more code.

**Remaining work, by what it needs:**
- *Code I can build next:* #3 builder-never-self (court), #7 cli-smoke must assert a computed result, #9/#10 badge raw self + evidence staleness, #11 make the two honesty tools agree, #12 wire ladder rung into derivation + author ux_polish ladder.
- *Larger build:* #4 propose/accept routing + isAccepted consult; #13 semantic-relevance (T7 must exercise the dim's own callsite) + meta-dim internal/external split.
- *Operator decisions / resources (not "can't" — needs a call or compute):* #3 a real ≥3rd judge in the roster; #6 running a real external benchmark (API/compute) + the self-run→8.0 cap policy.

Also filed: capability-test-sensitivity.test.ts "always RESTORES" fails at HEAD (pre-existing, not in any verify lane).

## Ranked gaps (confirmed)

| # | Gap | Effort | Distortion | Fix |
|---|-----|--------|-----------|-----|
| 1 | **Capability gate accepts exit-0 alone** — the #1 advertised anti-self-scoring control never inspects what the test exercises; any `--help`/`status`/`echo` returns allowed:true/scoreCap:10. The real defenses (auditCapabilityTest + sensitivity probe) exist but are wired into nothing on the scoring path. | medium | inflation; 5 dims (27% weight) protected by registration banners | Route the command through the existing `looksLikeProductRun`/`auditCapabilityTest` reject before allowed:true; cap trivial-subcommand tests at 7.0 |
| 2 | **T7 "multi-receipt consensus" (the 9.0 path) satisfiable by cloning ONE command N times** — distinct-file veto is skipped for product runs (`extractTestFiles` returns [] ); only diversity guard is a per-process UUID session_id. | medium | inflation; largest structural driver of self-vs-honest gap (+1.0 live, +2.0 once any spec validates) | Dedupe T7 high-tier outcomes by normalized command identity; require ≥2–3 distinct commands |
| 3 | **The 9.0 court is unreachable when independent, non-independent when reachable** — 2-member roster → builder-excluded parallel court can't convene; the sequential path omits `--builder` so the builder judges itself. | medium | inflation+blockage; a 9 is either impossible or self-certified | Restore ≥3-member roster; thread builder into sequential push + pass --builder; surface "court couldn't convene" as explicit state |
| 4 | **Propose/accept keystone is dead code on the scoring path** — 0/130 T5+ outcomes carry an acceptance stamp; session-record writes T7 straight to matrix.json; derived-score has 0 refs to isAccepted; outcome-evidence/** is worker-writable. | large | unfairness+inflation; the loop writes the exam and grades it | Add outcome-evidence/** to kernel-owned forbidden; route session-record through propose+independent-accept; exclude unstamped T5+ from T7 |
| 5 | **Verdict parser reads PASS before FAIL by unanchored substring** — a reasoning FAIL that quotes the rubric parses as PASS; duplicated across all council verdict paths. | small | inflation; flips intended FAIL→PASS | Parse last `VERDICT:` line, anchored regex; fix both copies; add a FAIL-quotes-PASS test |
| 6 | **No score reaches outside the repo** — "real-user-path" = DanteForge running its own CLI; the external-benchmark/9.5 hook + benchmark runner exist but are used by 0 dims. | research | the ceiling on accuracy; self-consistent ≠ world-consistent | Wire ONE registered suite (humaneval/swe-bench-lite) to functionality; cap self-run at ~8.0; add an external-grounding ratio |
| 7 | **7→8 lift for ~16 dims rests on one cli-smoke = exit-0 + static banner regex** (two are literally --help) | medium | inflation ~+1.0/dim, ~+0.5 headline | Reject --help/version/bare from T5+ credit; require expected_stdout to assert a computed result; ≥2 distinct smokes; bind to ladder rung |
| 8 | **gap_to_leader computed against raw self (9), not derived (8)** — 14 non-meta dims trail their competitor but read leader=self/gap=0, so the loop never prioritizes them. | small | inflation of standing + loop misrouting | Compute gaps from decisionDimScore/effective, not scores.self (one-liner + test) |
| 9 | **scores.self=9 persists raw across 21 dims with 0 court validations** and leaks to every display the gate doesn't touch. | small | bounded perception-inflation | Cap displayed self by the frontier gate, or badge raw self "unverified — not court-validated" |
| 10 | **Scores describe a code state ~10 commits stale** — HEAD has 0 evidence; loadOutcomeEvidence silently borrows prior-SHA receipts within the freshness window, no staleness flag. | small | inflation/unfairness | Surface evidence-age/SHA badge + "scored against X, HEAD is Y"; confidence discount when 0 receipts match HEAD |
| 11 | **Two honesty tools disagree by ~7 points on the same matrix** — compete path → ~8; probe/honest-rescore → 1.0 (reads raw self + a different/empty evidence store). | medium | unfairness/instability | Make the probe consume the same loadOutcomeEvidence (SHA-fallback+freshness) |
| 12 | **Score Ladders never matched against evidence at scoring time; ux_polish has no ladder at all** — rubric-ladder feeds prompts only; derived-score doesn't import it; missing ladder → silent []. | medium | unfairness (laddered vs unladdered graded the same); decoupling | Author ux_polish ladder + assert all dims have one; wire ladderRowAtOrAbove into derivation; hard-error missing ladder for >8.0 |
| 13 | **Semantic relevance never checked + meta-cap/weight distortions** — a token-accounting test grades "Performance"; T7 credit runs self-referential meta-commands; meta-dims hard-capped at 5.0 deflate real work; round undocumented weights; self-settable declared_ceiling. | large | mixed (relevance-drift inflates, meta-caps deflate, soft surfaces launder) | T7 must exercise the dim's own callsite; real perf benchmark; split meta-dims internal/external sub-axes; document weights; justify ceilings |

## Honest magnitudes (verifier corrections)
Most of these are **latent** today: the frontier gate (0/24 specs validated) caps derived at 8.0, so
cloning/proxy holes mostly don't reach 9 *yet* — but they activate the moment any spec validates, and
`scores.self=9` already leaks raw to non-gated displays. The live honest weighted mean is ~7.3–7.8 by
the gated path; the deeper truth is the apparatus can't tell "9-grade vs competitors" from "9-grade
against a rubric we wrote."

## Recommended sequence
- **Cheap + deterministic + unambiguous (do first):** #5 (verdict parser), #8 (gap vs derived), #9 (badge raw self), #1 (capability gate → reject --help), #2 (distinct-command T7). These directly close inflation paths with tests.
- **Then:** #3 (court independence), #4 (propose/accept enforced), #7/#12 (meaning-bound tier credit).
- **Strategic (needs a decision):** #6 external grounding — the one move that converts "honest within our frame" to "true against the world," and structurally closes the cloning/proxy/court holes because they all exploit the grader's authority over its own evidence.
