# Truth Gate Extraction

> Provenance: the originally scheduled draft of this document was never written (no
> `docs/TRUTH_GATE_EXTRACTION.md` existed in the working tree, any worktree, or git history at
> fact-check time, 2026-06-11). This version was authored directly by the adversarial fact-check
> pass. Every constant, signature, path, and behavior below was read from the cited source file
> before being written down. Nothing here is quoted from memory or from other docs.

This document extracts DanteForge's "truth gate" — the set of structural mechanisms that prevent
an agent (or a human) from writing a competitive score that the evidence does not support. It is
written so the machinery can be understood, audited, or ported without reading the whole codebase.

The core invariant, stated in `src/matrix/engines/receipt-ceiling.ts`: *code without a receipt is
a hypothesis, not a feature.* Everything below is an enforcement point for that sentence.

---

## 1. The tier ladder and its score caps

Source: `src/matrix/types/capability-test.ts`.

`CapabilityTier` is the union `'T0' | 'T1' | ... | 'T8'`. Each tier has a hard score cap,
`TIER_SCORE_CAPS`:

| Tier | Cap | Freshness window (`TIER_FRESHNESS_MS`) |
|---|---|---|
| T0 | 1.0 | indefinite (`Number.POSITIVE_INFINITY`) |
| T1 | 4.0 | 90 days |
| T2 | 5.0 | 60 days |
| T3 | 6.0 | 30 days |
| T4 | 7.0 | 14 days |
| T5 | 8.0 | 7 days |
| T6 | 8.5 | 24 hours |
| T7 | 9.0 | 7 days |
| T8 | 9.5 | 24 hours |

`isEvidenceStale(tier, ranAtISO, now?)` returns true when evidence is older than its tier's
window; stale evidence is treated as not-passing at scoring time (`derived-score.ts` increments
a `stale` counter and skips the entry). Malformed timestamps are deliberately *not* treated as
stale (`capability-test.ts`, `isEvidenceStale`).

`CAPABILITY_TEST_SCORE_CAP = 5.0` (same file): the max score for a dimension without a passing
`capability_test`. Legacy single-command `capability_test` entries normalize to a single T2 probe
via `normalizeToLadder(entry)`, keeping their 5.0 ceiling; a `NoCapabilityTestMarker`
(`no_capability_test: true` + `reason`) normalizes to `null` and stays capped at 5.0.

## 2. Evidence-kind classification — what a piece of evidence can ever earn

Source: `src/matrix/engines/outcome-quality.ts`, `classifyOutcomeKind(outcome)`, returning
`{ maxScore, evidenceTier, reason }`. The classifier inspects the **command text**, never the
agent-declared `kind`, for the capping branches — relabeling an outcome cannot lift its cap.
Caps in evaluation order:

1. **9.5** — `kind === 'external-benchmark'` AND the suite is in the registry (either via
   `input_source.type === 'external-benchmark'` with a registered `suite`, or the legacy
   `benchmark` field). The registry (`src/matrix/engines/external-suite-registry.ts`,
   `REGISTERED_EXTERNAL_SUITES`) is exactly: `swe-bench`, `swe-bench-lite`, `swe-bench-verified`,
   `exercism`, `humaneval`, `mbpp`. A regex match on command text never earns 9.5 — the registry
   replaced an old regex an agent satisfied with `node -e "console.log('benchmark --suite pass')"`.
2. **7.0** — structural file checks. `isStructuralFileCheck(cmd)`: command matches
   `readFileSync|readFile\b|existsSync|statSync` and does NOT match the real-execution pattern
   (spawn/execFile/exec/child_process/npm|npx test|build|start/`tsx --test`/`node dist/`).
   Capped at T4/7.0 regardless of declared kind.
3. **7.0** — test-runner commands. `isTestSuiteCommand(cmd)` recognizes JS/TS runners
   (`npx tsx --test`, `node --test`, `npm test`/`npm run test`, jest, vitest, mocha) plus the
   polyglot set: `cargo test`/`cargo nextest`, `go test`, `pytest`/`py.test`/`python -m
   pytest|unittest`, `dotnet test`, `gradle test`, `mvn test`, `rspec`, `phpunit`. A test suite
   proves isolation, not production behavior; it caps at T4/7.0 under any declared kind.
4. **7.0** — `input_source.type === 'synthetic-fixture'` (declared agent-authored evidence).
5. **9.0** — `kind === 'runtime-exec'` or `'e2e-workflow'` WITH
   `input_source.type === 'real-user-path'`.
