# DanteForge: Model Personality Profiles — Learned Model Agnosticism PRD

## Document Control

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Codename** | Model DNA |
| **Author** | Council of Minds (Claude Opus + Ricky) |
| **License** | PROPRIETARY — DanteForge IP |
| **Target Packages** | `@dantecode/danteforge` (profile engine) + `@dantecode/core` (router integration) |
| **Branch** | `feat/dantecode-9plus-complete-matrix` |
| **Depends On** | 7 Levels Deep engine (companion PRD) — Level 3-4 findings feed profiles |

---

## 1. The Problem

DanteCode is model-agnostic. It routes between Grok, Anthropic, OpenAI, Google, Groq, Ollama, and custom endpoints. The current routing logic uses capability fingerprinting — "does this model support vision? tool calls? what's the context window?" — and Jaccard task matching for basic capability selection.

This is routing at the **capability** level. It answers: "CAN this model do this task?"

It doesn't answer: "SHOULD this model do this task?" or "What mistakes will this model make on this task?"

Every model has a personality — consistent patterns of strength and weakness that emerge across hundreds of tasks. Grok over-generates boilerplate. Opus overthinks simple tasks. GPT-5 produces clean code but shallow error handling. DeepSeek excels at algorithms but struggles with API integrations. These patterns are real, consistent, and currently invisible to the router.

**Model Personality Profiles make these patterns visible and actionable.** Built automatically from DanteForge verification data, they transform model routing from "which model CAN do this" to "which model WILL do this BEST, and what compensating instructions should I give it."

---

## 2. The Concept

### What Is a Profile?

A statistical map of a model's coding behavior, built automatically from:
- **PDSE scores** by task category (authentication, database, API, UI, testing, etc.)
- **Anti-stub violation patterns** (which categories does this model stub most?)
- **Gaslight findings** (which categories does adversarial testing expose weaknesses?)
- **7 Levels Deep root causes** (Level 3-4 findings: "model-level" and "context-level" causes)
- **Retry success rates** (how often does the model self-correct on first retry vs needing multiple?)
- **Token efficiency** (tokens consumed per successful task by category)
- **Skillbook lesson patterns** (which lessons does this model need most often?)

### What Does the Router Do With It?

1. **Smart routing** — route authentication tasks to the model with the highest auth PDSE average, route algorithms to the model with the best algo scores, route UI to the model that produces the fewest anti-stub violations on frontend code.

2. **Compensating instructions** — when routing to a model known to have weakness X, inject a targeted instruction: "Pay special attention to null handling in error paths — this is a known gap area. Explicitly handle every nullable return."

3. **Cost optimization** — for tasks where a cheap model's profile shows 90+ PDSE, don't waste money on an expensive model. For tasks where the cheap model's profile shows <75 PDSE, escalate to a stronger model.

4. **Failure prediction** — before running a task, estimate the probability of first-pass success based on the model's profile for this task category. If probability is low, proactively add more context or decompose the task further.

---

## 3. Architecture

### Package Structure

```
packages/danteforge/src/
├── model-profile.ts           ← NEW: profile data structures + accumulation
├── model-profile-engine.ts    ← NEW: analysis engine that builds profiles
├── model-profile.test.ts      ← NEW: tests
├── autoforge.ts               ← MODIFIED: feed failure data to profile engine
├── lessons.ts                 ← MODIFIED: tag lessons with model attribution

packages/core/src/
├── model-router.ts            ← MODIFIED: use profiles for intelligent routing
├── capability-fingerprint.ts  ← MODIFIED: merge profile data with capability data
```

### Data Flow

```
Task arrives
    ↓
Model Router checks profiles: "Which model is best for this task category?"
    ↓
Router selects model + generates compensating instructions from known weaknesses
    ↓
Model generates code
    ↓
DanteForge verifies (PDSE, anti-stub, constitution)
    ↓
Results fed to Profile Engine:
  - PDSE score → category average updated
  - Anti-stub hits → stub pattern tallied
  - Success/failure → success rate updated
  - Token count → efficiency tracked
    ↓
If failure → 7 Levels Deep analysis → Levels 3-4 → profile enrichment
    ↓
If Gaslight runs → findings → profile weakness patterns
    ↓
Profile persisted to .dantecode/model-profiles/{providerId}_{modelId}.json
```

