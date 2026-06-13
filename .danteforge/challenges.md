# Challenge Ledger — gaps we have named and therefore own

> Doctrine: always look for the gaps, problems, and holes in whatever we are building.
> The minute a problem is DEFINED — observably, with evidence — it becomes solvable.
> Entries are never silently deleted: a challenge is open, solved (with the commit), or
> retired (with the reason). An empty OPEN section is a smell, not an achievement.

## Open (8)

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

## Resolved (12)

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
