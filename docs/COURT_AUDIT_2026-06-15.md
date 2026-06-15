# Autonomous 9.0 Court — Adversarial Audit (2026-06-15)

Source: a 55-agent adversarial Workflow (run `wf_7f28539d-cfa`). 7 finders × 2 diverse skeptics per
finding (one writes a concrete exploit, one checks whether other guards catch it). 23 candidates → **14
confirmed** (survived a working exploit) → 9 refuted. Synthesis re-verified the top 2 against live source.

## Verdict
**The court is NOT yet independent enough to trust for an unattended autonomous 9.0.** The string
`frontier_spec.status==='validated'` is the entire 8.0→9.0 certificate, and there are multiple ways to set
or honor it without a genuine court convening. Below it sits an **unauthenticated, hard-gate-unprotected
evidence store** (`.danteforge/outcome-evidence/`). Two fixes collapse most of the surface: **#1
court-receipt-bound `validated`** and **#3 authenticated evidence**. Until both land, do not run unattended.

**What is genuinely solid (do not regress):** the sequential push correctly excludes the full builder
roster (`--exclude-builders`, e58c664); kernel-owned score writes + the read-only judge lease for
codex/claude; the deterministic receipt-mechanics gate; the frontier gate's 8.0-cap-until-validated intent.

## Ranked worklist (status tracked here as fixes land)

| # | Sev | Hole | Files | Status |
|---|-----|------|-------|--------|
| 1 | CRIT | `applyFrontierGate` honors a bare `status:'validated'` string — no court receipt; a hashless validated spec never goes stale | frontier-spec.ts:289-295,254-260,244-247; compete-matrix.ts:338-341 | OPEN |
| 2 | CRIT | pre-commit doesn't protect `outcome-evidence/**` AND the hook isn't installed (only LOC gate is) | hooks/pre-commit.mjs:26-35; install-git-hooks.ts; init.ts:258-265 | OPEN |
| 3 | CRIT | `loadOutcomeEvidence` trusts receipt fields verbatim — no authenticity check (HMAC) | outcome-runner.ts:594-662; outcome.ts:526-562 | OPEN |
| 4 | CRIT | parallel push excludes the round-robin member, not the real (keyword-routed) builder → builder self-judges | ascend-frontier-push.ts:445; ascend-frontier-parallel.ts:45-69; council-scheduler.ts:87-90 | OPEN |
| 5 | HIGH | `frontier-review` applies NO default builder exclusion — direct call seats builders as judges | frontier-review.ts:137-148; register-outcomes-cmds.ts:297-325 | OPEN |
| 6 | HIGH | `--min-judges 1` collapses quorum to one PASS + one abstention | register-outcomes-cmds.ts:314; frontier-review-court.ts:169-170 | OPEN |
| 7 | HIGH | last-`VERDICT`-wins parser fails OPEN (trailing PASS after a real FAIL → PASS) | council-verdict-parser.ts:25-34 | OPEN |
| 8 | HIGH | builder-controlled artifact excerpt injected verbatim into judge prompt → planted/echoed `VERDICT:` lines | frontier-review-court.ts:86,91,157-158 | OPEN |
| 9 | HIGH | `loadOutcomeEvidence` accepts evidence from a stale/foreign git SHA | outcome-runner.ts:651-661; capability-test.ts:93,102-112 | OPEN |
| 10 | HIGH | `saveMatrix` provenance guards `scores.self` but never `frontier_spec.status` | compete-matrix.ts:459-475; write-verified-score.ts:160-207 | OPEN |
| 11 | HIGH | grok & gemini judges ignore subprocess exit code — a killed judge's partial stdout trusted as a verdict | grok-build-adapter.ts:261-297; gemini-cli-adapter.ts:271-303 | OPEN |
| 12 | MED | `session-record` writes matrix.json via raw `fs.writeFile`, bypassing saveMatrix + acceptance gate; hardcodes `tier:'T7'` | session-record.ts:80,128,141-142 | OPEN |
| 13 | MED | gemini judge has no read-only enforcement; post-run diff is blind to `.danteforge/` | gemini-cli-adapter.ts:238-240,285,398-411 | OPEN |

## Sequencing (per the audit synthesis)
1. **#1 + #3** — the two structural blockers (court-receipt-bound `validated` + authenticated evidence).
2. **#7 + #8** — parser fail-closed + artifact token neutralization.
3. **#11 + #13** — judge-process integrity (exit-code + read-only).
4. **#4, #5, #6** — cheap builder-exclusion / quorum arg-discipline.

(Implementation note: closing the cheap arg-discipline + parser + adapter holes first — they are fast,
independent, and each closes a real self-PASS path — then the two structural blockers.)
