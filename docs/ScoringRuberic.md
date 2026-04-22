# DanteForge Scoring Rubric Product Spec
_Execution-ready handoff | Generated: 2026-04-20_

## What

DanteForge needs a codified scoring framework that can grade a product or repo
under multiple evidence standards without changing the underlying evidence set.

Today, scoring discussions drift because one person scores based on "implemented
code exists," another scores based on "publicly defensible claims," and another
scores based on a hostile diligence lens. The result is false precision, unstable
comparisons, and competitive matrices that cannot be defended consistently.

This project adds a first-class DanteForge scoring system with three explicit
rubrics:

- `internal_optimistic`
- `public_defensible`
- `hostile_diligence`

The same evidence should be reusable across all three rubrics. Only the scoring
standard changes.

## Product Goal

As a maintainer or evaluator, I can score a coding tool or repo once against a
shared evidence record and get three separate outputs:

1. An optimistic internal operating score.
2. A publicly defensible score I could use in docs or launch materials.
3. A hostile due-diligence score that protects against self-deception.

## Why This Matters

Without explicit rubrics:

- teams over-credit partially wired features;
- benchmark-free claims get treated as equal to verified outcomes;
- external comparisons become narrative instead of evidence;
- score deltas reflect mood, not methodology.

With explicit rubrics:

- the evidence base stays fixed;
- the interpretation layer becomes inspectable;
- scores become stable enough to compare across time;
- DanteForge can support both internal planning and honest external positioning.

## Core Principles

1. Evidence is separate from scoring.
2. One evidence record can feed multiple rubrics.
3. No exact competitive ranking without source-backed evidence.
4. "Code exists" is not equal to "capability shipped."
5. End-to-end proof outranks unit-test proof.
6. Missing evidence lowers confidence before it lowers precision.
7. Public-facing output must not imply stronger proof than the evidence supports.

## Primary Users

### U1 - Internal maintainer

As a maintainer, I want an optimistic but not fake score so I can prioritize work
without losing sight of trajectory.

### U2 - Public-facing operator

As someone writing docs, release notes, or positioning, I want a defensible score
that only claims what an outsider could reasonably verify.

### U3 - Skeptical reviewer

As a reviewer, investor, or technical buyer, I want the harshest score so I can
see the downside case and the real proof gaps.

## In Scope

### Required outputs

- Triple-rubric scoring for a fixed set of dimensions.
- A normalized evidence model.
- A scoring policy layer per rubric.
- Score explanations per dimension.
- Confidence and evidence-strength metadata.
- Roll-up summaries for:
  - total score
  - category score
  - strongest dimensions
  - weakest dimensions
  - proof gaps
  - recommended next lifts

### Suggested first target

Start with the existing 28-dimension product matrix already used in DanteCode
analysis, but make the framework dimension-agnostic so additional matrices can be
added later.

### Supported use cases

- Score one repo against a 28-dimension matrix.
- Compare the same repo across three rubrics.
- Re-run the same score after new evidence lands.
- Generate a markdown report that explains score shifts.

## Out of Scope

- Fully autonomous competitive web research.
- Automatically scoring third-party tools with invented numbers.
- Replacing human judgment entirely.
- Benchmark orchestration itself.
- Sales-style leaderboard generation without evidence.

## Functional Requirements

### FR1 - Rubric registry

The system must expose named scoring rubrics with configurable weighting rules and
evidence thresholds.

Initial required rubrics:

- `internal_optimistic`
- `public_defensible`
- `hostile_diligence`

### FR2 - Dimension definition registry

The system must support a registry of scoring dimensions with:

- stable dimension id
- display name
- category
- default max score
- dimension description
- required evidence types
- optional hard ceilings

Example dimension metadata:

- `ghost_text_fim`
- `lsp_diagnostics`
- `semantic_search`
- `repo_context`
- `swe_bench`
- `inline_edit`
- `security`
- `enterprise`

### FR3 - Evidence model

Each dimension must be scored from structured evidence records rather than raw
free-form prose alone.

Minimum evidence fields:

- `dimensionId`
- `evidenceType`
- `sourceKind`
- `sourceRef`
- `summary`
- `strength`
- `status`
- `userVisible`
- `mainPathWired`
- `tested`
- `endToEndProven`
- `benchmarkBacked`
- `notes`

Suggested enums:

- `evidenceType`: `code`, `test`, `manual_verification`, `benchmark`, `doc`, `external_source`
- `sourceKind`: `file`, `test_file`, `command_output`, `web_source`, `note`
- `strength`: `weak`, `moderate`, `strong`
- `status`: `present`, `partial`, `missing`, `unknown`

### FR4 - Evidence normalization

The system must distinguish at least these states:

