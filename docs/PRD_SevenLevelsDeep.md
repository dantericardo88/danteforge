# DanteForge: 7 Levels Deep — Root Cause Analysis Engine PRD

## Document Control

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Codename** | Deep Root |
| **Author** | Council of Minds (Claude Opus + Ricky) |
| **License** | PROPRIETARY — DanteForge IP |
| **Target Package** | `@dantecode/danteforge` (existing) |
| **Branch** | `feat/dantecode-9plus-complete-matrix` |
| **Methodology origin** | Millionaire Success Habits "7 Levels Deep" — adapted from motivational root-cause discovery to engineering verification |

---

## 1. The Problem

When DanteForge verification fails — PDSE below threshold, anti-stub violation, constitution breach — the current response is: reject and retry. The model gets a message like "PDSE score 72, below threshold of 85. Fix the issues and try again." The model tries again, sometimes fixing the surface symptom, sometimes not.

This is the equivalent of a doctor treating a headache with aspirin without asking why the patient has a headache. It works sometimes. It's never the right answer.

Every verification failure has a root cause. The root cause is almost never "the code is bad." It's upstream — in the prompt, the context assembly, the skill decomposition, the model selection, or the architectural decision that preceded the code generation. Fixing the code without finding the root cause means the same class of failure will recur on the next task.

**7 Levels Deep forces DanteForge to ask "why" seven times on every significant verification failure, drilling from symptom to root cause.** Each level peels back one layer of causation until the fundamental truth is exposed. The fix at Level 7 is almost always different — and more valuable — than the fix at Level 1.

---

## 2. The Methodology

### Origin

From Dean Graziosi's "Millionaire Success Habits" — the 7 Levels Deep exercise asks "why" repeatedly to move past surface motivations to fundamental truths. Applied to engineering verification:

### The 7 Levels

| Level | Question | Domain |
|---|---|---|
| 1 | **What failed?** | Symptom identification — the PDSE score, the anti-stub hit, the constitution violation |
| 2 | **Why did it fail?** | Code-level cause — missing error handling, incomplete implementation, wrong pattern |
| 3 | **Why was the code wrong?** | Model-level cause — model hallucinated, model doesn't know this API, model chose wrong abstraction |
| 4 | **Why did the model make that mistake?** | Context-level cause — insufficient context, missing documentation, ambiguous requirement |
| 5 | **Why was the context insufficient?** | System-level cause — skill decomposition missed a dependency, wave planner didn't classify correctly, repo map didn't surface relevant files |
| 6 | **Why did the system miss that?** | Architecture-level cause — the system doesn't have a mechanism for X, the pipeline has a blind spot at Y |
| 7 | **What fundamental assumption is wrong?** | Root truth — the deepest cause that, if fixed, prevents this entire class of failure |

### Example Walkthrough

```
Task: "Add OAuth2 authentication to the Express API"
Failure: PDSE score 68 — incomplete implementation

Level 1 — What failed?
  Token refresh endpoint returns hardcoded success. Anti-stub violation.

Level 2 — Why did it fail?
  The model generated the refresh endpoint as a stub with a TODO comment.

Level 3 — Why was the code wrong?
  The model didn't understand the token rotation requirements for OAuth2 PKCE flow.

Level 4 — Why did the model make that mistake?
  The system prompt included "add OAuth2" but didn't specify PKCE vs Authorization Code
  vs Client Credentials. The model guessed and got it partially right.

Level 5 — Why was the context insufficient?
  The skill decomposition treated "OAuth2" as a single atomic task instead of
  decomposing it into: (1) flow selection, (2) token endpoint, (3) refresh logic,
  (4) PKCE verifier, (5) session management.

Level 6 — Why did the system miss that?
  The wave planner's skill decomposition doesn't have domain knowledge about OAuth2
  subtask structure. It treats all authentication as a single wave.

Level 7 — What fundamental assumption is wrong?
  The wave planner assumes authentication is a single-skill task. In reality,
  authentication protocols are multi-step state machines that need per-step
  decomposition. The fix isn't "rewrite the OAuth2 code" — it's "teach the
  wave planner that authentication tasks need protocol-aware decomposition."
```

**The Level 7 fix prevents every future authentication task from having the same failure class.** The Level 1 fix (rewrite the stub) only fixes this one instance.

---

## 3. Architecture

### Where It Lives

```
packages/danteforge/src/
├── seven-levels.ts          ← NEW: 7 Levels Deep analysis engine
├── seven-levels.test.ts     ← NEW: tests
├── autoforge.ts             ← MODIFIED: integrate 7LD into retry loop
└── lessons.ts               ← MODIFIED: store Level 7 findings as lessons
```

### Integration Points

1. **Autoforge retry loop** — When a verification failure triggers a retry, run 7 Levels Deep analysis BEFORE retrying. Feed the Level 7 finding into the retry prompt so the model fixes the root cause, not the symptom.

