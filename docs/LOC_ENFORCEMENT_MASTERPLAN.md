# LOC Enforcement Masterplan — Frankenstein File Defense (v2 shipped)

> **Goal:** Make it much harder for any file to exceed 750 LOC during agentic workflows. Three independent gates — prompt-time, wave-time, commit-time — each acts as a defense layer.
>
> **Status:** v2 architecture (Hybrid AST + LLM) is shipped. Sprints 1, 2, 3, 5, 6, 7, 10 are complete; Sprints 4, 8, 9 deferred to a future pass.

---

## Status — What Is And Isn't Verified (post-v2)

| Claim | Status |
|-------|--------|
| `danteforge sanitize` v2 compiles, typechecks, lints | ✅ Verified |
| 104+ tests pass (boundary, ast-mover, validators, locks, retention, auto-sanitize, engine, splitter) | ✅ Verified |
| `--dry-run` correctly scans + lists violators | ✅ Verified on DanteForge |
| `--check` mode (exits 1 on violation, no edits) | ✅ Wired and unit-tested |
| `--undo` restores from .bak | ✅ Unit-tested |
| Tier 1 AST mover handles types/interfaces/enums/functions deterministically | ✅ Unit-tested |
| Tier 2 LLM fallback fires when AST refuses | ✅ Wired |
| AST-delta validation catches dropped/invented symbols | ✅ Unit-tested |
| Per-file locks prevent multi-agent races (15-min TTL stale-reclaim) | ✅ Unit-tested |
| Frozen files defer to platform-kernel workstream | ✅ Wired |
| Wave-time hook integrated into autoforge-loop | ✅ Wired (best-effort, never blocks) |
| **Live LLM split (real call → real file rewrite → typecheck passes)** | ❌ Deferred to Sprint 4 (opt-in, requires API key) |
| **SWE Atlas Decomposition benchmark** | ❌ Deferred to Sprint 9 |
| **Cost guardrails (token budget per session)** | ❌ Deferred to Sprint 8 |

---

## OSS Reference Table

| Tool | Solves splitting? | What we learned |
|------|------------------|-----------------|
| **ts-morph** | Partial (AST) | `sourceFile.move()` rewires every relative import. Foundation for v2 Tier 2. |
| **tsserver `moveToFileRefactoring`** | YES | LSP backbone for v2 Tier 1. Microsoft's import-rewiring inherited free. |
| **Aider repo-map** | No | PageRank algorithm reapplied intra-file = boundary-selection oracle. |
| **Continue.dev** | No | AST chunk fallback ladder (whole-file → top-level decls → recursive). |
| **SWE Atlas Decomposition** | Benchmark | TS slice frontier: 48.57%. v2 target: 70%+. |

---

## Context

### What we already have
- `docs/AGENT_BLOAT_PREVENTION_SYSTEM.md` — multi-agent operating contract (frozen files, ownership, claims)
- `.danteforge/agent-guard.json` — size config (`warn: 500`, `hard: 750`), frozen files, allowlist
- `.danteforge/agent-ownership.json` — workstream → file map
- `scripts/check-agent-guard.mjs` — pre-commit enforcement
- `scripts/check-file-size.mjs` — CI hard gate (fails on >750 LOC, no allowlist)
- `src/core/file-size-hygiene.ts` — `inspectSourceFileSizes()`, `countMaintainableLoc()`
- **NEW:** `danteforge sanitize` — autonomous file splitter with two-step LLM, backup/revert, retry-on-typecheck-failure

### The gap
Today, the system **detects** bloat (CI fails on >750 LOC) but does **not auto-fix** it. When agents run `autoforge` or `ascend` for 20 cycles, files grow. CI eventually rejects the PR, the agent has to manually split the file, lose context, retry. Worse: when N agents work on N dimensions in parallel, they hammer the same files between checks.

### The fix
Make every workflow command **pre-flight** scan for violations and **post-flight** auto-sanitize before committing. Bloat never reaches CI because it's prevented at the source.

---

## Architecture: The Three-Layer Defense

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: PROMPT-TIME PREVENTION                            │
│  Every LLM forge prompt includes the LOC budget +           │
│  extraction patterns. Prevents bloat at generation.         │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: WAVE-TIME ENFORCEMENT                             │
│  After each forge wave, scan touched files. If any crossed  │
│  threshold, auto-run `sanitize --pattern <file>` before     │
│  the next wave. Prevents cumulative bloat.                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: COMMIT-TIME GATE                                  │
│  check-agent-guard.mjs (already exists) + sanitize --check  │
│  (NEW) block any commit that introduces >750 LOC files.     │
│  Hard gate; no bypass.                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Sprint 1 — Layer 1: Prompt-Time Prevention

### Goal
Every LLM call that writes or refactors code includes an explicit LOC budget reminder + split-pattern guidance.