---

## 4. Component Specifications

### 4.1 — Profile Data Structure (`danteforge/src/model-profile.ts`)

```typescript
/**
 * Statistical profile of a model's coding behavior.
 * Built automatically from DanteForge verification data.
 * Persisted per-project in .dantecode/model-profiles/.
 */

export interface ModelProfile {
  /** Provider + model identifier. e.g. "grok:grok-3" */
  modelKey: string;
  providerId: string;
  modelId: string;

  /** When this profile was created and last updated. */
  createdAt: string;
  updatedAt: string;

  /** Total number of tasks this model has been evaluated on. */
  totalTasks: number;

  /** Category-level performance statistics. */
  categories: Record<string, CategoryStats>;

  /** Known weakness patterns (from 7 Levels Deep Level 3 findings). */
  weaknesses: WeaknessPattern[];

  /** Known strength patterns (consistently high PDSE categories). */
  strengths: StrengthPattern[];

  /** Compensating instructions that improve output quality. */
  compensations: CompensationRule[];

  /** Overall aggregate scores. */
  aggregate: {
    averagePdse: number;
    firstPassSuccessRate: number;    // % of tasks passing PDSE on first attempt
    averageRetriesNeeded: number;    // when first pass fails
    averageTokensPerTask: number;
    stubViolationRate: number;       // % of tasks with anti-stub hits
  };
}

export interface CategoryStats {
  category: string;           // e.g. "authentication", "database", "api", "testing", "ui"
  taskCount: number;
  averagePdse: number;
  minPdse: number;
  maxPdse: number;
  firstPassSuccessRate: number;
  averageRetries: number;
  averageTokens: number;
  stubViolationRate: number;
  /** Recent trend: improving, stable, or declining. */
  trend: "improving" | "stable" | "declining";
  /** Timestamps of last N tasks for trend calculation. */
  recentScores: Array<{ timestamp: string; pdse: number }>;
}

export interface WeaknessPattern {
  id: string;
  description: string;            // e.g. "Stubs OAuth2 refresh token logic"
  category: string;               // e.g. "authentication"
  severity: "low" | "medium" | "high";
  occurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  /** The Level 3/4 root cause from 7 Levels Deep. */
  rootCause?: string;
  /** Whether a compensation rule has been created for this. */
  compensated: boolean;
}

export interface StrengthPattern {
  id: string;
  description: string;            // e.g. "Excellent test generation with edge cases"
  category: string;
  averagePdse: number;            // consistently above this
  taskCount: number;
}

export interface CompensationRule {
  id: string;
  /** The weakness this compensates for. */
  weaknessId: string;
  /** Instruction injected into the system prompt when the task matches. */
  instruction: string;
  /** Task categories this applies to. */
  appliesTo: string[];
  /** Whether the compensation is auto-generated or manually tuned. */
  source: "auto" | "manual";
  /** Effectiveness: how much does this improve PDSE on matching tasks? */
  pdseImpact?: number;
}

/**
 * Task category classifier.
 * Classifies a task description into one or more categories for profile matching.
 */
export function classifyTask(taskDescription: string): string[] {
  // Keyword-based classification with weighted matching.
  // Categories: authentication, database, api, testing, ui, devops,
  //             algorithm, refactoring, documentation, security,
  //             configuration, error_handling, performance, migration
  // A task can belong to multiple categories.
}

/**
 * Generate a compensating instruction from a weakness pattern.
 */
export function generateCompensation(weakness: WeaknessPattern): CompensationRule;
```

### 4.2 — Profile Engine (`danteforge/src/model-profile-engine.ts`)

