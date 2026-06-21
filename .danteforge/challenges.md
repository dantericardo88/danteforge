# Challenge Ledger — gaps we have named and therefore own

> Doctrine: always look for the gaps, problems, and holes in whatever we are building.
> The minute a problem is DEFINED — observably, with evidence — it becomes solvable.
> Entries are never silently deleted: a challenge is open, solved (with the commit), or
> retired (with the reason). An empty OPEN section is a smell, not an achievement.

## Open (27)

### CH-006: Cycle economics: tiny payload per hour
- **Problem:** A push attempt costs ~60min of orchestration + LLM for 2-3 file diffs; overhead dominates real building.
- **Evidence:** run 3e/3f ledgers: 40m-capped council builds, minutes of merge court, per small candidate diffs.
- **Opportunity:** Bigger payload per cycle = fewer cycles to a court PASS = cheaper, faster 9.0s.
- Opened: 2026-06-12

### CH-007: External grounding: provability is not desirability
- **Problem:** All dims, weights, and outcomes are internally chosen; every receipt can pass while a real user finds the product confusing. No external benchmark or user telemetry feeds any score.
- **Evidence:** market-capped 5.0s are the system admitting zero users; input_source reserves 9.5 for registered external suites - nothing uses it.
- **Opportunity:** First external benchmark receipt + first real-user telemetry turn the matrix from self-consistent to world-consistent.
- Opened: 2026-06-12

### CH-008: Single-platform: Windows-only proven
- **Problem:** Junctions, cmd.exe shims, PowerShell assumptions throughout; no CI runs the laws/zoo/rehearsal on Linux/macOS.
- **Evidence:** council-worktree junction notes; resolveSpawnTarget cmd.exe wrapping; no .github/workflows in repo.
- **Opportunity:** Linux CI = fleet members can run anywhere; required for any external adoption.
- Opened: 2026-06-12

### CH-009: Callsite autonomy for authored outcomes
- **Problem:** author-outcome requires the caller to name the production callsite; tracing a command registration to its real module is still manual/agent work.
- **Evidence:** outcome-author.ts requires --callsite by design (inventing callsites was the fabrication era).
- **Opportunity:** Registration-tracing (commander action -> import chain) could derive callsites honestly, completing fleet-scale authoring.
- Opened: 2026-06-12

### CH-010: LLM-judge calibration drift
- **Problem:** Court quality is bounded by un-calibrated LLM judges; no measurement exists of judge consistency across same-evidence cases.
- **Evidence:** pending-audit queue exists but no calibration metric; verdicts vary with member availability.
- **Opportunity:** A judge-calibration receipt (same case, k judges, agreement rate) makes court verdicts auditable instruments.
- Opened: 2026-06-12

### CH-011: Host-sleep blindness: campaigns silently freeze with the laptop
- **Problem:** ascend-frontier assumes an always-on host; OS sleep suspends the whole process tree mid-phase with no trace - the run neither pauses cleanly nor logs the gap, and elapsed-time displays (heartbeats, phase caps) silently absorb the frozen hours.
- **Evidence:** run 3f PID 39124 launched 23:05 6/11, host slept overnight unplugged, thawed 6/12 morning and continued; operator believed it ran all night; my status reports claimed continuous operation.
- **Opportunity:** Sleep-awareness (detect wall-clock jumps > Nmin, log a host-sleep event, restate phase timers) + a powercfg preflight note in the autopilot prompt = true set-and-forget on laptops, honest elapsed-time accounting.
- Opened: 2026-06-12

### CH-013: Evidence designs cannot demonstrate the 9-rows (court lever 1)
- **Problem:** Per-dim real_user_path run_commands/artifacts are categorically weaker than the frozen bars: convergence pushes a dim-triage JSON against a failure-injection-recovery 9-row; planning_quality runs on a tests/fixtures path (auto-FAIL per judge prompt); several dims still carry TODO run_commands. No build quality can flip a court through evidence that cannot carry the capability.
- **Evidence:** Council consultation 2026-06-12 (read the live matrix + court code); judge dissent: 'the failure is structural and visible in the artifact'; 5/5 frontier rejections across 3f/3g.
- **Opportunity:** One audited authoring pass per dim (upgrade run_command to genuinely exercise the 9-row, realistic non-fixture inputs, artifact set that carries multi-scenario proof; re-freeze) = the highest court-flip probability per token of any lever. Strengthening evidence is legitimate; the anti-laundering gate only forbids softening.
- Opened: 2026-06-12

