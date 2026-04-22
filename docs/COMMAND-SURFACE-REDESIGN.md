# DanteForge Command Surface Redesign

## Objective

Reduce command-surface complexity without reducing system power.

Today the command layer mixes three different concepts:

- workflow stages
- execution intensity presets
- scoring, competition, and research loops

That makes DanteForge flexible, but it also makes it harder to teach, remember, and adopt consistently.

This redesign proposes:

1. Five canonical top-level processes
2. Three shared intensity levels for each process
3. Backward compatibility through aliases
4. A clearer "best way" to use DanteForge day to day

---

## Design Principles

### 1. One top-level noun per user job

Each primary command should answer one user question:

- How do I plan this?
- How do I build this?
- How do I measure this?
- How do I compete on this?
- How do I learn from outside examples?

### 2. Intensity should be orthogonal

Intensity should not require learning a separate brand-new command family.

Instead of:

- `spark`
- `magic`
- `blaze`
- `nova`
- `inferno`

Users should be able to think:

- `--level light`
- `--level standard`
- `--level deep`

### 3. Preserve branded presets as aliases

Preset names still have value for marketing and quick recall.

They should remain available, but they should map onto the canonical process model rather than define the system architecture.

### 4. Keep measurement separate from competition

These are related but distinct:

- `measure`: "How good are we?"
- `compete`: "Compared to whom, on what universe, with what gap?"

This separation is important and should remain explicit.

---

## The Five Canonical Processes

### 1. `plan`

Purpose: turn an idea or repo state into a clear execution path.

Absorbs:

- `review`
- `constitution`
- `specify`
- `clarify`
- `tech-decide`
- `plan`
- `tasks`

Primary user question:

"What exactly should we build, in what order, and under what constraints?"

### 2. `build`

Purpose: execute, refine, and ship product work.

Absorbs:

- `forge`
- `autoforge`
- `magic`
- `party`
- `blaze`
- `nova`
- `inferno`
- parts of `ux-refine`

Primary user question:

"How do we make progress on the product quickly and reliably?"

### 3. `measure`

Purpose: score the project honestly and prove quality changes over time.

Absorbs:

- `score`
- `maturity`
- `proof`
- parts of `verify`

Primary user question:

"How good is the project right now, and is it improving?"

Specialist mode retained:

- `autoresearch` remains a specialist metric-driven optimization loop

### 4. `compete`

Purpose: benchmark against peers, inspect the feature universe, and prioritize competitive gap closure.

Absorbs:

- `assess`
- `universe`
- `compete`
- `dossier`
- `landscape`
- `rubric`
- `rubric-score`

Primary user question:

"Where do we lag the market, and what should we close next?"

### 5. `harvest`

Purpose: discover and learn from OSS and local teacher systems.

Absorbs:

- `oss`
- `local-harvest`
- `harvest`
- `harvest-pattern`
- `cross-synthesize`
- `awesome-scan` in the research sense

Primary user question:

"What proven patterns exist outside our codebase, and what should we borrow?"

---

## Shared Intensity Model

Each canonical process supports the same three levels:

- `light`
- `standard`
- `deep`

This gives the product one repeatable mental model.

### `light`

Use when:

- the user wants a quick answer
- the cost of being incomplete is low
- the goal is orientation, not full execution

Behavior:

- bounded scope
- fewer external lookups
- one-wave or one-pass execution
- shorter outputs

### `standard`

Use when:

- the user wants the normal/default path
- this is everyday product work
- the goal is balanced speed and rigor

Behavior:

- complete enough to be actionable
- moderate breadth and verification
- the default recommended level

### `deep`

Use when:

- entering a new matrix dimension
- making strategic architecture/product moves
- building a benchmark, universe, or high-confidence release position

Behavior:

- broader discovery
- stronger verification
- more autonomous orchestration
- designed for strategic, not just tactical, work

---

## Canonical Command Table

### `danteforge plan`

Examples:

```bash
danteforge plan "Build a competitive scoring system" --level light
danteforge plan "Rework command surface" --level standard
danteforge plan "New matrix dimension: operator preference" --level deep
```

Level behavior:

- `light`: review + specify
- `standard`: review + constitution + specify + clarify + tech-decide + plan
- `deep`: standard + tasks + critique + stronger artifacts

Recommended flags:

- `--prompt`
- `--light` can be deprecated in favor of `--level light`
- `--ceo-review`
- `--design-brief`