```typescript
/**
 * Engine that accumulates verification data into model profiles.
 * Called after every DanteForge verification run.
 */
export class ModelProfileEngine {
  private profiles: Map<string, ModelProfile> = new Map();
  private profileDir: string;

  constructor(projectRoot: string);

  /**
   * Record a verification result for a model.
   * Called after every PDSE scoring, anti-stub scan, etc.
   */
  async recordResult(result: {
    modelKey: string;         // "grok:grok-3"
    providerId: string;
    modelId: string;
    taskDescription: string;
    taskCategories: string[]; // from classifyTask()
    pdseScore: number;
    passed: boolean;          // met threshold
    antiStubViolations: number;
    tokensUsed: number;
    retriesNeeded: number;
    gaslightFindings?: string[];
    sevenLevelsRootCause?: {
      level: number;
      domain: string;
      finding: string;
    };
  }): Promise<void>;

  /**
   * Get the profile for a specific model.
   */
  getProfile(modelKey: string): ModelProfile | null;

  /**
   * Get all profiles.
   */
  getAllProfiles(): ModelProfile[];

  /**
   * Get the best model for a task based on profiles.
   * Returns ranked list with scores.
   */
  rankModelsForTask(
    taskDescription: string,
    availableModels: string[],
  ): Array<{
    modelKey: string;
    predictedPdse: number;
    confidence: number;      // how many data points back this prediction
    compensations: string[]; // instructions to inject
    reasoning: string;       // why this ranking
  }>;

  /**
   * Get compensating instructions for a model on a specific task.
   * These are injected into the system prompt to preemptively address known weaknesses.
   */
  getCompensations(modelKey: string, taskCategories: string[]): string[];

  /**
   * Analyze profiles to detect new weakness/strength patterns.
   * Run periodically (e.g., every 50 tasks) to update pattern detection.
   */
  async analyzePatterns(modelKey: string): Promise<{
    newWeaknesses: WeaknessPattern[];
    newStrengths: StrengthPattern[];
    autoCompensations: CompensationRule[];
  }>;

  /**
   * Generate a human-readable profile report.
   */
  generateReport(modelKey: string): string;

  /**
   * Persist profile to disk.
   */
  private async saveProfile(profile: ModelProfile): Promise<void>;

  /**
   * Load profile from disk.
   */
  private async loadProfile(modelKey: string): Promise<ModelProfile | null>;
}
```

### 4.3 — Router Integration (`core/src/model-router.ts`)

Modify the existing `ModelRouterImpl` to consult profiles:

```typescript
// In the route() or selectModel() method:

// CURRENT: capability-based selection
const capable = this.filterByCapability(task, availableModels);

// NEW: profile-enhanced selection
const profileEngine = this.getProfileEngine();
if (profileEngine) {
  const ranked = profileEngine.rankModelsForTask(task.description, capable);
  if (ranked.length > 0 && ranked[0].confidence > 0.5) {
    // Use profile-recommended model
    selectedModel = ranked[0].modelKey;

    // Inject compensating instructions
    const compensations = profileEngine.getCompensations(selectedModel, taskCategories);
    if (compensations.length > 0) {
      task.systemPromptAppend = [
        "## Model-Specific Guidance (from learned profile)",
        ...compensations,
      ].join("\n");
    }
  }
}
```

### 4.4 — CLI Surface

**New slash command: `/profile`**

```
/profile                    — Show current model's profile summary
/profile <model>           — Show specific model's profile
/profile compare           — Side-by-side comparison of all profiled models
/profile report            — Full report with strengths, weaknesses, compensations
/profile weakness <model>  — List known weaknesses for a model
/profile recommend <task>  — Show which model is best for a task description
```

---

## 5. Task Category Classifier

The classifier maps task descriptions to categories. This is the bridge between a task and the profile data.