2. **Lessons system** — Level 7 findings are stored as lessons with the tag `root_cause`. These lessons are recalled on future tasks that match the same domain (e.g., all future authentication tasks recall the OAuth2 decomposition lesson).

3. **Model Personality Profiles** (from companion PRD) — Levels 3-4 (model-level causes) feed directly into the model's personality profile. "Grok tends to stub OAuth2 refresh endpoints" becomes a statistical pattern.

4. **Skillbook ACE loop** — Level 5-6 findings (system-level causes) feed into skill improvement. If the wave planner has a blind spot, the Skillbook records it and the next wave planning session includes the correction.

---

## 4. Component Specification

### 4.1 — SevenLevelsEngine (`danteforge/src/seven-levels.ts`)

```typescript
/**
 * 7 Levels Deep — Root Cause Analysis Engine
 *
 * When DanteForge verification fails, this engine drives a structured
 * "ask why 7 times" analysis to find the root cause. Each level peels
 * back one layer of causation, from symptom to fundamental truth.
 *
 * The engine uses the LLM itself to perform the analysis — it's asking
 * the model to introspect on why its own output failed. The structured
 * levels prevent the model from giving shallow answers ("I'll try harder")
 * and force genuine causal reasoning.
 */

export interface LevelAnalysis {
  level: number;           // 1-7
  question: string;        // The "why" question for this level
  answer: string;          // The model's analysis
  domain: LevelDomain;     // Classification of this level's finding
  confidence: number;      // 0-1, how confident the analysis is
  actionable: boolean;     // Whether this level's finding suggests a concrete fix
}

export type LevelDomain =
  | "symptom"         // Level 1: what failed
  | "code"            // Level 2: code-level cause
  | "model"           // Level 3: model-level cause
  | "context"         // Level 4: context/prompt cause
  | "system"          // Level 5: system pipeline cause
  | "architecture"    // Level 6: architectural blind spot
  | "root_truth";     // Level 7: fundamental assumption

export interface SevenLevelsResult {
  taskDescription: string;
  failureType: string;           // "pdse_below_threshold" | "antistub_violation" | "constitution_breach"
  failureDetails: string;        // The specific failure message
  levels: LevelAnalysis[];       // All 7 levels (or fewer if root found earlier)
  rootCause: string;             // The Level 7 (or deepest) finding
  rootCauseDomain: LevelDomain;  // Which domain the root cause lives in
  suggestedFix: string;          // Concrete fix based on deepest finding
  lessonForFuture: string;       // Generalized lesson for the lessons system
  modelAttribution?: string;     // Which model produced the failed output (for personality profiles)
  depthReached: number;          // How many levels deep we actually went (3-7)
}

export interface SevenLevelsConfig {
  /** Minimum depth to analyze. Default: 3 (always go at least 3 deep). */
  minDepth?: number;
  /** Maximum depth. Default: 7. */
  maxDepth?: number;
  /** Stop early if a clearly actionable root cause is found. Default: true. */
  earlyStop?: boolean;
  /** Confidence threshold to accept a level's analysis. Default: 0.6. */
  confidenceThreshold?: number;
  /** The model to use for analysis. Defaults to the session's current model. */
  analysisModel?: string;
}

export class SevenLevelsEngine {
  constructor(config?: SevenLevelsConfig);

  /**
   * Run 7 Levels Deep analysis on a verification failure.
   *
   * @param failure - The verification failure to analyze
   * @param context - The task context (prompt, generated code, verification results)
   * @returns Structured analysis with root cause and suggested fix
   */
  async analyze(
    failure: {
      type: string;
      details: string;
      pdseScore?: number;
      violations?: string[];
    },
    context: {
      taskDescription: string;
      generatedCode: string;
      systemPrompt: string;
      modelId: string;
      providerId: string;
      waveState?: unknown;
      skillsUsed?: string[];
    },
  ): Promise<SevenLevelsResult>;

  /**
   * Build the prompt for a specific level of analysis.
   * Each level's prompt includes the findings from all previous levels.
   */
  private buildLevelPrompt(
    level: number,
    previousLevels: LevelAnalysis[],
    failure: { type: string; details: string },
    context: { taskDescription: string; generatedCode: string },
  ): string;

  /**
   * Classify which domain a level's finding belongs to.
   */
  private classifyDomain(level: number, answer: string): LevelDomain;

  /**
   * Determine if analysis should stop early (clear root cause found).
   */
  private shouldStopEarly(level: LevelAnalysis): boolean;

  /**
   * Extract a generalized lesson from the root cause finding.
   * The lesson should be applicable to future tasks in the same domain,
   * not specific to this one instance.
   */
  private extractLesson(result: SevenLevelsResult): string;
}
```

### 4.2 — Level Prompt Templates

