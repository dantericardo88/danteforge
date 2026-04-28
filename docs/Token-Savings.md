# How DanteForge Cuts Your LLM Token Spend by 5-10x

DanteForge is designed around a simple principle: **never send tokens to an LLM that could have been computed locally.** The result is dramatically lower API costs — real users report running 3-4 projects concurrently without hitting credit limits.

This document explains the mechanisms that make this possible and how to verify the Context Economy evidence.

---

## 1. Local-First Artifact Pipeline (Zero-Token Planning)

The core workflow (`constitution → specify → clarify → plan → tasks`) generates structured artifacts **locally, deterministically, with zero LLM calls**:

```bash
danteforge constitution   # writes CONSTITUTION.md — no API call
danteforge specify "..."  # writes SPEC.md — no API call
danteforge clarify        # writes CLARIFY.md — no API call
danteforge plan           # writes PLAN.md — no API call
danteforge tasks          # writes TASKS.md — no API call
```

By the time you hit `forge` (the first command that actually calls an LLM), you have 5 structured artifacts that scope the work precisely. The LLM gets a tight, focused prompt — not a vague "build me an app" that burns thousands of tokens on clarification and iteration.

**Savings**: A typical planning phase produces 5-10 pages of structured artifacts at zero token cost. Without DanteForge, this same scoping work would require 3-5 LLM round-trips at 2,000-5,000 tokens each.

---

## 2. Wave Execution (Scoped Context per Task)

`danteforge forge` doesn't dump your entire project into one massive prompt. It breaks execution into **waves** — each task gets only the context it needs:

- Task name and acceptance criteria
- Relevant file paths (not the whole tree)
- Verification criteria
- Constitutional constraints
- Profile guidance (`budget` / `balanced` / `quality`)

A typical task prompt from `prompt-builder.ts` is **500-2,000 tokens** of focused instruction. Compare this to pasting an entire codebase into ChatGPT (50,000-200,000 tokens) and hoping the LLM figures out what to do.

**Savings**: 10-100x reduction per task vs. whole-codebase prompting.

---

## 3. Three-Mode Execution (Choose Your Token Spend)

Every DanteForge command supports three modes:

| Mode | Token Cost | How It Works |
|------|-----------|--------------|
| **Local** | 0 tokens | Deterministic artifact generation (planning commands) |
| **`--prompt`** | 0 tokens | Generates a copy-paste prompt, saved to `.danteforge/prompts/`. You paste it into any free LLM interface. |
| **LLM API** | Variable | Direct execution via configured provider |

The `--prompt` mode is the secret weapon for budget-conscious work: DanteForge builds the optimal prompt locally, you paste it into Claude.ai or ChatGPT's free tier, and DanteForge imports the result. Zero API cost.

```bash
danteforge specify "Build a photo-sharing app" --prompt
# Saves to .danteforge/prompts/specify-1742390400000.md
# Paste into any LLM, paste result back with:
danteforge import SPEC.md
```

---

## 4. Hard Gates Prevent Wasted Work

Gates block execution **before tokens are spent** on doomed tasks:

- `requireConstitution` — Won't generate specs without principles defined
- `requireSpec` — Won't plan without a spec
- `requirePlan` — Won't execute without a plan
- `requireTests` — Won't write code without tests (when TDD enabled)
- `requireDesign` — Won't generate UI code without a validated `.op` file

Without gates, a common failure mode is: LLM generates 5,000 tokens of code → review reveals the requirements were wrong → throw it away → regenerate. With gates, you catch requirement gaps at the planning stage (zero tokens) instead of the execution stage (thousands of tokens).

**Savings**: Eliminates the "build it wrong, tear it down, rebuild" cycle that typically wastes 2-3x the token budget.

---

## 5. Progressive Context Injection (Smart Token Budgeting)

The `context-injector.ts` module maintains a strict **4,000-token budget** for injected context. Instead of dumping all project history into every prompt, it uses a three-tier priority system:

| Tier | Priority | Content |
|------|----------|---------|
| **Tier 1** | Always included | Error corrections, critical lessons |
| **Tier 2** | If budget allows | Recent decisions and insights |
| **Tier 3** | If budget allows | Historical command summaries |

Each tier is progressively included only if the token budget has room. The injector also performs **keyword extraction** from the current prompt to search memory for relevant entries — not all entries.

**Savings**: Fixed 4,000-token ceiling vs. unbounded context accumulation that can bloat prompts to 50,000+ tokens over a long session.

---

## 6. Context Rot Detection (Kill Bloated Sessions)

The `context-rot.ts` hook monitors accumulated context size and warns before it becomes expensive:

- **>120,000 tokens**: "Context getting large — consider wrapping up current wave"
- **>180,000 tokens**: "CONTEXT ROT DETECTED — fresh context recommended"

This prevents the common failure mode where a long coding session accumulates so much context that every subsequent LLM call costs 10-50x more than it should. DanteForge nudges you to start a fresh wave instead of letting context bloat silently drain your budget.

---

## 7. Self-Improving Lessons (Never Pay for the Same Mistake Twice)

The lessons system (`lessons.md`) captures corrections and failures, then injects them into future prompts via the context injector. When the LLM makes a mistake:

1. The correction is recorded: `[CORRECTION] Use ESM imports, not CommonJS`
2. On the next `forge` run, this correction is injected as Tier 1 context
3. The LLM doesn't repeat the mistake → no wasted tokens on wrong output → no re-generation

Over time, the lessons file becomes a per-project optimization cache. The LLM gets smarter about your project without you paying for it to re-learn patterns on every session.

---

## 8. Context Economy Runtime (RTK-Inspired, Evidence-Backed)

DanteForge now routes live shell/test/typecheck output through `src/core/context-economy/runtime.ts` before that output is eligible for LLM repair prompts or MCP artifact context. The runtime is inspired by RTK's context economy pattern, credited as an MIT source in `THIRD_PARTY_NOTICES.md`, but DanteForge does not depend on RTK or Rust.

The public facade is:

```ts
filterShellResult({ command, stdout, stderr, cwd, organ })
getEconomizedArtifactForContext({ path, type, cwd })
scoreContextEconomy(cwd)
```

Key safety rules:

- `stdout` and `stderr` are filtered independently.
- Sacred content is byte-preserved for failures, stack traces, warnings, security findings, policy violations, gate failures, and rejected patches.
- Raw artifacts stay canonical on disk. Compression is used for context-entry views and includes a raw-content hash.
- Every live filter decision writes JSONL evidence under `.danteforge/evidence/context-economy/`.

Verify the evidence with:

```bash
danteforge economy --json
danteforge economy --since 2026-04-26 --fail-below 70
```

The `--fail-below` gate checks the Context Economy score, not average savings percent, so a project cannot claim enterprise adoption from one high-savings sample or from file presence alone.

---

## 9. AutoForge Scoring (Targeted Execution, Not Full Rebuilds)

The autoforge system uses PDSE (artifact quality scoring) to identify **exactly which artifacts need work**. Instead of re-running the entire pipeline:

- `--score-only` pass evaluates all artifacts (zero LLM tokens)
- Only artifacts below the quality threshold are targeted for improvement
- Per-artifact retry counters prevent infinite loops on stuck items
- Circuit breaker halts after 3 consecutive failures

**Savings**: A mature project with 8 artifacts might only need 1-2 improved per autoforge cycle, not all 8. That's a 4-8x reduction in per-cycle token spend.

---

## Cost Comparison: With vs. Without DanteForge

| Scenario | Without DanteForge | With DanteForge | Savings |
|----------|--------------------|-----------------|---------|
| Initial project scoping | 5 LLM round-trips (~15K tokens) | 0 tokens (local artifacts) | **100%** |
| Building a 5-task feature | ~100K tokens (whole-codebase prompts) | ~10K tokens (scoped waves) | **90%** |
| Fixing a wrong requirement | Regenerate all code (~50K tokens) | Gate catches it at plan stage (0 tokens) | **100%** |
| Long coding session (2+ hours) | Context bloat → 200K+ token prompts | Context rot warning → fresh 5K token prompt | **95%+** |
| Repeated pattern mistake | Re-learn every session (~5K tokens each) | Lessons injection (~100 tokens) | **98%** |

---

## Profile System: Budget Control Per Wave

The `--profile` flag gives explicit control over token spend per execution wave:

| Profile | Behavior | Typical Token Cost |
|---------|----------|--------------------|
| `budget` | Fast, minimal, functional | Lowest — terse prompts, fewer verification steps |
| `balanced` | Default — good code with reasonable cost | Medium |
| `quality` | Thorough, tested, documented | Highest — includes verification and documentation passes |

```bash
danteforge forge 1 --profile budget    # minimize spend
danteforge forge 1 --profile quality   # maximize quality when it matters
```

---

## The Bottom Line

DanteForge doesn't just make LLM-powered development faster — it makes it **economically sustainable for solo founders and small teams**. The combination of local-first planning, scoped execution, hard gates, context management, and self-improving lessons means you can run multiple concurrent projects without burning through API credits.

The token estimator (`token-estimator.ts`) even warns you before expensive calls:

```
⚠ Estimated cost for this call: ~$0.0234 (7,800 tokens, claude)
```

No surprises. No silent budget drain. Just structured, efficient agentic development.
