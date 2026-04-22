# Sprint 22 Masterplan: The Adversary Layer

## Context

Sprint 21 grounded scores in objective metrics and closed the falsified-hypothesis loop.
Five structural weaknesses remain:

1. **Test pass rate is gameable** — the LLM writes code AND tests in the same wave.
   100% pass rate with 0% mutation score = meaningless suite.
2. **LLM grades its own homework** — single-evaluator scoring has no adversary.
   A debate-style (advocate + adversary) produces scores with error bars, not false certainty.
3. **Federation bundles are trusted on assertion** — a project with inflated scores can
   export "pattern X improved score by 4.0" and it gets imported at 0.5× weight regardless.
   No Bayesian shrinkage, no implausibility gate.
4. **Attribution only accumulates when you manually run commands** — no CI hook,
   no continuous signal from real commits, no way to attribute quality changes to PRs.
5. **The system has never been validated on an external codebase** — DanteForge has
   only ever assessed DanteForge. That's circular. External validation is the proof.

This sprint closes all 5.

---

## Wave 1 — Adversarial Scorer (Gap 2)

**Problem**: One LLM scores the code it helped write. Conflict of interest baked in.

**Solution**: Two LLM calls per assessment — advocate finds improvements, adversary
finds regressions. Final score = (advocate + adversary) / 2. The adversary prompt is
explicitly instructed to be harsh: "You are a senior engineer reviewing this diff.
Find every way it is WORSE than the previous version. Be specific and unforgiving."

### New file: `src/core/adversarial-scorer.ts`

```typescript
export interface DebateResult {
  advocateScore: number;       // what got better (0-10)
  adversaryScore: number;      // what got worse (0-10, inverted: 10 = nothing got worse)
  debateScore: number;         // (advocate + adversary) / 2
  advocateSummary: string;
  adversarySummary: string;
  contested: boolean;          // true when |advocate - adversary| > 2.0
}

export async function runDebateScore(
  currentCode: string,
  previousCode: string,
  opts?: AdversarialScorerOptions
): Promise<DebateResult>

export function buildAdvocatePrompt(current: string, previous: string): string
export function buildAdversaryPrompt(current: string, previous: string): string
export function parseScoreFromResponse(response: string): number
```

Injection seams: `_llmCaller`, `_isLLMAvailable`

### Modified: `src/core/objective-metrics.ts`

Add optional `adversarialScore?: number` and `debateContested?: boolean` to `ObjectiveMetrics`.
When `_runDebate` is provided, call it and blend: finalScore = 0.5 × hybrid + 0.5 × debate.

**Tests**: `tests/adversarial-scorer.test.ts` — 10 tests

---

## Wave 2 — Lightweight Mutation Score (Gap 1)

**Problem**: A test suite with 100% pass rate can still catch 0% of bugs if the tests
were written to pass, not to fail on breakage. The only way to measure this is to
break the code and see if any tests notice.

**Solution**: Implement 5 mutation operators in pure TypeScript — no Stryker, no external
tooling, no CLI dependency. Apply mutations to source files one at a time, run tests,
count how many mutations are detected.

### New file: `src/core/mutation-score.ts`

5 mutation operators:
1. **condition-flip**: `if (x > y)` → `if (x < y)`, `if (x === y)` → `if (x !== y)`
2. **return-null**: replace `return expr` with `return null` / `return 0` / `return ''`
3. **boolean-literal**: `true` → `false`, `false` → `true`
4. **arithmetic-flip**: `+` → `-`, `*` → `/` (only in non-string context)
5. **boundary-shift**: `>= n` → `> n`, `< n` → `<= n`

```typescript
export interface MutationResult {
  totalMutants: number;
  killed: number;           // mutants detected by tests
  survived: number;         // mutants that slipped through
  mutationScore: number;    // killed / totalMutants (0-1)
  operatorBreakdown: Record<string, { killed: number; total: number }>;
}

export async function runMutationScore(
  sourceFiles: string[],
  opts?: MutationScoreOptions
): Promise<MutationResult>
```

Injection seams: `_readFile`, `_writeFile`, `_runTests`, `_restoreFile`

Wire `mutationScore` into `ObjectiveMetrics` and `scoreObjectiveMetrics()`:
bonus points for high mutation score, penalty for mutation score < 0.5.

**Tests**: `tests/mutation-score.test.ts` — 10 tests covering each operator + aggregate

---

## Wave 3 — Bundle Trust Verifier (Gap 3)

**Problem**: Pattern federation imports on assertion. A project can export fabricated
scores and they get weighted at 0.5× regardless of plausibility.

**Solution**: Bayesian shrinkage + implausibility gate before any import.

### New file: `src/core/bundle-trust.ts`

```typescript
export interface TrustVerificationResult {
  approved: SharedPatternStats[];
  quarantined: QuarantinedPattern[];
  trustScore: number;           // 0-1, overall bundle credibility
  shrinkageApplied: number;     // how many patterns had claims shrunk
}

export interface QuarantinedPattern {
  patternName: string;
  reason: 'implausible-delta' | 'tiny-sample' | 'adversarial-claim';
  originalDelta: number;
  threshold: number;
}

// Bayesian shrinkage: pull small-sample claims toward category prior
export function shrinkClaim(
  observedDelta: number,
  sampleCount: number,
  priorMean: number,
  priorStrength: number   // equivalent prior samples (default: 5)
): number

// Implausibility gate
export function isImplausible(
  pattern: SharedPatternStats,
  thresholds?: ImplausibilityThresholds
): boolean

export function verifyBundle(
  bundle: SharedPatternBundle,
  localLibrary: PatternLibraryIndex,
  opts?: BundleTrustOptions
): TrustVerificationResult
```