### `danteforge build`

Examples:

```bash
danteforge build "Improve onboarding" --level light
danteforge build "Close DX gaps" --level standard
danteforge build "Attack competitive dimension: autonomy" --level deep
```

Level behavior:

- `light`: single-wave forge
- `standard`: magic/autoforge style balanced execution
- `deep`: inferno/blaze/nova style execution with research and isolation

Recommended flags:

- `--worktree`
- `--design`
- `--isolation`
- `--parallel`
- `--live`

### `danteforge measure`

Examples:

```bash
danteforge measure --level light
danteforge measure --level standard
danteforge measure --level deep --adversary
```

Level behavior:

- `light`: quick `score`
- `standard`: score + maturity + proof delta
- `deep`: verify-backed scoring with adversarial review and stronger evidence

Recommended flags:

- `--full`
- `--strict`
- `--adversary`
- `--json`

### `danteforge compete`

Examples:

```bash
danteforge compete --level light
danteforge compete --level standard
danteforge compete --level deep
```

Level behavior:

- `light`: harsh self-assessment and current gap table
- `standard`: assess + universe + ranked gap map
- `deep`: full Competitive Harvest Loop with dimension selection, sprint plan, rescore, and trend tracking

Recommended flags:

- `--refresh`
- `--init`
- `--sprint`
- `--rescore`
- `--report`
- `--json`

### `danteforge harvest`

Examples:

```bash
danteforge harvest "agent UX patterns" --level light
danteforge harvest "CLI interaction patterns" --level standard
danteforge harvest "full operator-tool universe" --level deep
```

Level behavior:

- `light`: focused harvest-pattern style run
- `standard`: bounded OSS or local-harvest pass
- `deep`: repeated OSS plus local-harvest plus re-learning plus universe refresh

Recommended flags:

- `--max-repos`
- `--source oss|local|mixed`
- `--refresh`
- `--depth shallow|medium|full`

---

## Proposed Mapping: Old Commands -> Canonical Model

### Planning Layer

| Existing | New Canonical Meaning |
|----------|------------------------|
| `review` | `plan --level light` |
| `constitution` | `plan --level standard` internal stage |
| `specify` | `plan --level light` or `standard` |
| `clarify` | `plan --level standard` |
| `tech-decide` | `plan --level standard` or `deep` |
| `plan` | `plan --level standard` |
| `tasks` | `plan --level deep` output stage |

### Build Layer

| Existing | New Canonical Meaning |
|----------|------------------------|
| `forge` | `build --level light` |
| `autoforge` | `build --level standard` |
| `magic` | alias for `build --level standard` |
| `party` | `build --level deep --parallel --isolation` |
| `blaze` | alias for `build --level deep` |
| `nova` | alias for `build --level deep --planning-prefix` |
| `inferno` | alias for `build --level deep --with-harvest` |

### Measure Layer

| Existing | New Canonical Meaning |
|----------|------------------------|
| `score` | `measure --level light` |
| `maturity` | `measure --level standard` component |
| `proof` | `measure --level standard` or `deep` evidence mode |
| parts of `verify` | `measure --level deep` evidence/receipt mode |
| `autoresearch` | specialist mode: `measure --mode autoresearch --level deep` with standalone alias retained |

### Competitive Layer

| Existing | New Canonical Meaning |
|----------|------------------------|
| `assess` | `compete --level light` |
| `universe` | `compete --level standard` |
| `compete` | `compete --level deep` |
| `dossier` | `compete` subsystem |
| `landscape` | `compete` subsystem |
| `rubric` | `compete` subsystem |
| `rubric-score` | `compete` subsystem |

### Harvest Layer

| Existing | New Canonical Meaning |
|----------|------------------------|
| `oss` | `harvest --level standard` |
| `local-harvest` | `harvest --source local --level standard` |
| `harvest` | `harvest --level standard` constitutional mode |
| `harvest-pattern` | `harvest --level light` |
| `cross-synthesize` | `harvest --level deep` synthesis stage |

---

## Preservation Matrix

The redesign is only valid if it preserves the highest-value behaviors from the current command surface.

This matrix is the safeguard against "simplifying away the good parts."

### Preservation Rule

No command should be retired, hidden, or downgraded until all three of these are mapped into the new model:

1. its unique high-value behavior
2. its key guardrail or discipline
3. its best-fit user scenario

If any of those are missing, the command is not yet safely absorbed.