The key to making this work is the prompt structure for each level. The model must be guided to go deeper, not just rephrase the previous answer.

```typescript
const LEVEL_PROMPTS: Record<number, string> = {
  1: `You are analyzing a DanteForge verification failure.

TASK: {taskDescription}
FAILURE: {failureType} — {failureDetails}
CODE (relevant section): {codeSnippet}

Level 1 — WHAT FAILED?
Identify the specific symptom. What exactly is wrong with the output?
Be precise: name the function, the line, the missing piece.
Do NOT suggest fixes yet. Only diagnose the symptom.`,

  2: `Previous analysis:
Level 1 (Symptom): {level1Answer}

Level 2 — WHY DID THE CODE FAIL?
Go deeper than the symptom. Why is this specific piece of code wrong?
What coding mistake or misunderstanding produced this symptom?
Focus on the code-level cause, not the model or the system.`,

  3: `Previous analysis:
Level 1: {level1Answer}
Level 2: {level2Answer}

Level 3 — WHY DID THE MODEL MAKE THIS MISTAKE?
This is about the model's reasoning, not the code. Why did the AI model
produce this incorrect code? What did it misunderstand, hallucinate,
or fail to consider? What knowledge gap does this reveal?`,

  4: `Previous analysis:
Levels 1-3: {previousSummary}

Level 4 — WHY DID THE MODEL LACK THIS KNOWLEDGE?
Look at the context the model was given. Was the system prompt insufficient?
Was the task description ambiguous? Was relevant documentation missing?
Was the wrong model selected for this task type?
Focus on what the SYSTEM provided to the model, not the model itself.`,

  5: `Previous analysis:
Levels 1-4: {previousSummary}

Level 5 — WHY WAS THE CONTEXT INSUFFICIENT?
Look at the pipeline that assembled the context. Did skill decomposition
miss a subtask? Did the wave planner classify incorrectly? Did the repo
map fail to surface relevant files? Did memory recall miss a relevant lesson?
Focus on the SYSTEM PIPELINE, not the context itself.`,

  6: `Previous analysis:
Levels 1-5: {previousSummary}

Level 6 — WHY DOES THE SYSTEM HAVE THIS BLIND SPOT?
Now we're at the architectural level. What mechanism is missing from
DanteCode's architecture that would have prevented this? What assumption
in the system design led to this pipeline gap?`,

  7: `Previous analysis:
Levels 1-6: {previousSummary}

Level 7 — WHAT FUNDAMENTAL ASSUMPTION IS WRONG?
This is the deepest level. What belief or assumption — about the task domain,
about how models work, about how code should be structured — is fundamentally
incorrect? If you could fix ONE thing that would prevent this ENTIRE CLASS
of failures (not just this instance), what would it be?

Your answer should be a general principle, not a specific code fix.`,
};
```

### 4.3 — Integration with Autoforge Retry Loop

**File:** `packages/danteforge/src/autoforge.ts`

In the existing retry loop, when a verification failure occurs and a retry is planned:

```typescript
// BEFORE (current behavior):
// "Your output failed PDSE with score 72. Fix the following issues: ..."

// AFTER (with 7 Levels Deep):
const sevenLevels = new SevenLevelsEngine({ minDepth: 3, earlyStop: true });
const analysis = await sevenLevels.analyze(
  { type: "pdse_below_threshold", details: pdseReport, pdseScore: 72 },
  { taskDescription, generatedCode, systemPrompt, modelId, providerId },
);

// Feed the ROOT CAUSE into the retry prompt, not just the symptoms
const retryPrompt = `Your previous output failed verification.

Surface issue: ${analysis.levels[0].answer}
Root cause (${analysis.rootCauseDomain}): ${analysis.rootCause}
Suggested approach: ${analysis.suggestedFix}

Fix the root cause, not just the symptom. The surface issue will resolve
when the underlying problem is addressed.`;

// Store the lesson for future tasks
await recordLesson({
  category: "root_cause",
  domain: analysis.rootCauseDomain,
  lesson: analysis.lessonForFuture,
  modelId: analysis.modelAttribution,
  taskPattern: extractTaskPattern(taskDescription),
});
```

### 4.4 — Integration with Lessons System

**File:** `packages/danteforge/src/lessons.ts`

Level 7 findings become first-class lessons tagged with `root_cause` and the domain they affect:

```typescript
// New lesson type
interface RootCauseLesson {
  category: "root_cause";
  domain: LevelDomain;        // "system" | "architecture" | "model" | etc.
  lesson: string;              // The generalized finding
  modelId?: string;            // Which model this applies to (for personality profiles)
  taskPattern: string;         // Pattern matcher for future task recall
  occurrenceCount: number;     // How many times this root cause has been found
  firstSeen: string;           // ISO timestamp
  lastSeen: string;
}
```

