# DanteForge — The Mental Model

Read this before anything else. The system has 100+ commands, tiers, courts, ledgers, and
receipts, and that surface area looks intimidating. The core idea fits in three sentences,
and everything else in the repo is enforcement of it.

## 1. The One Idea

A score is a claim. Claims require receipts. Receipts come only from real runs.

Every other mechanism — tiers, ceilings, courts, hash-locked specs, pre-commit hooks — exists
to stop a score from existing without a receipt behind it. The function that replaces "an
agent writes a score" as the source of truth is `computeDerivedScore` in
`src/core/derived-score.ts`: it reads declared outcomes plus on-disk evidence and computes
what the dimension currently merits. Nothing and nobody else gets to say the number.

## 2. The Five Surfaces You Actually Touch

1. **matrix.json** (`.danteforge/compete/matrix.json`) — the scoreboard. Kernel-owned: never
   hand-edit it. The pre-commit hook (`hooks/pre-commit.mjs`) rejects any commit touching it
   unless a kernel merge receipt is set, and the save path (`reconcileScoreCaps` in
   `src/core/compete-matrix.ts`) clamps any persisted score above its caps — the clamp can
   only lower or hold values, never raise them.
2. **Outcomes** — declared evidence, stored per dimension inside matrix.json. Each outcome
   says "this command, at this tier, exercises this production callsite" (`command`, `tier`,
   `required_callsite` in `src/matrix/types/outcome.ts`). An outcome is a promise, not proof.
3. **Receipts** (`.danteforge/outcome-evidence/`) — what actually ran. `danteforge validate`
   executes outcomes and writes evidence entries stamped with exit code, duration, and a
   per-process session id (`src/matrix/engines/outcome-runner.ts`). Stale receipts decay:
   evidence older than the tier's freshness window counts as not-passing
   (`src/core/derived-score.ts`).
4. **Ceilings** (`.danteforge/ceilings/<dim>.json`) — honest "not yet, because X" receipts
   (`src/core/ceiling-receipt.ts`). When a dimension cannot honestly reach 9.0, the loop
   signs a ceiling naming the cause (market-cap, environment, court-rejected,
   spec-incomplete, …) and what external action would lift it. An unreachable dim gets a
   signed ceiling, never a faked green.
5. **The courts** — independent judges, the only door past 8.0. `applyFrontierGate` in
   `src/core/frontier-spec.ts` caps every score at 8.0 unless the dim's frontier spec is
   court-`validated`, and only the frontier-review-court
   (`src/matrix/courts/frontier-review-court.ts`) — an anonymous K-of-M council that did NOT
   build the evidence — can set that status (the write happens in
   `src/cli/commands/frontier-review.ts`, only on a VALIDATED verdict). The builder cannot
   self-certify a 9.0.

## 3. The Score Ladder

Score is derived from the highest tier whose declared outcomes ALL pass
(`src/core/derived-score.ts`, contracts in `docs/CAPABILITY-TIERS.md`):

| Score | What it proves | What it takes |
|---|---|---|
| 5.0 (T2) | Code exists, behavioral tests pass | A test that asserts real behavior exits 0 |
| 7.0 (T4) | Wired: a user-facing entry point reaches it | Production callsite + snapshot of user-visible output |
| 8.0 (T5) | A real product run works | `node dist/index.js <cmd>` on realistic input — never a test runner |
| 8.5 (T6) | Production users exercised it | Contract: real telemetry from distinct users (`docs/CAPABILITY-TIERS.md` — the telemetry outcome kind is not yet implemented; in code only a `cli-smoke` outcome reaches 8.5) |
| 9.0 (T7) | Court-validated frontier parity | 3+ T5+ receipts, ≥2 distinct sessions, frozen spec, court verdict VALIDATED |
| 9.5 (T8) | Live verification | Registered external benchmark + ≤24h-fresh evidence |
| 5.0 cap | Market dims | `community_adoption`, `enterprise_readiness`, `token_economy` are permanently capped — code cannot prove adoption (`src/core/market-dims.ts`) |

10.0 is human-curated; no tier unlocks it.

## 4. The One Command

