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
| 1 | CRIT | `applyFrontierGate` honors a bare `status:'validated'` string — no court receipt; a hashless validated spec never goes stale | frontier-spec.ts | ✅ FIXED ef9566c — `validated_by` receipt (dim+content+secret bound), gate verifies |
| 2 | CRIT | pre-commit doesn't protect `outcome-evidence/**` AND the hook isn't installed (only LOC gate is) | hooks/pre-commit.mjs; install-git-hooks.ts | ⚠ PARTIAL — outcome-evidence added to guard; hook-not-installed = CH-024 (activating it needs loop validation: Phase-A runtime-evidence + per-commit tsc) |
| 3 | CRIT | `loadOutcomeEvidence` trusts receipt fields verbatim — no authenticity check (HMAC) | outcome-runner.ts:594-662 | 🟡 CH-025 — but #1 reduces impact: forged evidence now caps at 8.0 (frontier gate), no longer a fake-9.0 path. Signing seam exists (kernelSecret) |
| 4 | CRIT | parallel push excludes the round-robin member, not the real (keyword-routed) builder → builder self-judges | ascend-frontier-push.ts:445 | ✅ FIXED cc7f87e — promote excludes ALL build-eligible members |
| 5 | HIGH | `frontier-review` applies NO default builder exclusion — direct call seats builders as judges | frontier-review.ts | ✅ FIXED cc7f87e — flag-less call default-excludes all builders |
| 6 | HIGH | `--min-judges 1` collapses quorum to one PASS + one abstention | frontier-review-court.ts | ✅ FIXED cc7f87e — court floors minJudges at 2; CLI clamps |
| 7 | HIGH | last-`VERDICT`-wins parser fails OPEN (trailing PASS after a real FAIL → PASS) | council-verdict-parser.ts | ✅ FIXED cc7f87e — FAIL dominates (fail-closed) |
| 8 | HIGH | builder-controlled artifact excerpt injected verbatim into judge prompt → planted/echoed `VERDICT:` lines | frontier-review-court.ts | ✅ FIXED cc7f87e — fenced + token-defanged + untrusted-labeled; CEILING anchored |
| 9 | HIGH | `loadOutcomeEvidence` accepts evidence from a stale/foreign git SHA | outcome-runner.ts:651-661 | 🟡 CH-025 (with #3) — impact bounded at 8.0 by #1 |
| 10 | HIGH | `saveMatrix` provenance guards `scores.self` but never `frontier_spec.status` | write-verified-score.ts; compete-matrix.ts | ✅ FIXED 951b75e — stripUnverifiedValidations at save boundary |
| 11 | HIGH | grok & gemini judges ignore subprocess exit code — a killed judge's partial stdout trusted as a verdict | grok/gemini adapters | ✅ FIXED e2e5c69 — non-zero judge exit ⇒ failed, output discarded |
| 12 | MED | `session-record` writes matrix.json via raw `fs.writeFile`, bypassing saveMatrix + acceptance gate; hardcodes `tier:'T7'` | session-record.ts | 🟡 CH-026 — impact bounded at 8.0 by #1 |
| 13 | MED | gemini judge has no read-only enforcement; post-run diff is blind to `.danteforge/` | gemini-cli-adapter.ts | ✅ FIXED e2e5c69 — judgeWriteDiff keeps `.danteforge/` visible; both judges |

## Status: 9 of 14 fixed in code (commits cc7f87e, e2e5c69, ef9566c, 951b75e). The fake-9.0 paths are
closed: a builder can no longer self-judge (#4/#5/#6), the parser/prompt can't be gamed (#7/#8), judges
fail-closed (#11/#13), and `validated` is a verifiable court receipt on both read and write (#1/#10).
Remaining (CH-024/025/026): evidence-store authentication + hook activation — with #1 landed these now
cap forged evidence at 8.0 (the frontier gate) rather than minting a fake 9.0, so they are hardening, not
open 9.0 forgeries. Until they land, treat an unattended autonomous run's >8.0 claims as court-gated only.

## Round 2 (run wf_4a94fc41-88a, 57 agents) — verify the fixes + the surfaces round 1 never reached

Round 1 hardened the front door (`frontier-review`); round 2 verified the fixes hold under direct attack
AND audited the side doors. 24 candidates → 9 confirmed → 15 refuted. The round-1 fixes HELD under attack
(the HMAC receipt, FAIL-dominant parser, orchestrated builder-exclusion are real) — the holes were paths
*around* them. 6 of 9 fixed (commit b9bf71c); 2 filed; 1 was a pre-existing-secret caveat.

| R2 | Sev | Hole | Status |
|----|-----|------|--------|
| 1 | CRIT | legacy `matrix merge`/`ascend` certified >8.0 with NO frontier gate (parallel un-gated 9.0; self-propose+self-merge) | ✅ FIXED b9bf71c — mergeScoreProposals clamps via applyFrontierGate |
| 2 | HIGH | `overallSelfScore` headline never recomputed/guarded — direct `=9.9` surfaced uncontested | ✅ FIXED b9bf71c — loadMatrix recomputes from gated dims |
| 3 | HIGH | `--exclude-builders <a-judge>` re-seated builders as judges of their own dim | ✅ FIXED b9bf71c — exclusion is now a FLOOR (all build-eligible always excluded) |
| 4 | HIGH | builder-authored leader_target fields injected RAW into the trusted judge header (#8 covered only the artifact) | ✅ FIXED b9bf71c — all defanged |
| 5 | MED | unverified-self>8 badge trusted the bare status string | ✅ FIXED b9bf71c — uses verifyValidation |
| 6 | LOW | round-1 read-gate pin left RED (`verify` red) | ✅ FIXED b9bf71c — signed-receipt + negative pin |
| 7 | HIGH | unattended loop never applies a FAILED human audit (no autonomous self-correction); validated = done forever | 🟡 CH-027 — needs downgrade+ceiling design (avoid validate→downgrade loop) |
| 8 | LOW | receipt does not bind judge-independence (de-elevated by R2#3 fix) | 🟡 CH-028 — snapshot non-builder attestation into the signed receipt |
| — | — | kernel-secret file created 0600 but a pre-existing file may be 0644; same-user readable on a single machine | known single-machine caveat (CH-025 territory) — the sig raises forgery cost, not absolute |

**Round-2 verdict:** the fake-9.0 SCORE paths are now closed on every surface the audit could reach —
the legacy engine, the headline number, and the manual-flag exclusion bypass are all gated; the judge
prompt is fully defanged. The one remaining HIGH (CH-027) is RECOVERY (auto-applying a human's later
"that was fixture" verdict), not a fresh self-certification path — it requires a human to have failed an
audit first. An unattended loop no longer MINTS a fake 9.0; it does not yet auto-retract one a human
later flags. Net: court-gated >8.0 claims are trustworthy; wire CH-027 before treating unattended human
spot-audits as self-healing.

## Sequencing (per the audit synthesis)
1. **#1 + #3** — the two structural blockers (court-receipt-bound `validated` + authenticated evidence).
2. **#7 + #8** — parser fail-closed + artifact token neutralization.
3. **#11 + #13** — judge-process integrity (exit-code + read-only).
4. **#4, #5, #6** — cheap builder-exclusion / quorum arg-discipline.

(Implementation note: closing the cheap arg-discipline + parser + adapter holes first — they are fast,
independent, and each closes a real self-PASS path — then the two structural blockers.)