```typescript
const CATEGORY_PATTERNS: Record<string, RegExp[]> = {
  authentication: [/auth/i, /oauth/i, /login/i, /jwt/i, /session/i, /password/i, /token/i, /sso/i, /saml/i],
  database: [/database/i, /sql/i, /query/i, /migration/i, /schema/i, /orm/i, /prisma/i, /mongo/i, /redis/i],
  api: [/api/i, /endpoint/i, /rest/i, /graphql/i, /grpc/i, /route/i, /middleware/i, /request/i, /response/i],
  testing: [/test/i, /spec/i, /mock/i, /fixture/i, /coverage/i, /assert/i, /vitest/i, /jest/i],
  ui: [/component/i, /react/i, /vue/i, /css/i, /layout/i, /render/i, /style/i, /html/i, /frontend/i],
  devops: [/ci/i, /cd/i, /deploy/i, /docker/i, /kubernetes/i, /pipeline/i, /github.action/i, /workflow/i],
  algorithm: [/algorithm/i, /sort/i, /search/i, /tree/i, /graph/i, /dynamic.programming/i, /optimize/i],
  refactoring: [/refactor/i, /restructure/i, /cleanup/i, /rename/i, /extract/i, /consolidat/i],
  documentation: [/document/i, /readme/i, /comment/i, /jsdoc/i, /explain/i, /describe/i],
  security: [/security/i, /vulnerab/i, /encrypt/i, /sanitiz/i, /xss/i, /injection/i, /csrf/i],
  error_handling: [/error/i, /exception/i, /catch/i, /throw/i, /retry/i, /fallback/i, /recovery/i],
  configuration: [/config/i, /settings/i, /env/i, /yaml/i, /toml/i, /setup/i],
  performance: [/performance/i, /optimize/i, /cache/i, /latency/i, /throughput/i, /memory.leak/i],
  migration: [/migrat/i, /upgrade/i, /convert/i, /port/i, /legacy/i],
};

export function classifyTask(description: string): string[] {
  const categories: string[] = [];
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    const matchCount = patterns.filter(p => p.test(description)).length;
    if (matchCount >= 1) categories.push(category);
  }
  // Default to "general" if no category matched
  return categories.length > 0 ? categories : ["general"];
}
```

---

## 6. Pattern Detection Algorithm

After every N tasks (default: 20), the engine analyzes accumulated data to detect patterns:

```typescript
async analyzePatterns(modelKey: string): Promise<PatternAnalysis> {
  const profile = this.getProfile(modelKey);
  if (!profile || profile.totalTasks < 20) return { newWeaknesses: [], newStrengths: [], autoCompensations: [] };

  const newWeaknesses: WeaknessPattern[] = [];
  const newStrengths: StrengthPattern[] = [];

  for (const [category, stats] of Object.entries(profile.categories)) {
    // Weakness detection: category PDSE consistently below aggregate
    if (stats.taskCount >= 5 && stats.averagePdse < profile.aggregate.averagePdse - 10) {
      const existingWeakness = profile.weaknesses.find(w => w.category === category);
      if (!existingWeakness) {
        newWeaknesses.push({
          id: `w_${modelKey}_${category}_${Date.now()}`,
          description: `Below-average performance on ${category} tasks (avg PDSE: ${stats.averagePdse.toFixed(1)} vs overall ${profile.aggregate.averagePdse.toFixed(1)})`,
          category,
          severity: stats.averagePdse < 70 ? "high" : stats.averagePdse < 80 ? "medium" : "low",
          occurrenceCount: stats.taskCount,
          firstSeen: stats.recentScores[0]?.timestamp ?? new Date().toISOString(),
          lastSeen: stats.recentScores[stats.recentScores.length - 1]?.timestamp ?? new Date().toISOString(),
          compensated: false,
        });
      }
    }

    // Strength detection: category PDSE consistently above aggregate
    if (stats.taskCount >= 5 && stats.averagePdse > profile.aggregate.averagePdse + 5) {
      const existingStrength = profile.strengths.find(s => s.category === category);
      if (!existingStrength) {
        newStrengths.push({
          id: `s_${modelKey}_${category}_${Date.now()}`,
          description: `Excellent performance on ${category} tasks (avg PDSE: ${stats.averagePdse.toFixed(1)})`,
          category,
          averagePdse: stats.averagePdse,
          taskCount: stats.taskCount,
        });
      }
    }
  }

  // Auto-generate compensations for new weaknesses
  const autoCompensations = newWeaknesses.map(w => generateCompensation(w));

  return { newWeaknesses, newStrengths, autoCompensations };
}
```