```
danteforge ascend-frontier            # the whole campaign, no prompts
danteforge ascend-frontier --rehearse # preflight: full coordination layer on a scripted scratch repo, minutes, zero LLM cost
danteforge ascend-frontier --dry-run  # print the next action without executing
```

Phases (`src/cli/commands/ascend-frontier.ts`, help text in `src/cli/register-outcomes-cmds.ts`):

- **A — Define**: bootstrap a missing matrix on a cold repo, scaffold evidence, migrate
  outcomes, init frontier specs (each spec is frozen later, per dim, in Phase C).
- **B — Build-to-7**: harden-crusade loop writes real modules, wires callsites, runs outcomes until dims earn 7.0.
- **C — Push-to-9**: per dim, weakest first — freeze spec → build → `session-record` real product run → `validate` twice (two sessions) → frontier-review-court → 9.0 if VALIDATED, else a signed ceiling or a retry with novel evidence.

"Complete" means every dimension is at a court-validated 9.0 **or** carries an honest
ceiling. The loop never prompts and never spins: a dim that cannot be built earns a ceiling
so the run always terminates.

## 5. What the System Will Refuse

- **Hand-edited scores die at the save boundary.** Any persisted score above its market cap
  or declared ceiling is clamped on every save — `scores.self` clamps route through the
  audited `writeVerifiedScore` gate, `scores.derived` is clamped in place
  (`reconcileScoreCaps`, `src/core/compete-matrix.ts`); committing matrix.json without a
  kernel receipt is blocked outright (`hooks/pre-commit.mjs`).
- **Test runners cap at 7.0 no matter what you call them.** `cargo test`, `pytest`,
  `npx tsx --test`, etc. are demoted to T4 regardless of declared kind — tests prove
  isolation, not production behavior (`classifyOutcomeKind`,
  `src/matrix/engines/outcome-quality.ts`). Structural file checks
  (`readFileSync`/`existsSync` one-liners) get the same cap.
- **A single validate session cannot reach 9.0.** T7 requires receipts spanning ≥2 distinct
  session ids, 3+ passing T5+ outcomes, and ≥2 distinct test files — each is a structural
  veto, not a warning (`src/core/derived-score.ts`).
- **Frozen specs are hash-locked.** A frontier spec is sha256-hashed at freeze; any later
  edit makes it `stale` and the score drops back to 8.0 (`effectiveStatus` +
  `applyFrontierGate`, `src/core/frontier-spec.ts`). You cannot move the goalposts after
  the fact.
- **Softened frontier bars are rejected.** `checkFrontierSpec` requires the 9.0 target to
  stay grounded in the competitor-researched Score Ladder row — an agent cannot rewrite the
  bar into an exam it can pass (`src/core/frontier-spec.ts`).
- **Instant evidence runs prove nothing.** A real-user-path run must exit 0, last ≥1000ms
  (`REAL_RUN_MIN_MS`, defined in `src/core/frontier-spec.ts`), and produce an observable
  artifact, or it is refused (the four guards in `src/cli/commands/session-record.ts`).
- **Courts fail honestly.** Judges are instructed to default to FAIL when uncertain
  (`src/matrix/courts/frontier-review-court.ts`). A rejection where a majority of judges
  signal an honest ceiling becomes a durable `court-rejected` ceiling receipt (written by
  `src/cli/commands/frontier-review.ts`, shape in `src/core/ceiling-receipt.ts`); other
  rejections are retried with novel evidence, bounded by `--max-attempts` (default 3).
- **Evidence kinds are demoted, never trusted.** An outcome declared above what its command
  can prove is re-bucketed to the tier its evidence actually supports, and the demotion is
  surfaced so you see why (`src/core/derived-score.ts`).

## The Point

DanteForge will report **lower** numbers than self-graded tools — that is the feature, not a
bug. Every clamp above can only lower or hold a score; nothing in the pipeline can raise one
without a fresh receipt from a real run plus, past 8.0, an independent court verdict. When
this system says 7.0, it means "wired and proven", not "felt about right". Run
`danteforge gap <dim>` to see exactly what receipt unlocks the next rung, and
`danteforge gap --all` for the same breakdown across every dimension.
