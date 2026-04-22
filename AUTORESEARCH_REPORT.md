# AutoResearch Report: measure P0 recommendation specificity

**Duration**: ~45 minutes
**Experiments run**: 3 (+ 1 polish cleanup)
**Kept**: 3 | **Discarded**: 0 | **Crashed**: 0
**Keep rate**: 100%

---

## Metric Progress

- **Baseline**: 0/9 — all 3 P0 items fully generic (no file paths, functions, or targeted commands)
- **Final**: 9/9 — every P0 item has file path + line number + targeted `danteforge ascend --dim X` command
- **Total improvement**: +9 (from 0 to perfect)

### What the metric measured

For each of the top 3 P0 items in `danteforge measure` output, scored 0-3:
- +1 if it names a specific file path (e.g., `src/core/ascend-engine.ts`)
- +1 if it names a specific line number or function (e.g., `:347`)
- +1 if the action command is targeted (not generic `danteforge improve "X"`)

Max score: 9

---

## Winning Experiments (in order applied)

| # | Description | Metric Delta | Commit |
|---|-------------|-------------|--------|
| 1 | Added `buildDimEvidence()` — scans for large functions (>100 LOC) and names worst file | 0→1 | 9822447 |
| 2 | Added line numbers + signals for functionality + errorHandling | 1→5 | b83f798 |
| 3 | Added `:line` to errorHandling, replaced generic improve with `ascend --dim X` | 5→9 | e23cda8 |

---

## Before vs After

**Before:**
```
P0 gaps:
1. Maintainability       8.2/10  — risky to change — modifications break other things
                         → danteforge improve "maintainability"
2. Functionality         8.8/10  — core features are missing, incomplete, or unreliable
                         → danteforge improve "missing core features"
3. Error Handling        9.5/10  — code crashes or shows confusing errors when things go wrong
                         → danteforge improve "error handling"
```

**After:**
```
P0 gaps:
1. Maintainability       8.2/10  — risky to change — modifications break other things
                           ↳ 37 large fns >100 LOC — src/core/ascend-engine.ts:347 (509 lines)
                         → danteforge ascend --dim maintainability
2. Functionality         8.8/10  — core features are missing, incomplete, or unreliable
                           ↳ largest fn without tests: src/core/ascend-engine.ts:347 (509 lines)
                         → danteforge ascend --dim functionality
3. Error Handling        9.5/10  — code crashes or shows confusing errors when things go wrong
                           ↳ low try/catch ratio in: src/harvested/openpencil/executors/modify-executors.ts:5 (0 try / 42 fns)
                         → danteforge ascend --dim errorHandling
```

---

## Technical Implementation

**New code in `src/cli/commands/score.ts`**:
- `findLargeFunctions(srcDir, threshold)` — walks src/ for TS files, finds function blocks >N LOC with line numbers
- `extractFunctionBlocks(src)` — brace-depth parser returning `{ loc, name, line }` per function
- `buildDimEvidence(dim, cwd, harshResult)` — dimension-specific evidence builder:
  - `maintainability`: finds functions >100 LOC (exact signal from maturity-engine), names worst file + line
  - `functionality`: prefers unwired modules → stubs → largest function without tests
  - `errorHandling`: finds files with high function count but low try/catch ratio, with line number
  - `testing`/`security`: surfaces existing penalty evidence from HarshScoreResult
- P0 rendering updated: parallel `buildDimEvidence` calls, ↳ evidence line, targeted command when evidence exists

**Key design decision**: When file-specific evidence is available, replace generic `danteforge improve "X"` with `danteforge ascend --dim X` — directly naming the tool that optimizes that dimension.

---

## Notable Failures

None — 100% keep rate. Each experiment built directly on the previous.

---

## Key Insights

1. **Static text is the enemy of actionability.** `DIMENSION_HUMAN_TEXT` and `DIMENSION_ACTIONS` were fully static. Adding a dynamic evidence layer that scans the codebase was the key lever.

2. **Line numbers are the highest-leverage specificity signal.** `src/core/ascend-engine.ts:347` is immediately clickable in VS Code/editors. This converts "go look at maintainability" into "open this file, go to this line."

3. **Targeted commands reduce friction.** `danteforge ascend --dim maintainability` names the exact tool for improvement. Generic `improve` leaves users guessing which command actually helps.

4. **The harsh-scorer already collects evidence — it just didn't surface it.** `stubsDetected`, `penalties[].evidence`, and `unwiredModules` in `HarshScoreResult` could power richer P0 output. For clean projects, additional scans fill the gap.

---

## Suggestions for Future Runs

- **Function name extraction**: The brace-counting parser struggles with template literals. TypeScript compiler API would yield real function names instead of falling back to line numbers only.
- **Coverage-linked evidence**: Cross-reference large functions against `.danteforge/evidence/coverage-summary.json` to name specifically uncovered code paths.
- **Regression guard**: Add a test that runs `score()` and verifies P0 evidence contains `src/` paths — prevents future changes from reverting to generic output.

---

## Full Results Log

```
experiment	metric_value	status	description
baseline	0	keep	all 3 P0 items generic — no file paths, function names, or targeted commands
exp1-file-evidence	1	keep	maintainability names largest file: src/core/ascend-engine.ts (38 large fns)
exp2-line-numbers	5	keep	all 3 items have file paths, items 1+2 have :line numbers
exp3-targeted-cmds	9	keep	all 3 items: file path + line number + danteforge ascend --dim X — perfect 9/9
```