### Core Preservation Audit

| Existing Command | Unique High-Value Behavior To Preserve | Why It Matters | New Home In Redesign | Status |
|------------------|-----------------------------------------|----------------|----------------------|--------|
| `spark` | cheap planning-first entry point without premature execution | prevents overbuilding before clarity exists | `plan --level light` | preserved |
| `review` | repo-state grounding before planning | avoids planning against fantasy context | `plan --level light` | preserved |
| `constitution` | explicit principles and constraints | protects coherence and avoids local-optimum drift | `plan --level standard` | preserved |
| `specify` | turning ideas into structured spec artifacts | creates the contract for downstream work | `plan --level light/standard` | preserved |
| `clarify` | forcing questions before plan commitment | catches ambiguity before execution cost rises | `plan --level standard` | preserved |
| `tech-decide` | explicit stack/architecture tradeoff pass | avoids accidental architecture through momentum | `plan --level standard/deep` | preserved |
| `plan` | converting spec into execution strategy | keeps work sequenced and reasoned | `plan --level standard` | preserved |
| `tasks` | decomposition into executable work waves | bridges planning into action | `plan --level deep` | preserved |
| `forge` | bounded execution wave | good for one focused implementation push | `build --level light` | preserved |
| `magic` | balanced daily-driver behavior | currently the best default for normal work | `build --level standard` alias | preserved |
| `autoforge` | deterministic orchestration across the workflow | useful when consistency matters more than creativity | `build --level standard` execution mode | preserved |
| `party` | multi-agent / parallel execution posture | important for scale and throughput | `build --level deep --parallel --isolation` | preserved |
| `blaze` | high-power push for large features | signals "commit serious execution resources" | `build --level deep` alias | preserved |
| `nova` | deep execution with planning prefix | useful for large work that still needs front-loaded reasoning | `build --level deep --planning-prefix` | preserved |
| `inferno` | first-time attack on a new dimension with fresh OSS discovery | one of the most strategically valuable workflows in the repo | `build --level deep --with-harvest` alias | must remain explicit |
| `ux-refine` | post-build UX tightening rather than raw implementation | preserves product polish as a distinct concern | `build --design` or adjacent post-build step | at risk if over-merged |
| `score` | very fast daily honesty check | high frequency, low friction, strong operating rhythm | `measure --level light` | preserved |
| `maturity` | readiness-level framing, not just numeric score | translates quality into business readiness | `measure --level standard` | preserved |
| `proof` | before/after evidence and delta validation | prevents "score inflation without receipts" | `measure --level standard/deep` | preserved |
| `autoresearch` | metric-driven autonomous optimization loop over a real measurement target | uniquely useful for iterative local optimization once a metric is trustworthy | `measure --mode autoresearch --level deep` with alias retained | must remain explicit |
| `verify` | fail-closed truth surface and receipts | critical integrity gate across the whole system | remains standalone gate plus `measure --level deep` integration | must remain explicit |
| `assess` | harsh self-assessment plus competitor-aware masterplan | strategic realism, not comfort scoring | `compete --level light` | preserved |
| `universe` | expanding definition of completeness as competitors are learned | keeps "done" grounded in the external market | `compete --level standard --refresh` | must remain explicit |
| `compete` | one-dimension-per-sprint competitive gap loop | prevents unfocused strategic thrash | `compete --level deep` | preserved |
| `dossier` | source-backed competitor evidence | improves auditability of competitive claims | `compete` subsystem | preserved |
| `landscape` | market ranking and gap visualization | makes the competitive picture legible | `compete` subsystem | preserved |
| `rubric` / `rubric-score` | frozen criteria and scoring discipline | reduces arbitrary score drift | `compete` subsystem | preserved |
| `oss` | repeated OSS discovery and legal pattern harvesting | core mechanism for external learning | `harvest --level standard` | preserved |
| `local-harvest` | learning from private/local repos, not just public OSS | vital for real-world operator intelligence | `harvest --source local --level standard` | preserved |
| `harvest` | constitutional / deliberate harvest framing | useful when the method matters, not just the result | `harvest --level standard` mode | partially preserved |
| `harvest-pattern` | tight, focused, low-cost pattern extraction | best entry for narrow external learning | `harvest --level light` | preserved |
| `cross-synthesize` | combining strongest patterns across prior harvests | converts a library into strategy | `harvest --level deep` synthesis stage | preserved |
| `retro` | structured reflection after execution | prevents repeated mistakes and captures process learning | standalone support command or integrated post-step | at risk if omitted from canonical story |
| `lessons` / `teach` | explicit correction capture | one of the self-improvement moats | standalone support command | must remain explicit |