- feature code exists
- feature is wired into the main path
- feature is user-visible
- feature has automated tests
- feature has end-to-end proof
- feature has benchmark or production-like proof

This distinction is the core of the rubric methodology.

### FR5 - Rubric scoring policy

Each rubric must evaluate the same evidence differently.

Minimum policy differences:

#### `internal_optimistic`

- gives meaningful credit for implemented and tested capability;
- allows partial credit when main-path wiring is still incomplete;
- treats strong unit/integration coverage as significant evidence;
- discounts missing benchmarks, but does not zero-out the dimension solely for
  missing public proof.

#### `public_defensible`

- requires stronger proof before high scores are allowed;
- discounts features that are not clearly main-path and user-visible;
- limits claims when evidence is mostly unit-level;
- disallows precise competitive claims without real external sources.

#### `hostile_diligence`

- heavily discounts partial wiring;
- treats unit tests as table stakes;
- requires end-to-end proof for strong scores;
- requires benchmark or outcome evidence for dimensions centered on performance
  or capability claims;
- prefers "unknown" over inflated confidence.

### FR6 - Score explanation generation

For every dimension and rubric, the system must generate:

- score
- short rationale
- why it is not higher
- missing evidence needed for the next score lift

### FR7 - Confidence output

Every dimension score must include confidence metadata.

Suggested confidence levels:

- `low`
- `medium`
- `high`

Confidence should reflect evidence completeness, not optimism.

### FR8 - Report generation

The system must generate markdown reports with:

- overview table
- per-dimension triple matrix
- category roll-up
- total score per rubric
- top overclaimed dimensions
- top under-proven dimensions
- next lifts by score impact

### FR9 - Honest competitor handling

When competitor scoring lacks verified evidence, the system must output:

- score bands instead of fake exact decimals, or
- `insufficient_evidence`

The system must not invent precise external scores from unsourced assumptions.

### FR10 - Delta reports

The system must support comparing two scoring snapshots and report:

- which dimension changed
- which evidence changed
- whether the change came from new proof or from rubric interpretation

## Non-Functional Requirements

| Requirement | Target | Notes |
|---|---|---|
| Determinism | Same evidence + same rubric = same score | No hidden randomness |
| Traceability | Every score can cite evidence refs | Human-auditable |
| Extensibility | New rubrics and dimensions can be added without rewrite | Registry-driven |
| Honesty | Missing proof lowers confidence or score | No fake precision |
| Usability | Markdown report readable by humans first | Codex-friendly output second |

## Proposed Architecture

### Layer 1 - Dimension registry

Defines the scoring surface.

Shipped location:

- `src/scoring/dimensions.ts`

### Layer 2 - Evidence schema and normalization

Defines structured evidence objects and helper utilities.

Shipped location:

- `src/scoring/evidence.ts`

### Layer 3 - Rubric policy engine

Consumes normalized evidence and returns a dimension score under a named rubric.

Shipped location:

- `src/scoring/rubrics.ts`
- `src/scoring/score-dimension.ts`

### Layer 4 - Matrix runner

Runs the full matrix across all dimensions, aggregates totals, and returns a
scoring snapshot.

Shipped location:

- `src/scoring/run-matrix.ts`

### Layer 5 - Report formatter

Formats snapshot data as markdown and JSON.

Shipped location:

- `src/scoring/report.ts`

## Suggested Data Contracts

### `DimensionDefinition`

```ts
interface DimensionDefinition {
  id: string;
  name: string;
  category: string;
  maxScore: number;
  description: string;
  requiredEvidenceTypes: string[];
  hardCeiling?: number;
}
```

### `EvidenceRecord`

```ts
interface EvidenceRecord {
  dimensionId: string;
  evidenceType: "code" | "test" | "manual_verification" | "benchmark" | "doc" | "external_source";
  sourceKind: "file" | "test_file" | "command_output" | "web_source" | "note";
  sourceRef: string;
  summary: string;
  strength: "weak" | "moderate" | "strong";
  status: "present" | "partial" | "missing" | "unknown";
  userVisible: boolean;
  mainPathWired: boolean;
  tested: boolean;
  endToEndProven: boolean;
  benchmarkBacked: boolean;
  notes?: string;
}
```

### `DimensionScore`

```ts
interface DimensionScore {
  dimensionId: string;
  rubricId: string;
  score: number;
  maxScore: number;
  confidence: "low" | "medium" | "high";
  rationale: string;
  ceilingReason?: string;
  nextLift?: string;
  evidenceRefs: string[];
}
```

### `MatrixSnapshot`

```ts
interface MatrixSnapshot {
  matrixId: string;
  subject: string;
  generatedAt: string;
  rubricScores: Array<{
    rubricId: string;
    total: number;
    maxTotal: number;
    normalized: number;
  }>;
  categories: CategoryRollup[];
  dimensions: DimensionScore[];
}
```