When `queryLessons()` is called for a new task, root cause lessons matching the task pattern are included in the system prompt:

```typescript
// In formatLessonsForPrompt():
const rootCauseLessons = lessons.filter(l => l.category === "root_cause");
if (rootCauseLessons.length > 0) {
  prompt += "\n## Root Cause Lessons (from 7 Levels Deep analysis)\n";
  for (const lesson of rootCauseLessons) {
    prompt += `- [${lesson.domain}] ${lesson.lesson} (seen ${lesson.occurrenceCount}x)\n`;
  }
}
```

---

## 5. Configuration

In `.dantecode/STATE.yaml`:

```yaml
danteforge:
  sevenLevels:
    enabled: true
    minDepth: 3          # Always go at least 3 levels deep
    maxDepth: 7          # Full depth
    earlyStop: true      # Stop if clear root cause found
    triggerThreshold: 80 # Only run 7LD when PDSE is below this (skip for minor issues)
    analysisModel: null  # null = use current model; or specify e.g. "anthropic:claude-sonnet-4-20250514"
```

The `triggerThreshold` is important — you don't want to run a 7-level analysis on every minor formatting issue. Only when the failure is significant enough to warrant deep investigation.

---

## 6. Tests

### `seven-levels.test.ts` (~15 tests)

1. Analysis with clear Level 3 root cause stops early (earlyStop: true)
2. Analysis reaches all 7 levels when earlyStop is false
3. Each level's prompt includes all previous levels' findings
4. Domain classification: Level 1 → "symptom", Level 7 → "root_truth"
5. Lesson extraction produces generalized (not instance-specific) lesson
6. Model attribution is captured when modelId is provided
7. Config minDepth: 5 forces at least 5 levels even if Level 3 is actionable
8. Config maxDepth: 3 stops at 3 even if root cause not found
9. Empty code snippet doesn't crash
10. Very long code is truncated to prevent prompt overflow
11. Integration: analyze() → result feeds into retry prompt correctly
12. Integration: result.lessonForFuture is stored via recordLesson()
13. triggerThreshold: score 82 with threshold 80 → analysis NOT triggered
14. triggerThreshold: score 72 with threshold 80 → analysis triggered
15. Confidence below threshold flags the level as uncertain

---

## 7. Performance Budget

7 Levels Deep runs an additional LLM call per level (up to 7). This is expensive. Mitigations:

- **earlyStop** reduces average depth to ~4 levels
- **triggerThreshold** ensures it only runs on significant failures (~20% of retries)
- **Use a cheaper model** for analysis (Sonnet instead of Opus) via `analysisModel` config
- **Cache lessons** so the same root cause isn't re-analyzed

Expected cost: ~500-2000 additional tokens per level, 2000-14000 tokens per full analysis. At typical API pricing, $0.01-0.10 per analysis. Cheap compared to the cost of repeated blind retries.

---

## 8. Claude Code Execution Instructions

**Single-phase build. ~2-3 hours.**

```
1. Create packages/danteforge/src/seven-levels.ts — engine per section 4.1-4.2
2. Create packages/danteforge/src/seven-levels.test.ts — 15 tests per section 6
3. Modify packages/danteforge/src/autoforge.ts — integrate 7LD into retry loop per section 4.3
4. Modify packages/danteforge/src/lessons.ts — add root_cause lesson type per section 4.4
5. Run: cd packages/danteforge && npx vitest run
6. Verify: all existing tests pass (0 regressions), new tests pass
```

**Rules:**
- KiloCode: every file complete, under 500 LOC, no stubs
- Anti-Stub Absolute: zero TODOs, FIXMEs
- TypeScript strict, no `as any`
- PDSE ≥ 85 on all new and modified files
- The LLM calls in analyze() should use the existing model router from `@dantecode/core`

---

## 9. Success Criteria

| Criteria | Target |
|---|---|
| Analysis reaches meaningful root cause | Depth ≥ 3 on all runs |
| Root cause lessons recalled on matching future tasks | 100% |
| Retry success rate improvement (root-cause-informed vs blind retry) | Measurable improvement (track before/after) |
| Performance overhead | < 15 seconds per analysis |
| Existing autoforge tests | 0 regressions |

---

## 10. Why This Is a Moat

Every competitor does retry loops. "Your code failed, try again." Some add the error message. Some add the test output. Nobody asks WHY seven times.

The lessons accumulated by 7 Levels Deep over hundreds of runs become a proprietary knowledge base of root causes — "authentication tasks need protocol-aware decomposition," "Grok's null handling degrades past 3 levels of nesting," "missing API docs cause 40% of context-level failures." That knowledge base is the moat. It can't be copied because it's built from your specific verification data across your specific usage patterns. It gets more valuable with every run.

---

*"Ask why. Then ask why again. The seventh answer is the one that changes everything."*