### Guardrails That Must Survive The Redesign

These are not just command names. They are behaviors that must continue to exist visibly in the new surface:

| Guardrail | Current Source | Required New Location |
|-----------|----------------|------------------------|
| Constitution before spec | workflow pipeline | `plan` internal gate |
| Spec before plan | workflow pipeline | `plan` internal gate |
| Plan before execution | workflow pipeline | `build` entry gate |
| Verify before strategic rescoring | `compete`, `verify` | `compete --level deep` hard gate |
| One dimension per competitive sprint | `compete` | `compete --level deep` |
| Fresh OSS discovery on first new dimension attack | `inferno` | `build --level deep --with-harvest` |
| Daily quick honesty without heavy overhead | `score` | `measure --level light` |
| Explicit metric-driven optimization loop for trusted measurements | `autoresearch` | `measure --mode autoresearch --level deep` plus standalone alias |
| Universe expands as more competitors are learned | `universe`, `oss` | `compete --level standard` plus `harvest --level deep` |
| Truth surfaces fail closed | `verify` | standalone `verify` plus deep measure mode |
| Lessons persist between cycles | `lessons`, `teach`, `retro` | support commands retained explicitly |

### Best User Scenarios To Preserve

The redesign should still feel excellent in these concrete scenarios:

| Scenario | Current Best Command | Required Redesign Equivalent |
|----------|----------------------|-------------------------------|
| "I just need a fast reality check." | `score` | `measure --level light` |
| "I have a real metric and want the system to optimize against it autonomously." | `autoresearch` | `measure --mode autoresearch --level deep` |
| "I have a new idea and need structure, not code yet." | `spark` | `plan --level light` |
| "I need the normal daily implementation path." | `magic` | `build --level standard` |
| "I am attacking a new competitive dimension for the first time." | `inferno` | `build --level deep --with-harvest` |
| "I need a harsh competitive masterplan." | `assess` | `compete --level light` |
| "I need to see the full market feature universe." | `universe` | `compete --level standard --refresh` |
| "I want the system to pick the next competitive sprint and close it." | `compete` | `compete --level deep` |
| "I want to keep learning from OSS until the library stops yielding new leverage." | repeated `oss` runs | `harvest --level deep --until-saturation` |
| "I need patterns from private/local repos too." | `local-harvest` | `harvest --source local|mixed` |

### Preservation Risks

These are the biggest risks if implementation is too aggressive:

1. `inferno` gets flattened into "just deeper build" and loses its fresh-OSS-first identity.
2. `verify` gets partially absorbed into `measure` and stops feeling like a hard release/receipt gate.
3. `universe` gets treated as a reporting variant instead of the system that defines completion breadth.
4. `retro`, `lessons`, and `teach` become secondary and the self-improvement loop weakens.
5. `ux-refine` disappears into generic build execution and product polish becomes inconsistent.
6. `autoresearch` gets lost between build and measure and stops being discoverable as a specialist loop.

### Preservation Verdict

The five-process redesign is directionally correct, but it should only move forward under this condition:

**The canonical surface becomes simpler, while the deep behaviors remain richer and more explicit.**

That means:

- fewer top-level nouns
- clearer levels
- stronger defaults
- no silent loss of specialized high-leverage workflows

If there is ever a conflict between "fewer commands" and "preserve strategic leverage," leverage should win.

---

## Recommended Canonical Workflows

### Workflow A: Daily Product Work

```bash
danteforge measure --level light
danteforge build "<goal>" --level standard
danteforge verify
danteforge measure --level light
```

This replaces the current instinct to choose between `forge`, `magic`, `autoforge`, and `score` manually.

### Workflow B: New Competitive Dimension

```bash
danteforge compete --level deep --sprint
danteforge harvest "<dimension>" --level standard
danteforge build "<dimension goal>" --level deep --with-harvest
danteforge verify
danteforge compete --level deep --rescore
```

This preserves the current `compete -> sprint selection -> oss/inferno-style attack -> verify -> rescore` discipline rather than flattening it into a generic deep build.

### Workflow C: Build Full Market Universe

```bash
danteforge harvest "operator tools universe" --level deep
danteforge compete --level standard --refresh
danteforge universe --refresh
```