### Changes

**`src/core/prompt-builder.ts`** — Extend `buildTaskPrompt()` to inject a fixed footer:

```typescript
const LOC_BUDGET_FOOTER = `

LOC BUDGET (HARD CONSTRAINT):
- Every TypeScript file you write or modify MUST stay under 500 LOC ideal / 750 LOC hard cap.
- If a change would push a file past 500 LOC, split before adding:
  - Types/interfaces  → {stem}-types.ts
  - Pure utilities    → {stem}-utils.ts
  - Helpers           → {stem}-helpers.ts
  - Constants         → {stem}-config.ts
- The original file keeps only the primary export / orchestration logic.
- New file imports use .js extensions (ESM).
`;
```

**Affected callers:** `forge`, `autoforge`, `magic`, `ascend`, `party` all flow through `buildTaskPrompt()` — single point of injection.

### Tests
- `tests/prompt-builder.test.ts` — assert every task prompt contains "LOC BUDGET" and "500 LOC ideal / 750 LOC hard cap"

### Effort: ~30 LOC, 1 test file

---

## Sprint 2 — Layer 2: Wave-Time Enforcement

### Goal
After each forge wave (autoforge cycle, ascend cycle, magic preset), scan only the files that were touched. If any exceed 750 LOC, run sanitize on them before the next wave.

### Changes

**`src/core/autoforge-loop.ts`** — Add `_autoSanitize` injection seam + post-wave check:

```typescript
export interface AutoforgeLoopDeps {
  // ... existing fields
  _autoSanitize?: (cwd: string, files: string[]) => Promise<void>;
}

// After the existing _timeMachineCommit block (~line 476):
if (execResult.success) {
  // ── LOC enforcement: scan touched files, sanitize violations ────────────
  try {
    const touchedFiles = await getTouchedFilesSinceLastCommit(cwd);
    const oversized = await filterOversizedFiles(touchedFiles, cwd);
    if (oversized.length > 0) {
      const sanitizeFn = deps._autoSanitize ?? (async (c, files) => {
        const { runSanitize } = await import('./sanitize-engine.js');
        for (const file of files) {
          await runSanitize({ cwd: c, pattern: file, yes: true, maxCycles: 3 });
        }
      });
      await sanitizeFn(cwd, oversized);
      logger.info(`[Autoforge] Auto-sanitized ${oversized.length} file(s) before next wave`);
    }
  } catch { /* best-effort */ }
}
```

**`src/core/ascend-engine.ts`** — Same hook after `rescoreAndGetDelta()`:

```typescript
// After updateDimensionScore() ~line 870
if (options.autoSanitize !== false) {
  await runSanitizeIfNeeded(cwd, { yes: true, maxCycles: 3 });
}
```

**`src/cli/commands/magic.ts`** + magic presets — already wrap autoforge so they inherit the wave-time gate for free.

**`src/cli/commands/party.ts`** — Party mode runs agents in parallel; each lane runs its own wave-time check on its claimed files only (multi-agent safety).

### New helper: `src/core/auto-sanitize.ts` (~80 LOC)

```typescript
export async function getTouchedFilesSinceLastCommit(cwd: string): Promise<string[]>;
export async function filterOversizedFiles(files: string[], cwd: string): Promise<string[]>;
export async function runSanitizeIfNeeded(cwd: string, opts?: SanitizeEngineOptions): Promise<boolean>;
```

### Tests
- `tests/auto-sanitize.test.ts` — assert `filterOversizedFiles` returns only files >750 LOC
- Extend `tests/autoforge-loop.test.ts` — `_autoSanitize` is called when a touched file crosses threshold, NOT called when files stay under

### Effort: ~80 LOC helper + 50 LOC engine integration + 30 LOC tests

---

## Sprint 3 — Layer 3: Commit-Time Gate

### Goal
Add `sanitize --check` mode that exits non-zero if violations exist. Wire into pre-commit chain alongside `check-agent-guard.mjs`.

### Changes

**`src/cli/commands/sanitize.ts`** — Add `--check` flag (read-only mode):

```typescript
export interface SanitizeOptions extends SanitizeEngineOptions {
  check?: boolean;  // exit 0 if clean, exit 1 if violations (no edits)
}

// In the action:
if (options.check) {
  const queue = await buildQueue(cwd, threshold);
  if (queue.length > 0) {
    logger.error(`[Sanitize] ${queue.length} file(s) over ${threshold} LOC.`);
    for (const item of queue) logger.error(`  ${item.path} (${item.loc} LOC)`);
    process.exitCode = 1;
    return;
  }
  logger.success('[Sanitize] All files within budget.');
}
```

**`package.json`** — Add scripts:

```json
{
  "scripts": {
    "check:sanitize": "node dist/index.js sanitize --check",
    "verify": "npm run typecheck && npm run lint && npm run check:anti-stub && npm run check:sanitize && npm test"
  }
}
```

**`.husky/pre-commit`** (if exists) — Append `npm run check:sanitize` after existing checks.

### Tests
- `tests/sanitize-engine.test.ts` — `runSanitize({ check: true })` returns `success: false` when violations exist, no files written

### Effort: ~30 LOC + script wiring

---

## Sprint 4 — Multi-Agent Coordination Update

### Goal
Update `.danteforge/agent-guard.json` and `agent-ownership.json` so sanitize works safely when multiple agents are running.

### Changes

**`.danteforge/agent-guard.json`** — Add `sanitize` block:

```json
{
  "sanitize": {
    "enabled": true,
    "autoFixOnForge": true,
    "autoFixOnAscend": true,
    "checkOnCommit": true,
    "respectFrozenFiles": true,
    "maxCyclesPerWave": 3,
    "skipPatterns": ["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts"]
  }
}
```

**Behavior changes:**
- When `respectFrozenFiles: true`, sanitize refuses to split frozen files (listed in `frozenFiles[]`). Surface a warning instead.
- When `autoFixOnForge: true`, autoforge-loop calls sanitize after each successful wave.
- A separate "platform-kernel" workstream is required to sanitize frozen files (see [AGENT_BLOAT_PREVENTION_SYSTEM.md §Platform-Kernel Changes](AGENT_BLOAT_PREVENTION_SYSTEM.md)).

**`.danteforge/agent-ownership.json`** — Add `platform-kernel` workstream:

```json
{
  "platform-kernel": {
    "ownedFiles": ["src/cli/index.ts", "src/core/autoforge-loop.ts", "src/core/ascend-engine.ts", "src/core/harsh-scorer.ts"],
    "purpose": "Adds extension points and splits frozen files. NEVER adds business logic.",
    "canRunSanitize": true
  }
}
```

**`docs/AGENT_BLOAT_PREVENTION_SYSTEM.md`** — Update "Workflow Command Requirements" section:

```markdown
- `/autoforge`: runs `sanitize` after each successful wave (auto-fix on non-frozen files).
- `/ascend`: runs `sanitize` after each dimension cycle. Frozen files require platform-kernel claim.
- `/inferno`: Sprint 0 may include platform-kernel sanitize; later sprints stay in owned modules.
- `/magic`: inherits autoforge's post-wave sanitize.
- `/party`: each lane runs sanitize on its claimed files only (no cross-lane edits).
```

### Effort: 3 JSON edits + 1 doc edit, no code

---

## Sprint 5 — Prompt-Wave Integration into `/inferno` and `/magic`

### Goal
These two presets are the highest-power LLM workflows; they need explicit LOC discipline in their preamble.

### Changes

**`src/cli/commands/magic.ts`** — In every preset (spark, ember, canvas, blaze, nova, inferno), add a pre-flight check:

```typescript
async function runMagicWithPreset(preset: MagicPreset, ...): Promise<void> {
  // ── PRE-FLIGHT: sanitize-check ──────────────────────────────────────────
  const { runSanitize } = await import('../../core/sanitize-engine.js');
  const dryResult = await runSanitize({ cwd, dryRun: true });
  if (dryResult.remainingViolations > 0) {
    logger.warn(`[${preset}] ${dryResult.remainingViolations} file(s) over LOC budget. Running sanitize first...`);
    await runSanitize({ cwd, yes: true, maxCycles: 10 });
  }
  // ... continue with normal preset execution
}
```

**`.claude-plugin/commands/inferno.md`** — Update slash command description:

```markdown
/inferno runs the highest-power workflow. It will:
1. Sanitize any oversized files before starting (auto-split via LLM).
2. Run a multi-wave forge with adversarial scoring.
3. Auto-sanitize after each wave to prevent bloat.
4. Run full verify at the end.
```

### Effort: ~30 LOC integration + 1 markdown update

---

## Sprint 6 — Telemetry and Reporting

### Goal
Track how often sanitize fires, how many splits happen, which files repeatedly bloat (signals for refactoring).

### Changes

**`.danteforge/sanitize/telemetry.jsonl`** — Append on every sanitize run:

```json
{"ts": "...", "trigger": "autoforge-wave-12", "filesScanned": 47, "violations": 2, "splits": 2, "skipped": 0, "durationMs": 8234}
```

**`src/cli/commands/sanitize.ts`** — Add `--report` flag that prints aggregate stats:

```
DanteSanitize 30-day report
─────────────────────────────
Total runs:           142
Auto-triggered:       138 (from autoforge/ascend)
Manual runs:            4
Total splits:          61
Recurring offenders:
  src/core/x.ts        3 splits
  src/core/y.ts        2 splits
Avg duration:         6.2s
```