Implausibility thresholds:
- `avgScoreDelta > 3.5` with `sampleCount < 3` → quarantine (implausible-delta)
- `sampleCount < 1` → quarantine (tiny-sample)
- `verifyPassRate < 0.3` → quarantine (adversarial-claim — more failures than passes)

Bayesian shrinkage formula:
`shrunk = (observedDelta × sampleCount + priorMean × priorStrength) / (sampleCount + priorStrength)`

### Modified: `src/cli/commands/import-patterns.ts`

Call `verifyBundle()` before any import. Only import `approved` patterns.
Log quarantined patterns with reason. Include trust score in result.

**Tests**: `tests/bundle-trust.test.ts` — 10 tests

---

## Wave 4 — CI Attribution Adapter (Gap 4)

**Problem**: The feedback loop only runs when a developer manually runs a command.
Real compounding requires continuous signal from every commit.

**Solution**: A CI-aware adapter that detects the environment, captures before/after
metrics from the CI context, and writes structured attribution events.

### New file: `src/core/ci-attribution.ts`

```typescript
export interface CIEnvironment {
  provider: 'github-actions' | 'circleci' | 'gitlab-ci' | 'jenkins' | 'local';
  commitSha?: string;
  branchName?: string;
  prNumber?: string;
  runId?: string;
}

export interface CIAttributionEvent {
  eventId: string;
  capturedAt: string;
  environment: CIEnvironment;
  metrics: ObjectiveMetrics;
  commitSha?: string;
  branch?: string;
  prNumber?: string;
}

export function detectCIEnvironment(env?: Record<string, string>): CIEnvironment
export async function captureAndWriteCIEvent(opts?: CIAttributionOptions): Promise<CIAttributionEvent>
export async function loadCIHistory(cwd?: string): Promise<CIAttributionEvent[]>
export function diffCIEvents(before: CIAttributionEvent, after: CIAttributionEvent): SnapshotDiff
```

### New file: `src/cli/commands/ci-report.ts`

Command: `danteforge ci-report`
- Captures current metrics
- Loads CI history from `.danteforge/ci-history.json`
- Diffs against previous event for same branch/PR
- Reports regressions (non-zero exit if regression detected)
- Suitable for CI step: `- run: danteforge ci-report`

**Tests**: `tests/ci-attribution.test.ts` — 8 tests

---

## Wave 5 — External Validate Command (Gap 5)

**Problem**: DanteForge has only ever assessed DanteForge. That's circular validation.

**Solution**: `danteforge external-validate <repo-url>` clones a repo, runs self-assess
on it, and produces a cross-project validation report that proves the system works
outside its own context.

### New file: `src/cli/commands/external-validate.ts`

```typescript
export interface ExternalValidateOptions {
  repoUrl: string;
  cwd?: string;
  skipClone?: boolean;     // use existing clone at targetDir
  targetDir?: string;      // where to clone (default: .danteforge/external-validate/<name>)
  _cloneRepo?: (url: string, dir: string) => Promise<void>;
  _runAssess?: (cwd: string) => Promise<SelfAssessResult>;
  _cleanup?: (dir: string) => Promise<void>;
}

export interface ExternalValidateResult {
  repoUrl: string;
  cloneDir: string;
  assessment: SelfAssessResult;
  licenseOk: boolean;
  duration: number;
}

export async function runExternalValidate(opts: ExternalValidateOptions): Promise<ExternalValidateResult>
```

License gate: reads LICENSE file before assessing. BLOCKED = GPL/AGPL/SSPL/no-license.
Cleanup: removes clone dir after assessment (unless --keep flag).

**Tests**: `tests/external-validate.test.ts` — 6 tests (all injected, no real cloning)

---

## Critical Files Summary

| File | Action |
|------|--------|
| `src/core/adversarial-scorer.ts` | NEW |
| `src/core/mutation-score.ts` | NEW |
| `src/core/bundle-trust.ts` | NEW |
| `src/core/ci-attribution.ts` | NEW |
| `src/cli/commands/ci-report.ts` | NEW |
| `src/cli/commands/external-validate.ts` | NEW |
| `src/core/objective-metrics.ts` | MODIFY — add mutationScore, adversarialScore fields |
| `src/cli/commands/import-patterns.ts` | MODIFY — verify bundle before import |
| `src/cli/index.ts` | MODIFY — 3 new commands |
| `tests/adversarial-scorer.test.ts` | NEW — 10 tests |
| `tests/mutation-score.test.ts` | NEW — 10 tests |
| `tests/bundle-trust.test.ts` | NEW — 10 tests |
| `tests/ci-attribution.test.ts` | NEW — 8 tests |
| `tests/external-validate.test.ts` | NEW — 6 tests |

---

## Verification

```bash
npm run typecheck
npx tsx --test "tests/adversarial-scorer.test.ts"    # 10/10
npx tsx --test "tests/mutation-score.test.ts"        # 10/10
npx tsx --test "tests/bundle-trust.test.ts"          # 10/10
npx tsx --test "tests/ci-attribution.test.ts"        # 8/8
npx tsx --test "tests/external-validate.test.ts"     # 6/6
npm test                                              # 3866+, 0 failures
npm run build
npm run check:anti-stub
npm run release:check
```

Target: +44 new tests, 0 failures, all gates green.