Longer-term, `universe` should be folded under `compete`, but this preserves the existing capability while moving users toward the new model.

### Workflow D: Trusted Metric Optimization

```bash
danteforge measure --level standard
danteforge measure --mode autoresearch --level deep --metric "<metric>"
danteforge verify
danteforge measure --level standard
```

This preserves `autoresearch` as a specialist loop for local, measurement-driven optimization after the project has a trustworthy metric and stable verification path.

---

## How to Build the Full Competitive Matrix

If the goal is "full matrix against closed and open source", the canonical stack should be:

1. `harvest --level deep`
2. `compete --level standard`
3. `compete --level deep`

Interpretation:

- `harvest` expands the teacher set
- `compete` standard rebuilds the market and feature model
- `compete` deep chooses and closes the next gap

Closed-source tools define the operator ceiling.
OSS tools define the legal and practical harvest library.

That distinction should remain explicit in the implementation and docs.

---

## How to Keep Running OSS Until the Universe Is "Full Enough"

The system should not treat OSS harvesting as one command run.
It should treat it as a library-growth loop.

### Proposed rule

Continue deep harvest cycles until one of these stop conditions is met:

1. Two consecutive harvest cycles add fewer than `N` new unique features
2. Two consecutive harvest cycles add fewer than `M` new high-value patterns
3. Gap rankings stop changing materially after universe refresh
4. The teacher registry covers all major role classes:
   - direct peers
   - specialist teachers
   - reference teachers

### Proposed canonical command behavior

```bash
danteforge harvest "<domain>" --level deep --until-saturation
```

Possible internal behavior:

- run repeated `/oss` waves
- merge with `local-harvest`
- re-run pattern extraction
- refresh universe
- stop only when saturation conditions are met

### Proposed saturation metrics

- new repos discovered this cycle
- new non-duplicate patterns discovered
- new universe features discovered
- number of dimensions whose gap ranking changed after refresh

This is better than "run OSS a lot" because it gives the system a principled stopping rule.

---

## Backward Compatibility Strategy

### Phase 1: Add canonical commands, keep existing commands

Add:

- `plan`
- `build`
- `measure`
- `compete`
- `harvest`

with `--level light|standard|deep`.

Keep all current commands working.

### Phase 2: Reframe branded presets as aliases

Document:

- `spark` -> `plan --level light`
- `ember` -> `build --level light`
- `magic` -> `build --level standard`
- `blaze` -> `build --level deep`
- `nova` -> `build --level deep --planning-prefix`
- `inferno` -> `build --level deep --with-harvest`
- `autoresearch` -> `measure --mode autoresearch --level deep`

### Phase 3: Move docs and help to canonical-first

Help output should show canonical commands first and aliases second.

For example:

```text
Primary commands:
  plan, build, measure, compete, harvest

Preset aliases:
  spark, ember, magic, blaze, nova, inferno

Specialist modes:
  autoresearch
```

### Phase 4: Collapse duplicate documentation and examples

Most tutorials should teach:

- process
- level
- optional mode flags

not separate branded command families.

### Phase 5: Retain First-Class Support Commands

The canonical surface should be process-first, but these commands should remain first-class and visible in help/docs because they are support primitives, not mere aliases:

- `verify`
- `retro`
- `lessons`
- `teach`
- `ux-refine`

Interpretation:

- canonical processes answer the main "what job am I doing?" question
- support commands answer "what control loop or quality gate do I need around that job?"

These should not be buried as undocumented internals.

---

## Best-Use Guidance for the User

If we adopt this redesign, the easiest way to teach DanteForge becomes:

- Use `plan` when you need clarity
- Use `build` when you need progress
- Use `measure` when you need honesty
- Use `compete` when you need priority
- Use `harvest` when you need outside patterns

Then choose:

- `light` for quick
- `standard` for normal
- `deep` for strategic

That is a much more learnable mental model than the current mixed command surface.

---

## Recommendation

Adopt the five-process model as the canonical public surface.

Specifically:

1. Make `plan`, `build`, `measure`, `compete`, and `harvest` the primary top-level commands
2. Standardize on `--level light|standard|deep`
3. Preserve current presets as aliases
4. Keep `measure` and `compete` separate
5. Add a saturation-driven deep harvest mode so universe-building becomes an explicit loop, not an accidental habit

This keeps all the current power, but it turns DanteForge from a large toolbox into a coherent operating system.