### Effort: ~80 LOC

---

## Execution Order

| # | Sprint | Effort | Unblocks |
|---|--------|--------|----------|
| 1 | Prompt-Time Prevention | 30 LOC | All other layers benefit |
| 2 | Wave-Time Enforcement | 130 LOC | Autoforge/ascend stop producing bloat |
| 3 | Commit-Time Gate | 30 LOC | CI safety net |
| 4 | Multi-Agent Coordination | 0 LOC (config only) | Parallel agents safe |
| 5 | /inferno + /magic Integration | 30 LOC | High-power workflows clean |
| 6 | Telemetry | 80 LOC | Visibility into bloat patterns |

**Total new code:** ~300 LOC across 4 files + 6 test cases. No file exceeds 200 LOC.

---

## Affected Files Summary

| File | Change Type | LOC Delta |
|------|-------------|-----------|
| `src/core/prompt-builder.ts` | extend | +20 |
| `src/core/auto-sanitize.ts` | NEW | +80 |
| `src/core/autoforge-loop.ts` | extend (hook only) | +25 |
| `src/core/ascend-engine.ts` | extend (hook only) | +15 |
| `src/cli/commands/sanitize.ts` | add `--check` and `--report` flags | +70 |
| `src/cli/commands/magic.ts` | pre-flight injection | +15 |
| `package.json` | add `check:sanitize` script | +1 |
| `.danteforge/agent-guard.json` | add `sanitize` block | +9 |
| `.danteforge/agent-ownership.json` | add `platform-kernel` workstream | +5 |
| `docs/AGENT_BLOAT_PREVENTION_SYSTEM.md` | update workflow requirements | +8 |
| `tests/auto-sanitize.test.ts` | NEW | +60 |
| `tests/prompt-builder.test.ts` | extend | +10 |
| `tests/sanitize-engine.test.ts` | extend (check mode) | +15 |
| `.claude-plugin/commands/inferno.md` | update description | +5 |

**Critical invariant:** every file above stays under 500 LOC after these changes. This plan is self-enforcing.

---

## Verification

```bash
# 1. Pre-flight: clean baseline
danteforge sanitize --check                # exits 0 — baseline is already clean

# 2. Simulate bloat-prone workflow
danteforge autoforge --goal "..." --waves 10
# → autoforge-loop's wave-time hook fires sanitize on any touched-file violations
# → CI never sees the violation

# 3. Multi-agent test
# Terminal 1:  danteforge ascend --target 9.5    (workstream: scoring)
# Terminal 2:  danteforge party --lane workflow  (workstream: workflow-commands)
# → Each lane sanitizes its own files; no cross-lane edits
# → check-agent-guard.mjs blocks any violation that slips through

# 4. CI gate
npm run verify                              # includes check:sanitize
# → fails with clear message if any file >750 LOC
```

---

## Open Questions (decide before Sprint 2)

1. **Sanitize granularity:** scan ALL touched files per wave, or only files the LLM explicitly edited (via diff parsing)?
   - **Recommendation:** ALL touched files (simpler, safer). Diff parsing has edge cases.

2. **Failure behavior:** if sanitize fails mid-wave (e.g., LLM down), continue wave or pause?
   - **Recommendation:** continue, log warning, retry on next wave. Sanitize is non-load-bearing for the forge logic itself.

3. **Frozen file violations:** if a frozen file crosses 750 LOC during autoforge, autoforge cannot fix it (frozen!). What's the escape valve?
   - **Recommendation:** autoforge logs CRITICAL warning, writes `.danteforge/sanitize/platform-kernel-needed.json`, continues. A separate platform-kernel sprint addresses it.

---

## Connection to Existing Work

This masterplan EXTENDS, not replaces:

- [`AGENT_BLOAT_PREVENTION_SYSTEM.md`](AGENT_BLOAT_PREVENTION_SYSTEM.md) — the contract for multi-agent coordination remains authoritative
- [`.danteforge/agent-guard.json`](../.danteforge/agent-guard.json) — adds a `sanitize` block to the existing schema
- [`scripts/check-agent-guard.mjs`](../scripts/check-agent-guard.mjs) — continues to enforce ownership/frozen files at commit time
- `danteforge sanitize` (already shipped) — provides the autonomous splitter that the loops call

The new pieces are:
- The **wave-time hook** in autoforge-loop and ascend-engine
- The **prompt-budget reminder** in prompt-builder
- The **`--check` mode** in sanitize CLI

Together, the three layers (prompt → wave → commit) make it significantly harder for the codebase to drift past 750 LOC during normal agentic operation. The LLM can still emit >750 LOC output in a single wave; the wave-time hook catches it on the *next* iteration, and the commit-time gate stops it from reaching main. No layer is bulletproof in isolation — defense in depth is the design.
