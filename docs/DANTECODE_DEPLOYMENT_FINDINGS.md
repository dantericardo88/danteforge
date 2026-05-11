# DanteCode Deployment Findings — Cross-Project Sanitize Scan

> Date: 2026-05-11
> Source: `danteforge sanitize --check --cwd /c/Projects/DanteCode`
> Status: read-only scan, no mutations

## Headline

**DanteCode is already disciplined at the 750 LOC hard limit (0 violations).** 13 files sit between 500–565 LOC (just over the ideal limit, well under hard). Existing discipline is healthy.

This means deploying our sanitize infrastructure to DanteCode is **not a remediation play** — there's no Frankenstein file to split. It's a **prevention play**: agents could push files past 750 LOC during autoforge runs and DanteCode currently has no autonomous catcher.

## Scan Results

### At threshold 750 (hard limit)
```
✓ All files are within the 750 LOC threshold
```

### At threshold 500 (ideal limit)
13 files exceed:

| File | LOC |
|------|-----|
| packages/cli/src/agent-loop-round-followup.ts | 564 |
| packages/core/src/council/round-orchestrator.ts | 559 |
| packages/vscode/src/extension-activate.ts | 558 |
| packages/core/src/model-quality-adaptation.ts | 553 |
| packages/core/src/extensibility-developer-experience.ts | 541 |
| packages/cli/src/agent-loop-helpers-3.ts | 539 |
| packages/cli/src/agent-loop-round-tools.ts | 538 |
| packages/vscode/src/tools/fs-tools.ts | 527 |
| packages/cli/src/agent-loop-helpers-2.ts | 517 |
| packages/cli/src/slash-commands-autoforge.ts | 509 |
| packages/core/src/deployment-environment-intelligence.ts | 507 |
| packages/vscode/src/inline-completion-helpers.ts | 506 |
| packages/vscode/src/ascend-orchestrator.ts | 502 |

None are catastrophic. Each is a candidate for AST-based extraction of types/utilities, but the bloat headroom (~250 LOC each) means deferred cleanup is reasonable.

## What DanteCode Lacks vs DanteForge

| Feature | DanteCode | DanteForge |
|---------|-----------|------------|
| File-size hard gate (CI) | ✅ Yes (assumed — needs verification) | ✅ Yes (`check:file-size`) |
| Autonomous splitter | ❌ No | ✅ `danteforge sanitize` v2 |
| Wave-time auto-fix | ❌ No (grep found 0 hooks) | ✅ Wired into autoforge-loop |
| AST-delta validation | ❌ No | ✅ `validatePostSplit()` |
| Per-file multi-agent locks | ❌ No | ✅ `withFileLock()` |
| Frozen-file deferral | ❌ Unknown | ✅ `loadFrozenFiles()` |

## Recommended Deployment Path

**Phase 0 — Read-only validation (already done):**
- ✅ Run `sanitize --check` on DanteCode → confirmed 0 hard violations

**Phase 1 — Install danteforge as a dev dependency in DanteCode:**
```bash
cd /c/Projects/DanteCode
npm install --save-dev /c/Projects/DanteForge
```
Add to its `package.json` scripts:
```json
"check:sanitize": "danteforge sanitize --check"
```
Wire `check:sanitize` into their `verify` chain.

**Phase 2 — Add wave-time hook to DanteCode's autoforge:**
Mirror what we did in DanteForge's `autoforge-loop.ts` — after each successful wave, call `postWaveSanitize`. Single-line integration:
```typescript
try {
  const { postWaveSanitize } = await import('danteforge/sdk');
  await postWaveSanitize({ cwd });
} catch { /* best-effort */ }
```

**Phase 3 — Port the agent-guard model:**
DanteCode has 504 source files but no obvious frozen-files manifest. Copy DanteForge's pattern:
- `.danteforge/agent-guard.json` with their kernel files frozen
- `.danteforge/agent-ownership.json` mapping their workstreams to file globs
- Run `check-agent-guard.mjs` on every commit

**Phase 4 — Optionally tighten the threshold to 500:**
If they want, lower their hard limit to 500 (matching the ideal). Sanitize would then split the 13 files listed above. Recommend doing this LATER, after Phase 1-3 prove stable.

## Key Insight

The cross-project promise of DanteSanitize is real: it correctly scanned a 504-file monorepo it had never seen before, found exactly the files that exceeded the threshold, and reported them with clean output. **The infrastructure is portable.** What's left is wiring it into DanteCode's existing autoforge pipeline (Phase 2 above), which is a one-day task.