---

## 7. Persistence

Profiles are stored as JSON files in `.dantecode/model-profiles/`:

```
.dantecode/
└── model-profiles/
    ├── grok_grok-3.json
    ├── anthropic_claude-sonnet-4-20250514.json
    ├── openai_gpt-5.json
    └── ollama_qwen3-coder-8b.json
```

Profiles are project-scoped by default (different projects may have different model behaviors). Global profiles (cross-project) are a future enhancement.

---

## 8. Tests

### `model-profile.test.ts` (~12 tests)

1. `classifyTask("Add JWT authentication")` returns `["authentication"]`
2. `classifyTask("Add OAuth2 login with database session storage")` returns `["authentication", "database"]`
3. `classifyTask("fix the thing")` returns `["general"]` (no pattern match)
4. Profile accumulation: 10 tasks → correct averages computed
5. Category stats update correctly with new data points
6. Trend detection: 5 improving scores → trend is "improving"
7. Trend detection: 5 declining scores → trend is "declining"
8. `rankModelsForTask()` ranks model with higher category PDSE first
9. `rankModelsForTask()` with no profile data returns empty (no guessing)
10. Weakness detection triggers when category PDSE is 10+ below aggregate
11. Strength detection triggers when category PDSE is 5+ above aggregate
12. Auto-compensation generated for detected weakness
13. `getCompensations()` returns relevant instructions for task categories
14. Profile persistence: save → load roundtrip produces identical profile
15. `generateReport()` produces readable output with all sections

---

## 9. Claude Code Execution Instructions

**Two-phase build. ~3-4 hours.**

```
Phase 1: Profile Engine (DanteForge package)
  1. Create packages/danteforge/src/model-profile.ts — types, classifyTask(), generateCompensation()
  2. Create packages/danteforge/src/model-profile-engine.ts — ModelProfileEngine class
  3. Create packages/danteforge/src/model-profile.test.ts — 15 tests
  4. Modify packages/danteforge/src/autoforge.ts — feed results to profile engine after verification
  5. Run: cd packages/danteforge && npx vitest run

Phase 2: Router Integration (Core package)
  6. Modify packages/core/src/model-router.ts — consult profiles in route selection
  7. Add /profile slash command to CLI
  8. Run: npx turbo test
```

**Rules:**
- KiloCode: every file complete, under 500 LOC, no stubs
- Anti-Stub Absolute: zero TODOs, FIXMEs
- TypeScript strict, no `as any`
- Profile engine must handle empty profiles gracefully (new project, no data yet)
- Router must work identically when no profiles exist (backwards compatible)
- Profile files are .gitignored (project-specific data, not committed)

---

## 10. The Flywheel

This is why Model Personality Profiles are a compound moat:

```
DanteForge verifies code
    → failures feed profiles
        → profiles improve routing
            → better routing means fewer failures
                → fewer failures mean less cost
                    → less cost means more usage
                        → more usage means richer profiles
                            → richer profiles mean better routing
                                → (loop forever, getting better)
```

The profiles get more accurate with every task. A profile with 1,000 data points makes better routing decisions than one with 50. This means DanteForge gets better *automatically* over time without any code changes. And the profile data is proprietary — built from your verification runs, specific to your usage patterns.

A competitor can copy the profile data structure. They can't copy the data.

---

## 11. The xAI Play

When you hand xAI a Grok personality profile with 10,000 data points showing: "Grok stubs refresh tokens 40% of the time, Grok's null handling degrades past 3 levels of nesting, Grok excels at test generation but produces 20% more boilerplate than Opus" — that's intelligence they can't get from any benchmark. It's real-world behavioral data from production coding tasks with statistical significance.

That profile is worth more to xAI's model improvement team than a thousand SWE-bench scores because it shows *where* and *how* Grok fails in ways that benchmarks can't capture.

The same is true for every model provider. The profiles become a unique dataset that every provider wants access to. That's leverage.

---

*"Model agnosticism isn't about treating every model the same. It's about learning what makes each one different."*
