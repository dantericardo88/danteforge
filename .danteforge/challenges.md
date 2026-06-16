# Challenge Ledger — gaps we have named and therefore own

> Doctrine: always look for the gaps, problems, and holes in whatever we are building.
> The minute a problem is DEFINED — observably, with evidence — it becomes solvable.
> Entries are never silently deleted: a challenge is open, solved (with the commit), or
> retired (with the reason). An empty OPEN section is a smell, not an achievement.

## Open (10)

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

## Resolved (22)

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