## Rubric Interpretation Guidance

These rules should be encoded, not left as vibes.

### Internal optimistic

- A feature with real code, tests, and obvious product direction can score well
  even if benchmark proof is incomplete.
- A feature that is helpful but basic should not automatically receive a `9`.
- Infrastructure that materially reduces future work deserves credit.

### Public defensible

- If an outsider would ask "where is the proof?", the score must be constrained.
- Features that exist only in tests or helper modules cannot be marketed as
  product strengths.
- Exact competitor deltas should be replaced by score bands unless sourced.

### Hostile diligence

- Main-path ownership matters more than module presence.
- Unit tests alone should rarely justify a high score.
- Missing benchmark data should sharply constrain performance-sensitive
  dimensions.
- If a capability is adjacent to the main path instead of powering it, discount
  aggressively.

## CLI / Command Requirements

The first implementation should expose a DanteForge entry point that can:

1. Load a matrix definition.
2. Load or accept evidence records.
3. Run all three rubrics.
4. Emit:
   - JSON snapshot
   - markdown report

Suggested command shape:

```text
danteforge rubric-score \
  --matrix product-28 \
  --subject DanteCode \
  --evidence .danteforge/evidence/dantecode-score.json \
  --rubrics internal_optimistic,public_defensible,hostile_diligence \
  --out .danteforge/reports/dantecode-score.md
```

Optional follow-up command:

```text
danteforge rubric-score diff \
  --before .danteforge/reports/score-2026-04-20.json \
  --after .danteforge/reports/score-2026-05-01.json
```

## Acceptance Criteria

1. DanteForge can score one subject against the existing 28-dimension matrix.
2. The same evidence record produces three different rubric outputs.
3. The report clearly explains why scores differ by rubric.
4. Public-facing output never invents exact competitor rankings without sources.
5. At least five representative dimensions have fixture-based tests proving the
   rubric differences are intentional.
6. A score explanation always includes "why not higher."
7. Confidence is output separately from score.
8. Missing evidence is represented explicitly, not silently ignored.

## Test Strategy

### Unit tests

- evidence normalization
- rubric policy thresholds
- dimension scoring
- category aggregation
- markdown formatting

### Fixture tests

Create evidence fixtures for dimensions that often get overstated:

- `approval_workflow`
- `cost_optimization`
- `security`
- `swe_bench`
- `autonomy`
- `enterprise`

Each fixture should prove that:

- internal score > public score when proof is partial
- public score > hostile score when end-to-end proof is absent

### Golden report tests

- markdown output stable
- JSON snapshot stable
- diff report stable

## Suggested Phases

### Phase 0 - Define contracts

Deliver:

- dimension registry
- evidence schema
- rubric schema

Verification:

- typecheck
- unit tests for schemas and parsing

### Phase 1 - Encode the three rubrics

Deliver:

- rubric engine
- per-dimension scoring pipeline

Verification:

- fixture tests showing meaningful score spread across rubrics

### Phase 2 - Build report generation

Deliver:

- markdown report
- JSON snapshot
- total/category roll-ups

Verification:

- golden report tests

### Phase 3 - Add CLI entry point

Deliver:

- `danteforge rubric-score`
- `danteforge rubric-score diff`

Verification:

- CLI integration tests
- sample report generation in `.danteforge`

### Phase 4 - Migrate current matrix work

Deliver:

- convert the current competitive and scoring notes into structured evidence
- run one real scoring pass for DanteCode

Verification:

- generated report matches the intended methodology
- no manual score editing required after evidence input

## Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Hidden subjectivity remains | The framework could still become narrative theater | Encode threshold rules and fixture tests |
| Overfitting to one matrix | Could become unusable for future scorecards | Keep dimension registry generic |
| Evidence entry becomes too manual | The tool becomes ignored | Start with manual JSON fixtures, then add extraction helpers later |
| False precision returns | Users may still want exact decimals and rankings | Add confidence, score bands, and insufficient-evidence paths |

## Explicit Non-Claims

This project does not claim:

- that all scoring subjectivity can be removed;
- that external competitor scores can be made exact without external proof;
- that a higher internal score means a stronger public claim;
- that code presence alone justifies category leadership.

## Handoff Notes For The Implementing Codex Instance

Prioritize this in order:

1. Get the evidence model right.
2. Get rubric divergence under test.
3. Get markdown output readable.
4. Only then add CLI polish.

Do not optimize for fancy automation first. The goal is a trustworthy scoring
system, not an impressive-looking but fragile one.

If a tradeoff appears between flexibility and honesty, choose honesty.