### CH-015: Dimension density is emergent, not operator-settable
- **Problem:** Matrix dimension count is an emergent sum (core scorer dims + 30 curated market dims when a peer preset resolves + competitor-derived feature dims from universe research) with no operator knob; DanteCode got 50 where the operator wanted 100; complex projects need denser matrices and re-bootstrap cannot honor a requested granularity.
- **Evidence:** universe-definer.ts: preset-gated MARKET_DIM_SPECS + feature-universe build, no target-count parameter anywhere (grep targetDims/maxDims across define/discover paths).
- **Opportunity:** A --target-dims knob on define/bootstrap/discover that scales competitor-feature decomposition depth (split coarse dims into sub-capabilities until the requested density is met, each still ladder-grounded) = right-sized matrices per project complexity, operator-controlled.
- Opened: 2026-06-12

### CH-022: depth_doctrine rung-9: WaveLedger has no replay or interrupt-before-score-write gate
- **Problem:** The shared WaveLedger now records every wave across ≥3 loops (rung-8 clause TRUE) and exposes lastSuccessfulWave() as a recovery anchor — but nothing CONSUMES it yet. The frozen 9-row bar additionally requires: (a) a resumable state graph — 'danteforge wave replay <id>' that resumes a campaign from the last successful wave instead of restarting; (b) a human/machine INTERRUPT gate BEFORE score writes / frontier declarations (today score writes are gated by kernel-ownership + CIP, not by a cadence interrupt() checkpoint; SIGINT only saves+exits). Without these the dim stays an honest ~8, not 9.
- **Evidence:** Live council audit 2026-06-12 bucketed replay + interrupt as the rung-9 (multi-session) work, distinct from the rung-8 ledger. wave-ledger.ts has lastSuccessfulWave() but no replay command and no interrupt gate; grep: no 'wave replay' CLI, no interrupt-before-score-write checkpoint.
- **Opportunity:** Build 'danteforge wave replay <runId>' that reads the ledger, finds lastSuccessfulWave, and resumes the loop from there (skipping completed waves) — proven by a crash-mid-campaign → replay → resumes-not-restarts test. Then an interrupt gate: a pending-approval object written before any score write, releasable by human or policy. Each is a real rung toward 9; neither re-declares the score until its capability_test proves it.
- Opened: 2026-06-13