6. **8.0** — runtime-exec / e2e-workflow WITHOUT a declared real-user-path provenance.
7. **8.5** — `kind === 'cli-smoke'` (real CLI invocation, pattern-checked output).
8. **8.0** — default for any other shell command (assumed runtime execution).

The same file also exports `validateOutcomeQuality(outcome, evidence)`, which rejects (returns
errors for): T5+ outcomes with `timeout_ms < 5000`; T5+ evidence with empty stdout; T3+ shell
commands that are trivial (length < 10 or starting `echo`/`true`/`exit`); T5+ receipts faster
than the outcome's declared `min_duration_ms`; and T5+ structural file checks regardless of
declared kind.

`highestTierWithinCap(maxScore)` maps a quality cap to the highest tier whose score cap fits
under it (e.g. a test-runner's 7.0 → T4), and `effectiveEvidenceTier(outcome)` /
`stampEvidenceTier(entry, outcome)` stamp receipts at that effective tier so scoring-time and
load-time freshness decay the same receipt on the same window.

## 3. The derived score — the function that replaces "agent writes a score"

Source: `src/core/derived-score.ts`. Exports `computeDerivedScore(dim, evidence, now?)` and
`computeDerivedScoreWithBreakdown(dim, evidence, now?)` (returns a `DerivedScoreBreakdown` with
`score`, `highestFullPassedTier`, `perTier`, `usedLegacyFallback`, `demotions`).

Algorithm (per the file's own doc comment, verified against the implementation):

1. No outcomes declared → legacy fallback: returns `legacy_score ?? scores.self ?? 0`, clamped by
   the market cap for market dims (this clamp on the legacy path is the fix for the
   `token_economy` 7.0-despite-5.0-cap leak; see §5).
2. **Demote, never annihilate**: an outcome declared above what `classifyOutcomeKind` supports is
   re-bucketed to `highestTierWithinCap(maxScore)` instead of being excluded (the fix for the
   fleet-wide "derived-stuck-0" bug, where a dim with 4/4 passing over-declared receipts read
   0.0). An outcome with an *invalid or missing* tier IS excluded outright, never demoted —
   demotion would otherwise promote an undeclared tier to T5/8.0.
3. Walk tiers T0→T8; a tier is claimed when ALL its outcomes pass (fresh, per
   `isEvidenceStale`); the first non-fully-passing tier earns partial credit:
   `score = cap(claimed) + (cap(next) − cap(claimed)) × passing/declared`.
4. `declared_ceiling` is applied as a hard cap, then the market-dim cap, then rounding to one
   decimal.

**T7 (9.0) carries three structural vetoes**, each of which zeroes partial credit when tripped:

- **Multi-receipt minimum**: `MIN_T7_HIGH_TIER_OUTCOMES = 3` — the dim needs 3+ outcomes at
  effective tier T5+ all passing, all with EXTRACTED (not INFERRED/AMBIGUOUS) evidence quality,
  before a passing T7 outcome counts.
- **Distinct-receipt check**: the T5+ outcomes' commands must reference at least 2 distinct test
  files (`extractTestFiles`, the shared polyglot recognizer in
  `src/matrix/engines/test-file-patterns.ts`, re-exported as `extractPrimaryTestFiles`). One test
  file dressed as many outcomes is one receipt.
- **Session separation**: T7 evidence must span ≥2 distinct `session_id`s. Every receipt written
  in one process gets the same `PROCESS_SESSION_ID` (`randomUUID()` at module load,
  `src/matrix/engines/outcome-runner.ts`, stamped at write time as `entry.session_id`), so a
  single `danteforge validate` run cannot self-certify 9.0. Old evidence without `session_id`
  skips the check (backward compatible).

## 4. The legacy receipt ceiling

Source: `src/matrix/engines/receipt-ceiling.ts`. `LEGACY_NO_RECEIPT_CEILING = 7.0`.
`applyLegacyReceiptCeiling(score, breakdown)` caps any dim whose breakdown has
`usedLegacyFallback === true` at 7.0 — a dim that declares no outcomes has no receipt and cannot
claim more, no matter what `scores.self` says; the cap is re-applied on every `loadMatrix` call
(per the module header). `explainLegacyCeiling(...)` produces the operator-facing explanation.

## 5. Market-capped dimensions

Source: `src/core/market-dims.ts` — the single canonical contract. `MARKET_CAPPED_DIMS` is
exactly `{ community_adoption, enterprise_readiness, token_economy }`;
`MARKET_DIM_MAX_SCORE = 5.0`. These dims are bounded by external market signals internal evidence
cannot certify. The set used to exist as six hand-copied literals that drifted (`token_economy`
was missing from the scoring-kernel copies, so it derived 7.0 against the documented 5.0 cap).
`scripts/evidence-rescore.mjs` mirrors the set in plain JS and
`tests/evidence-rescore-drift.test.ts` pins the mirror to this file (both files exist on disk;
the pinning claim is from the `market-dims.ts` header comment).

Enforcement sites verified: `derived-score.ts` (both the legacy-fallback path and the final
clamp), `clampDimScore` in `compete-matrix-score.ts` (§6), and `verify-outcome-honesty.mts`
(which treats a `MARKET_DIM` integrity violation as expected, not a fabrication).

## 6. The single score-write gate

Source: `src/core/compete-matrix-score.ts` and `src/core/write-verified-score.ts`.

- `clampDimScore(dimensionId, score, ceiling?)` — every `scores.self` write must pass through it.
  It applies the per-dim `ceiling` first and the market cap last, so the market cap always wins.
- `writeVerifiedScore(matrix, dimensionId, rawScore, provenance, opts)` is "the single sanctioned
  score-write gate"; `updateDimensionScore` and `applyAdversarialCalibration` delegate to it so
  `compete-matrix-score.ts` no longer assigns `scores.self` directly (per its own header; the
  assignment ban is enforced by the pre-commit guard in §8, Pillar 1).
- `effectiveDimScore(dim) = min(scores.self, scores.derived)` when derived exists, else self.
- `decisionDimScore(dim)`: for go/no-go work decisions. A dim that DECLARES outcomes but has no
  derived score (stale/no evidence) is capped at `UNVERIFIED_DECISION_CAP = 5.0` — an inflated
  but unproven self-score cannot make the planner skip a dim as "already done".
- `computeOverallScore(matrix)` ranks on `decisionDimScore`, weight-averaged, rounded to one
  decimal — the headline number cannot coast on agent-written self-claims with un-run outcomes.

## 7. The frontier gate — nothing above 8.0 without an independent court

Source: `src/core/frontier-spec.ts`.

- `FRONTIER_GATE_THRESHOLD = 8.0`. `applyFrontierGate(score, dim)` caps any score above 8.0 at
  8.0 unless the dim's `frontier_spec` has effective status `'validated'` — a status only the
  frontier-review-court sets (builder-never-judges). A frozen-but-unvalidated spec caps at 8.0.
- `effectiveStatus(spec)`: a frozen/validated spec whose content hash (`computeSpecHash`,
  sha256 truncated to 16 hex chars over the spec minus `status`/`frozen_at`/`frozen_hash`) no
  longer matches `frozen_hash` becomes `'stale'` — editing a validated spec after the fact drops
  the dim back to 8.0. The gate lives in core (not in the validate command) so the read-time
  derived path applies it too.
- `REAL_RUN_MIN_MS = 1000` — the real-exercise floor for frontier evidence runs; instant commands
  prove nothing. It is the single source for session-record's Guard 3
  (`src/cli/commands/session-record.ts` re-exports it as `MIN_REAL_RUN_MS`) and for the spec
  completer's viability check (`src/core/frontier-spec-complete.ts`), so a completed spec can
  never carry a `run_command` the evidence protocol will structurally reject.
- `TODO_RE = /TODO/i` marks unauthored spec fields.

## 8. Commit-time enforcement — `hooks/pre-commit.mjs`

Five gates run on every commit, in order; each exits 1 on violation:

1. **Fix B (score-surface guard)**: a staged path matching `.danteforge/compete/matrix.json`,
   `.danteforge/compete/matrix-*`, `.danteforge/compete/COMPETE_REPORT.md`,
   `.danteforge/scores/`, or `.danteforge/score-proposals/` is BLOCKED unless the
   `DANTEFORGE_MATRIX_MERGE_RECEIPT` environment variable is set (kernel-merge-only).
2. **Phase A (runtime-evidence guard)**: even WITH the merge receipt set, staging `matrix.json`
   requires `.danteforge/runtime-evidence/` to contain a `.json` file whose mtime is at least as
   new as the matrix (1-second tolerance) — the merge receipt itself must be backed by a probe.
3. **Fix C (protected-line guard)**: if a staged file appears in
   `.danteforge/protected-lines.json`, the commit message must contain `--touches-protected`.
4. **Pillar 1 (symbol-level score-write guard)**: blocks any staged non-test `.ts` file
   containing an assignment matching `/\.scores(\['?self'?\]|\.self)\s*=(?!=)/` outside the
   exempt set `{src/core/compete-matrix.ts, src/core/compete-matrix-score.ts,
   src/cli/commands/honest-rescore.ts, src/core/ascend-engine.ts}` — the in-memory write upstream
   of any matrix.json commit.
5. **Pillar 2 (zero-tolerance stub guard)**: blocks staged production `src/` files containing
   `// TODO|FIXME|XXX` comments, `throw new Error('...not implemented...')` / TODO-throws,
   `jest.mock(`, `vi.mock(`, `sinon.stub(`, or `sinon.mock(`. Test files are exempt.

A `tsc --noEmit` typecheck of the repo follows when any `.ts` file is staged.

## 9. Merge-time enforcement — the merge court

Source: `src/matrix/courts/merge-court.ts`. Before any work-packet candidate merges, in order:
a LOC gate (any introduced `.ts/.tsx` file over 750 lines → `BLOCKED_BY_POLICY`), the
zero-tolerance stub scan (→ `BLOCKED_BY_POLICY`), a security court (CRITICAL findings →
`BLOCKED_BY_SECURITY`), and the **capability gate**: if the candidate's proposed score
(`scoreDelta.after`) exceeds `CAPABILITY_TEST_SCORE_CAP` (5.0) and the capability-test verdict is
not allowed, the decision is `BLOCKED_BY_POLICY` and the recorded score delta is capped via
`applyScoreCap` — an agent cannot merge its way past 5.0 with a failing (or absent)
capability test.

## 10. Worker-side structural prohibition

Source: `src/matrix/types/agent-evidence.ts`. `MATRIX_SCORE_SURFACE_PATTERNS` lists the paths
workers may never modify: `.danteforge/compete/matrix.json`, `.danteforge/compete/matrix-*.json`,
`.danteforge/compete/COMPETE_REPORT.md`, `.danteforge/scores/**`,
`.danteforge/score-proposals/**`, and `.danteforge/compete/universe/**` (universe files define
what 9+ means; builders must not edit the exam while taking it).
`src/matrix/engines/work-packet-generator.ts` prepends this list to every work packet's
`globalForbidden` list. Workers report results in `agent-evidence.json` (`EVIDENCE_FILE_NAME`);
the kernel reads evidence and writes scores — workers never do.

## 11. The honesty-gate script

Source: `scripts/verify-outcome-honesty.mts` (run with `tsx`, optional single-dim argument; exits
0 only on CLEAN). For every dimension it checks:

- every T5/T6/T7 outcome has a `required_callsite` that exists on disk and is NOT a test file;
- the outcome's test file(s) genuinely reference the callsite, with no injection seams
  (delegated to `checkOutcomeIntegrity` in `src/matrix/engines/outcome-integrity.ts`);
- every T4+ callsite is actually **wired** — some non-test `src/` file imports the module
  (substring scan for `<basename>.js'`/`"` so dynamic `import()` and registrar wiring count). An
  orphan (exists, tested, never called by production) is flagged: its honest tier is T2.

`MARKET_DIM` integrity violations are excluded from the problem count — the market cap is honest
behavior, not fabrication.

## 12. Minimal extraction set

To port the truth gate to another repo, the load-bearing files are:

- `src/matrix/types/capability-test.ts` — tiers, caps, freshness, ladder normalization
- `src/matrix/engines/outcome-quality.ts` — evidence-kind classifier + quality gate
- `src/matrix/engines/external-suite-registry.ts` — the 9.5 allowlist
- `src/core/derived-score.ts` — the pure scoring function + T7 vetoes
- `src/matrix/engines/receipt-ceiling.ts` — the no-receipt 7.0 ceiling
- `src/core/market-dims.ts` — the market-cap contract (one copy; everything imports it)
- `src/core/compete-matrix-score.ts` + `src/core/write-verified-score.ts` — the single write gate
- `src/core/frontier-spec.ts` — the 8.0 court threshold + `REAL_RUN_MIN_MS`
- `hooks/pre-commit.mjs` — commit-time enforcement
- `src/matrix/courts/merge-court.ts` — merge-time enforcement
- `src/matrix/types/agent-evidence.ts` — worker prohibitions
- `scripts/verify-outcome-honesty.mts` — the offline honesty audit

The design lesson that recurs in every file's comments: never trust a label an agent can write
(`kind`, `tier`, command text claiming to be a benchmark); classify from structure (command
shape, registries, session ids, file mtimes, import graphs) and put each invariant in exactly one
module that everything else imports.