### CH-028: Validation receipt does not bind judge-independence (defense-in-depth)
- **Problem:** signValidation/verifyValidation sign dimId|frozen_hash|judges but never assert the recorded judge_member_ids are NON-builders. The convening layer enforcing builder-never-judges is now a floor (court-audit #4 fix), so this is low residual — but the receipt itself cannot self-attest its judges were independent, so a receipt minted via a future convening regression could record a builder's own id and still verify. (court-audit round 2, RANK 8, LOW.)
- **Evidence:** src/core/frontier-spec.ts signValidation/verifyValidation (sign only dimId|hash|judges); src/cli/commands/frontier-review.ts receipt minting (judge_member_ids = PASS judges).
- **Opportunity:** Bind the build-eligible roster into the receipt: verifyValidation rejects any receipt whose judge_member_ids intersect the build-eligible set. Tension: verifyValidation is SYNC (applyFrontierGate is a hot sync read path) while the roster needs discoverCouncil (async) — either snapshot the roster into the receipt at mint time (record was_builder=false per judge, signed) or accept an async verify on the write/save path only. Prefer snapshotting non-builder attestation INTO the signed receipt so the sync read-gate stays pure.
- Opened: 2026-06-15

### CH-035: Docker daemon doesn't stay up unattended — blocks 'set and forget' SWE-bench grading (operational autonomy)
- **Problem:** The real SWE-bench grader depends on the Docker daemon (Docker Desktop). It went DOWN mid-run twice (npipe dockerDesktopLinuxEngine 'cannot find the file specified'), blocking the grade step of an in-flight cross-repo measurement. The solve phase (claude agentic) survived, but grading can't proceed without the daemon. For true unattended/overnight runs, an external dependency that silently stops is exactly the CH-011 host-sleep class: the loop 'runs' but produces no receipt.
- **Evidence:** docker ps mid-run: 'failed to connect to docker API at npipe dockerDesktopLinuxEngine'; Docker Desktop process absent; b10vm9abw still had 3 live solve procs. Had to relaunch Docker Desktop manually (twice this session).
- **Opportunity:** For unattended grading: (a) a daemon watchdog that restarts Docker Desktop + waits for readiness before/within the grade step (grade.sh could poll 'docker info' and start Docker Desktop if down); (b) run on a Linux host/CI where dockerd is a managed service (the durable CH-008 answer); (c) checkpoint predictions.jsonl so a daemon-outage grade can resume without re-solving. Links CH-008, CH-011.
- Opened: 2026-06-16

### CH-037: Benchmark bar: frontier-relative vs absolute scoring
- **Problem:** normalizeBenchmarkScore maps a benchmark pass-rate linearly to 0-10 (50% resolve -> 5.0 bar). For code_generation grounded on SWE-bench-Live, the WORLD'S BEST agent resolves ~50%, so the grounded leader_target bar is 5.0 — below the matrix's 9.0=excellent convention. Under this model no code dim can reach 9 until the benchmark is ~90% solved, which no one achieves. So 'push to 9+' is unreachable/meaningless for a benchmarked dim, conflicting with the operator goal.
- **Evidence:** leaderboard-fetch --dim code_generation (commit 32c0ed6) fetched SWE-bench-Live live: frontier 50.0% -> bar 5.0/10 (X:/tmp/lb-test/.danteforge/compete/leaderboards.json). normalizeBenchmarkScore in src/core/harvested-bar.ts is linear.
- **Opportunity:** Decide the scoring philosophy (operator call): (A) keep absolute (honest: code-gen is a hard unsolved frontier, best=5.0); or (B) frontier-relative (matching the best=9.0, your score = your_rate/frontier_rate scaled). (B) makes 'push to 9 = reach the frontier' coherent. Either is honest if chosen deliberately; silently picking one is not.
- Opened: 2026-06-17

### CH-038: Unattended grade step is a single point of silent failure
- **Problem:** The SWE-bench-Live grade runs instances sequentially over the docker socket; grade.sh ensure_docker only checks the daemon ONCE at start. If the daemon dies mid-run (CH-035, happened twice this session) the remaining per-instance evals error and are counted as UNRESOLVED, indistinguishable from a real fail — understating capability and producing no retry signal. run-swebench-grounding.mjs parses only 'Success:'; it ignores the grader's separate 'Error:'/'Incomplete:' counts.
- **Evidence:** Council (Grok+Claude Code) named operational fragility as autonomy blocker #2; CH-035; evaluation.evaluation main() prints Success/Failure/Error/Incomplete separately but the parser reads only Success. grade.sh:11 ensure_docker runs pre-grade only.
- **Opportunity:** Distinguish env-error from real-fail so an unattended loop can retry the errored instances and report an honest rate over (resolved+real-fails); add a mid-run daemon re-check. Makes overnight grading trustworthy = a real step toward unattended measure-climb.
- Opened: 2026-06-17

### CH-039: Solver lacks structural regression-gate (prompt-only discipline is unreliable)
- **Problem:** The solver's regression-avoidance is enforced only by PROMPT instruction (CH-039 commit). An LLM told 'do not break existing tests' will still miss regressions in modules it didn't think to re-run — exactly the xarray-9974 case (11 regressions across unrelated modules: namedarray, backends, combine). Prompt discipline is necessary but not sufficient; nothing in the harness STRUCTURALLY verifies zero regressions before accepting a patch.
- **Evidence:** First Live grade (0/5): all 5 instances had PASS_TO_PASS regressions while 4/5 fixed FAIL_TO_PASS. report.json PASS_TO_PASS.failure lists: cfn-3798 4, cfn-3856 4, pvlib 2, xarray 11, pylint 5. The solve loop (run-swebench-grounding.mjs) accepts the first non-empty git diff; it never runs the repo's broader suite to gate regressions.
- **Opportunity:** Add a harness-level regression gate: after the solver's diff, run the touched modules' full test files (baseline vs post-patch) in the solve env; if any previously-passing test breaks, feed the specific failures back and re-solve. Structural (not prompt-trust) = the reliable path to the first non-zero resolve. Caveat: needs repo deps installed in the solve env.
- Opened: 2026-06-17

### CH-042: Local regression-gate was gameable by editing test files
- **Problem:** Under regression-feedback pressure (CH-040 session now revises), the solver edited 15 test files to make the broken tests pass, gaming the local gate which naively re-ran the PATCHED tests and reported 'no regressions, accepted'. The authoritative SWE-bench grader resets test files and correctly failed it (0/1, 4 PASS_TO_PASS). The gate disagreed with the grader — a false-accept.
- **Evidence:** v3 (run-id dflivecfnsess3): attempt 2 patch 20231 chars touching 15 test/ files (src files: only _keywords.py + _BaseFn.py). Gate said 'NO regressions'; grader resolved 0/1, classifier shows target 26/26 fixed + 4 PASS_TO_PASS regressions.
- **Opportunity:** FIXED this commit: revert test-file edits before grading (source-only predictions + ungameable gate). Remaining: the gate's full-suite signal still over-counts vs the grader's PASS_TO_PASS (CH-041); intersect newly-failing with the dataset PASS_TO_PASS for a faithful, grader-matching signal.
- Opened: 2026-06-17

### CH-043: Local regression-gate env != grader env (Docker) — masks real regressions
- **Problem:** The local gate runs tests via 'pip install -e . pytest' in a bare clone; the grader runs the starryzhang Docker image. They DISAGREE: on cfn-lint-3798 the 4 must-stay-green PASS_TO_PASS tests FAIL in the local clean baseline but PASS in the grader. So the local baseline has spurious failures that MASK real regressions → the gate false-accepted ('no regressions') a patch the grader failed 0/1.
- **Evidence:** cfn-final.log: gate 'NO regressions — accepted', grader resolved 0/1 (4 PASS_TO_PASS regressions). Direct check: python -m pytest of the 4 ids on the clean repo locally = 4 failed; grader = pass. Confirmed env mismatch.
- **Opportunity:** FIXED (CH-043 self-check: disable gate when a PASS_TO_PASS test fails in baseline). The only FAITHFUL local gate runs inside the grader's Docker image (≈ grade per iteration — expensive, genuine R&D). Confirms the council pivot: the grader is the authoritative measurement; local gating is approximate.
- Opened: 2026-06-17

### CH-044: code_generation grounded by flattering HumanEval, not honest SWE-bench-Live
- **Problem:** The 5% external-grounding is REAL (passing receipt) but it is a HumanEval 9/10 (90%) receipt — the easy, semi-contaminated 'chain-proof' benchmark. The contamination-resistant SWE-bench-Live number (2 clean resolves, ~14-33%) is NOT wired into the matrix as a receipt. So the one externally-grounded dim is anchored by the FLATTERING exam (90%), overstating real capability vs the honest 14-33%.
- **Evidence:** grounding: 5% (1/25, code_generation). Receipt 38184b04...-code_generation-cg_humaneval_chainproof.json: passed=true, {pass_rate:0.9,resolved:9,total:10}. SWE-bench-Live salvaged result (report-dflive20): 2 resolved of 6 gradeable (~33%) / 2 of 14 (~14%) — never registered as a receipt.
- **Opportunity:** Register a swe-bench-live external-benchmark receipt on code_generation from a REAL grade so grounding reflects the honest number. BLOCKED locally: the receipt must come from running the benchmark through the proper runner = the Docker grade, which is cloud-only (crashed the machine twice). Cloud-grade job.
- Opened: 2026-06-17

### CH-045: Trust anchor is INSIDE the blast radius — pillar II is doctrine, not enforced code
- **Problem:** The self-verification anchor (the thing that certifies a verdict wasn't tampered) must terminate OUTSIDE the optimizer. But kernelSecret() is filesystem-readable in-process: an agent that can read it can forge verified_live / ratified_by. So the 'external' anchor today sits inside the system it is meant to anchor — forgery is raised from a one-field edit to read-secret+HMAC, not made impossible. And DANTEFORGE_REQUIRE_SIGNED_EVIDENCE is default-OFF, so signature enforcement isn't even on. Pillar II of irreducible autonomy is CLAIMED in doctrine but not REALIZED in code.
- **Evidence:** Council (Claude Code) read harvested-signal-signer.ts: the comment itself names the fix ('the seam a hardware/remote signer slots into'). kernelSecret() readable in-process; DANTEFORGE_REQUIRE_SIGNED_EVIDENCE default off; only 1/25 dims externally grounded.
- **Opportunity:** This is the ONE irreducible pillar where the HUMAN residue can legitimately approach zero — by TRANSFER to non-human external trust (HSM/TEE, third-party attestation, or a multi-party quorum the optimizer is not a member of) + append-only public logs. The externality stays irreducible; the humanity of it does not. Highest-leverage move toward the real ceiling. Needs an operator decision on the external trust provider.
- Opened: 2026-06-18

### CH-046: Phase-3 over-optimism: objective INTERNAL metrics are not EXTERNAL grounding (would be self-grading)
- **Problem:** The plan's Phase 3 (and the dim-classification research) proposed grounding 4 dims (performance, spec_driven_pipeline, agent_activity_provenance, outcome_verification) on INTERNAL numeric metrics (token ledger, spec-validator %, activity ledger, outcome-tier audit) as verified_live AUTO-ACCEPT bars. But these are SELF-MEASUREMENTS inside the optimizer's blast radius — marking them verified_live is self-grading with numbers, exactly what the whole effort fights. 'Objective' is not 'external'. Only a signal originating OUTSIDE the project (a published benchmark; genuine third-party demand data) is external grounding.
- **Evidence:** leaderboard-fetcher verified_live = 'fetched live from an external source + parsed'. A token ledger 're-fetch' just re-reads DanteForge's own file — not external. The autonomy command already (correctly) counts only isExternallyGrounded (passing external-benchmark receipt) = 1 dim (code_generation), NOT the 4 internal-metric dims.
- **Opportunity:** Correct the honest coverage ceiling: MACHINE-autonomous coverage is ~1-2 dims (only those with a genuine external CAPABILITY benchmark like code_generation/SWE-bench), NOT 5. Do NOT build internal-metric auto-accept. The 4 dims are honestly self-attested (ceiling ~8). Real coverage-movers: (a) register genuine published external benchmarks where they exist for other dims (research; likely few), (b) the B-dim harvest->ratify path (HUMAN-grounded, not machine). Most of 'getting to 85' is the machinery (done) + the 11 human-ratified dims, not machine-autonomous coverage.
- Opened: 2026-06-18

### CH-047: Solver fixes targets but regresses; regression-gate self-disables on env-mismatch instances
- **Problem:** On SWE-bench-Live the solver FIXES the target bug (targets pass: cfn-lint 26/26 and 1/1, xarray 1/1) but PASS_TO_PASS regressions sink every gradeable instance -> 0/10 resolved. The regression-gate that should catch these self-disables on env-mismatch instances (CH-043), so 4+4+11 regressions slip through uncaught. The solver is CLOSE, not hopeless.
- **Evidence:** climb run dflive10climb (improved solver n=10): 3 fixed-but-regressed (cfn-3798 reg4, cfn-3856 reg4, xarray reg11), 1 partial, 4 no-target, 0 resolved; analyze-swebench-results.mjs breakdown 2026-06-21
- **Opportunity:** Run the regression-gate INSIDE the grader Docker env (where the env matches) so it catches PASS_TO_PASS regressions before finalizing the patch -> could turn 3 fixed-but-regressed into resolved (0/10 -> ~30%)
- Opened: 2026-06-21

### CH-048: Competitor intel harvest returns 0 signals — the ratify/coverage lever has no candidates
- **Problem:** danteforge intel --github-only --save fetched 0 weakness signals across 10 competitors, so loadHarvestedSignals -> ratify lists no candidates -> the 11 ratify-assisted dims (the council's #1 coverage lever) cannot be operationalized. Two causes: no GITHUB_TOKEN (unauth GitHub API rate-limited to ~0) and a parser bug 'i is not iterable' on OpenHands/MetaGPT.
- **Evidence:** /x/tmp/intel-harvest.log 2026-06-21: 'Total signals found: 0'; 'GitHub fetch failed for OpenHands: i is not iterable'; 'check network connectivity or GITHUB_TOKEN'
- **Opportunity:** Fix the parser bug + read GITHUB_TOKEN -> real demand/capability signals -> ratification candidates -> the coverage lever becomes runnable
- Opened: 2026-06-21

### CH-049: Council isAvailable() probes only --version, not auth/quota — dead members burn the full budget
- **Problem:** discoverCouncil marks a member available on '<binary> --version' (5s), confirming install not auth/quota. A logged-out or usage-limited member still dispatches and burns the full 450s+30s budget before failing; if all are in that state the operator waits ~8min for zero perspectives.
- **Evidence:** council-ask consultation 2026-06-21: Grok Build + Claude Code independently flagged isAvailable() at claude-code-adapter.ts:169 / codex-adapter.ts:98
- **Opportunity:** A cheap auth/quota preflight (or treating the first fast failure as unavailable) fails dead members fast instead of after the full budget
- Opened: 2026-06-21

### CH-050: Solver can't act on env-mismatch regressions from test NAMES alone — needs grader failure detail (or solve-in-grader-env)
- **Problem:** CH-047 grade-in-loop validation (cfn-lint-3798): the machinery worked (autonomously caught the 4 authoritative grader regressions) but the solver re-submitted a BYTE-IDENTICAL patch (3674 chars x2). Session resume VERIFIED working (ZEPHYR-4271 recall), so NOT a resume bug — root cause is that on an env-mismatch instance the solver cannot REPRODUCE the regressions locally, so a bare test NAME is undebuggable. Capability ceiling is real but partly an information problem.
- **Evidence:** ch047val1.log: 'attempt 2 (session): patch 3674 chars' identical to attempt 1; post_patch_log.txt has the real assertions ('Expected exit(0) Actual exit(2)'; 'Lists differ E2533 nodejs18.x deprecated') the feedback was NOT passing through
- **Opportunity:** FIRST FIX SHIPPED (8a5bb38): extractFailureDetail + formatRegressionFeedbackWithDetail feed the grader's actual assertion/traceback back, not just names — verified on the real log. OPEN: validate it makes the solver revise; DEEPER fix = SOLVE inside the grader Docker env so the solver can run+reproduce+iterate against the real tests
- Opened: 2026-06-21

### CH-051: [grader-env-mismatch → test-in-grader-image] Generalize gradeOneInstance into runTestsInGraderImage(instance,testIds,pat
- **Problem:** Generalize gradeOneInstance into runTestsInGraderImage(instance,testIds,patch): run the 4 PASS_TO_PASS inside the grader image and route computeRegressions through it INSTEAD of self-disabling on env-mismatch
- **Evidence:** Decomposed from "grader-env-mismatch" (No solver registered for "grader-env-mismatch" — META-SOLVE: build, test, and register one (the missing solver IS the next sub-problem).). Solutions already attempted: none.
- **Opportunity:** HIGHEST leverage (council-unanimous): gives the solver an executable env-matched oracle, upstream of every other fix; turns fly-blind into fly-with-instruments
- Opened: 2026-06-21

### CH-052: [grader-env-mismatch → fresh-attempt-ban-prior-approach] On a byte-identical patch across attempts, fingerprint+ban the 
- **Problem:** On a byte-identical patch across attempts, fingerprint+ban the prior approach and restart from a clean checkout carrying explicit constraints (do NOT rewrite shared ValidationError message strings)
- **Evidence:** Decomposed from "grader-env-mismatch" (No solver registered for "grader-env-mismatch" — META-SOLVE: build, test, and register one (the missing solver IS the next sub-problem).). Solutions already attempted: none.
- **Opportunity:** De-anchors the solver from its first wide-blast-radius approach; second priority once the oracle is real
- Opened: 2026-06-21

### CH-053: [grader-env-mismatch → expected-behavior-feedback] Feed the EXPECTED behavior of the broken tests (valid template exits 
- **Problem:** Feed the EXPECTED behavior of the broken tests (valid template exits 0; clean template trips no E2533), not only the failure assertion
- **Evidence:** Decomposed from "grader-env-mismatch" (No solver registered for "grader-env-mismatch" — META-SOLVE: build, test, and register one (the missing solver IS the next sub-problem).). Solutions already attempted: none.
- **Opportunity:** Expected behavior is encoded in tests the solver cannot run; a cheaper partial, subsumed by test-in-grader-image
- Opened: 2026-06-21

### CH-054: [grader-env-mismatch → solve-budget-after-oracle] The 15-min spawnSync timeout cut attempt 2 short (exit null); give a l
- **Problem:** The 15-min spawnSync timeout cut attempt 2 short (exit null); give a longer/again budget AFTER the oracle is real so a genuine revision is not killed
- **Evidence:** Decomposed from "grader-env-mismatch" (No solver registered for "grader-env-mismatch" — META-SOLVE: build, test, and register one (the missing solver IS the next sub-problem).). Solutions already attempted: none.
- **Opportunity:** Lowest leverage (council): more time on a blind trajectory only extends the stuck path
- Opened: 2026-06-21

## Resolved (27)

- **CH-001: Blind retry - dissent never reached the builder** — solved 2026-06-12: solved: court-feedback.ts + composeBuildGoal (commit feat(court): verdict->builder feedback)
- **CH-002: Bar-goal disconnect** — solved 2026-06-12: solved: the frozen ladder bar is now in every push build goal (same commit)
- **CH-003: Quorum degradation was silent** — solved 2026-06-12: solved: markDegradedQuorumMerges provenance (commit feat(court): quorum-degradation provenance)
- **CH-004: Campaigns burned cycles into the session limit** — solved 2026-06-12: solved: noteBudgetLimit + orchestrator budget-pause (commit feat(budget))
- **CH-005: Fleet suite re-authoring was operator-driven** — solved 2026-06-12: solved v1: danteforge author-outcome (commit feat(author)); callsite autonomy still open as CH-006
- **CH-012: Long-running orchestrator cannot pick up rebuilds (stale-brain)** — solved 2026-06-12: commit: engineUpdated guard - orchestrator exits 'engine-updated' when dist is rebuilt mid-run; v3 prompt instructs relaunch (state durable)
- **CH-014: Per-dim BUILD PLAN: decompose the 9-row into court-economical checklist items (court lever 2)** — solved 2026-06-12: commit feat(plan): frontier-plan.ts engine - audited decomposition (different-member, fails closed), deterministic item gates, court-on-plan-complete, barHash invalidation, orchestrator plan-progress accounting; autoresearch-as-item-executor noted as follow-up (merge-back plumbing lives in harden-crusade)
- **CH-016: Stale project-intent.json mis-identifies the project to the researcher** — solved 2026-06-12: Manifest cross-check shipped (c573b84): resolveProjectBrief reads the repo manifest FIRST; a contradicting intent artifact loses with a loud warn naming the stale file; 3 pins incl. the live Quill regression. Stale artifact removed (backup X:/tmp/quill-stale-intent-backup.json).
- **CH-017: Judges share the builders' write lease in the campaign tree** — solved 2026-06-13: fix(autonomy): makeJudgeLease (empty allowedWritePaths) for judges + plan consults — defense-in-depth atop the 89a4607 read-only adapters. Pin in ascend-frontier-ledger.test.ts
- **CH-018: Ceiling receipts outlive the generator they measured** — solved 2026-06-13: fix(autonomy): ceiling receipts carry engineSha (last commit touching the build+court engine, NOT HEAD); shouldReopenForEngine re-opens generator/build-failed/court-rejected ceilings when the engine changed, world/spec ceilings held; wired into defaultBuildState. Pins in ceiling-receipt.test.ts
- **CH-019: Provider outage mints ceilings instead of pausing the campaign** — solved 2026-06-13: fix(autonomy): provider-outage detector (provider-outage.ts) broadens budget-pause to codex 'try again at' + untimed auth/quota signatures; runner raises a per-cycle outage marker; orchestrator records NOTHING durable on an outage cycle (no attempt/build-failed/generator-ceiling) and pauses; all-abstained courts (every judge UNCLEAR) are courtRan=false + never recorded as court-feedback; defaultRunJudge surfaces errorReason so the signature reaches the court JSON. Pins in ascend-frontier-ledger.test.ts
- **CH-020: Provider-outage detection is signature-based — a novel phrasing slips through** — solved 2026-06-13: fix(autonomy): structural all-judges-unavailable outage signal — FrontierJudgeRecord.unavailable (set when the adapter throws/fails/returns the 'judge unavailable' marker or empty); parseCourtOutput.allUnavailable (every judge unavailable, wording-agnostic); noteStructuralOutage raises the CH-019 pause+marker even with NO provider string matched. Pins in frontier-review-court.test.ts + ascend-frontier-ledger.test.ts
- **CH-021: depth_doctrine: wave ledger lands, but only 1 loop wired + no replay/interrupt (rung-8→9)** — solved 2026-06-13: ≥3-loop clause LANDED (commits d684d81 harden-crusade, f43bb90 autoforge, 8bde9b2 ascend): all three independent loops now drive the shared WaveLedger and emit byte-identical receipts, each PROVEN by a real emission pin (receipt, not hypothesis). File splits unblocked it: autoforge-loop-core.ts (enum+types+result writer, dissolved the value cycle) + ascend-engine-cycle.ts (cycle helpers). Score NOT raised. Remaining rung-9 (replay + interrupt-before-score-write) → CH-022.
- **CH-023: Court has zero judge-only redundancy (single grok)** — solved 2026-06-15: Commit (gemini-cli wired as 2nd judge-only member; live council --ask seats 4 — codex+claude build, grok+gemini judge). Court now survives one judge being down.
- **CH-024: Pillar-2 pre-commit enforcement is not installed (only the LOC gate is)** — solved 2026-06-15: Commit a5b73aa: install-git-hooks.ts now chains hooks/pre-commit.mjs (idempotent guards block; upgrades a loc-only hook). Re-installed live + DoD proven: matrix.json blocked without merge-receipt; //TODO in src blocked; normal change passes. Safe activation: Phase A warns-when-absent, tsc opt-out via DANTEFORGE_SKIP_PRECOMMIT_TSC. install-git-hooks.test.ts pins the upgrade path.
- **CH-025: Outcome-evidence store is unauthenticated (forgeable receipts), bounded at 8.0 by the frontier gate** — solved 2026-06-16: Signing infra + read-path enforcement complete: outcome-evidence-signer.ts (signOutcomeEvidence/verify), outcome-runner.ts:674 rejects TAMPERED receipts always + unsigned behind DANTEFORGE_REQUIRE_SIGNED_EVIDENCE (line 666), scripts/sign-outcome-evidence.mjs signs the corpus. Buildable part DONE; flipping enforcement on is operator-gated (sign corpus first), same discipline as the grounding gate.
- **CH-026: session-record writes matrix.json via raw fs.writeFile, bypassing saveMatrix backstops** — solved 2026-06-16: 48c1d8d: session-record routes the real write through saveMatrix (score-interrupt/clamp/provenance/lock backstops apply); try-catch surfaces a refused save as a failed outcome; tests/session-record-gates.test.ts pins the bypass closed. tier:'T7' is an intentional classification label (9.0 derives from classifyOutcomeKind, not the tier field), not a score bypass.
- **CH-027: Unattended loop never applies a FAILED human audit (no autonomous self-correction)** — solved 2026-06-16: Implementation complete + unit-tested: audit-escrow.loadAuditQueue + ascend-frontier.ts:102-149 (builds failedAuditDims, calls reconcileAuditVerdict, writeCeilingReceipt) + frontier-audit.ts downgrade validated->frozen on --fail; ascend-frontier-engine.test.ts:94-125 (4 pins) prove reconcileAuditVerdict. The loop DOES apply a FAILED audit in production (the wiring is in runAscendFrontier, only the injected-_buildState tests bypass it). FOLLOW-UP (test-coverage hardening, not a functional gap): an end-to-end integration pin in ascend-frontier-loop.test.ts asserting a failed-audit dim gets 0 pushes + an audit-failed ceiling, and a confirmed audit re-opens it.
- **CH-029: Solver-fidelity: the grounding receipt measures raw 'claude -p', not DanteForge's pipeline** — solved 2026-06-16: 0510458: pipeline-solver.ts — DanteForge's iterate-to-green loop as the --solver-mode pipeline (generate→check visible doctests→feed-back→regenerate); proven 5/5 end-to-end with the live model. The runner now measures DanteForge's orchestration, not raw claude -p. Full-scale pipeline-mode receipt is the receipt-minting step (Stage 5/6).
- **CH-030: Harvested signals must be kernel-signed (CH-025 pattern) so verified_live/ratified_by can't be self-set** — solved 2026-06-16: 9094089: harvested-signal-signer.ts (signHarvestedSignal/verify, kernel-secret HMAC, CH-025 pattern) + checkHarvestProvenance requireSigned gate (DANTEFORGE_REQUIRE_SIGNED_EVIDENCE lockstep). verified_live/ratified_by now forgery-resistant: a false→true flip invalidates the signature. 166 integrity pins.
- **CH-031: Already-built harvesters are dead-ended: intel + dossier scores never reach the frontier bar** — solved 2026-06-16: RESOLVED (c506e32/693af58 + this finding): the harvest->bar bridge (harvest-to-signals.ts) + live wiring (harvest-loader -> frontier-spec init) are shipped. KEY FINDING: the dossier path is a RED HERRING — dossiers score code-tool competitors on the DIMENSIONS_28 code-editing rubric (ghost_text_fim/chat_ux/agentic_edit), a DIFFERENT domain from DanteForge's matrix dims (functionality/autonomy/depth_doctrine); no honest deterministic map exists, so auto-wiring them would fabricate a mapping (correctly NOT done). The clean harvest sources for the matrix bar are intel (demand, keys by matrix dim id, wired) + benchmark leaderboards (objective anchor, loader source added). Real intel/leaderboard harvest RUN remains operator/loop-triggered.
- **CH-032: Grounding ratio counts DECLARED external-benchmark outcomes, not PASSING ones with a receipt** — solved 2026-06-16: external-grounding.ts isExternallyGrounded now requires a PASSING external-benchmark receipt (isOutcomePassing over loaded OutcomeEvidence at HEAD), not mere declaration; externalGroundingReport takes the evidence snapshot; grounding-cmd loads it via loadOutcomeEvidence. Proven: adding a declared-but-unrun external-benchmark dim no longer flips the ratio (back to 0% until a real receipt passes). Pins: declared-no-receipt=0%, failing-receipt=0%, passing-receipt=grounded.
- **CH-033: A real SWE-bench grounding needs real dataset + repo/test infra (Linux/docker) — the swe-bench-runner package is TOY** — solved 2026-06-16: Real SWE-bench infra BUILT + PROVEN (gold 1/1 via the Linux orchestrator, CH-034). swe-bench-real.ts (real dataset, no-answer-leak) + run-swebench-grounding.mjs (fetch real instances -> agentic solver edits files [validated: claude -p edits + git diff] -> official Linux-orchestrated docker grader). The toy @dantecode package is never used. Remaining is NOT infra — it's the solver CAPABILITY CLIMB (does DanteForge resolve real issues; honest start near 0), which is the frontier itself, not a challenge to close.
- **CH-034: SWE-bench grader needs a LINUX ORCHESTRATOR — a Windows host CRLF-corrupts the eval scripts (deeper than resource)** — solved 2026-06-16: BUILT + GOLD-VALIDATED 1/1. scripts/swebench-orch/{Dockerfile,grade.sh}: a Linux orchestrator (python:3.11-slim + swebench 4.1.0) runs the official harness IN LINUX (LF-native files fix CRLF, native resource, host-daemon via socket passthrough). Gold for astropy__astropy-12907 resolved 1/1 (✓=1 ✖=0 error=0) — the CRLF blocker is fully solved and the real grader works end-to-end on this Windows box. run-swebench-grounding.mjs grades via this orchestrator.
- **CH-036: Contamination-resistant capability number: run SWE-bench-Live RECENT (post-cutoff) instances through the grader** — solved 2026-06-17: Live grader works end-to-end (commit 0195bd4): root cause was an unpopulated git submodule (RepoLaunch), fixed via --recurse-submodules + python:3.12. swe-bench-live registered as an external suite + runner wire proven (827ea02). First contamination-resistant number: resolved 0/5 on novel issues.
- **CH-040: Solver does not iterate across feedback calls (no persistent session)** — solved 2026-06-17: Persistent session VALIDATED (6d55864 + 808a31f + 69853c1): v3 attempt 2 (--resume) produced a 20231-char patch vs attempt 1's 3674 — the solver finally REVISED on feedback (fresh calls gave byte-identical patches). Pluggable --solve-command seam shipped (0effa74). CH-041 (noisy regression signal) is now the binding climb constraint.
- **CH-041: Regression-gate over-counts: full suite flags tests the correct fix legitimately changes** — solved 2026-06-17: Gate now intersects newly-failing with the dataset PASS_TO_PASS (the grader's must-stay-green set) so it matches the grader (4 not 26). Fixed parseDatasetRows to accept PASS_TO_PASS as an array. VERIFIED on live cfn-lint: 1220 must-stay-green parsed, 4/4 known regressions format-match. Safety fallback to conservative full-set on id mismatch.
