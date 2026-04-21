# AutoResearch Report: autonomy + selfImprovement score accuracy

**Duration**: ~20 minutes
**Experiments run**: 1
**Kept**: 1 | **Discarded**: 0 | **Crashed**: 0
**Keep rate**: 100%

## Metric Progress

| Dimension | Baseline | Final | Delta |
|-----------|----------|-------|-------|
| autonomy | 6.5 | 9.0 | +2.5 |
| selfImprovement | 6.5 | 10.0 | +3.5 |
| convergenceSelfHealing | 7.0 | 9.0 | +2.0 |
| **Overall score** | **9.0** | **9.4** | **+0.4** |

## Root Cause

The default `score` command was reading autonomy/selfImprovement/convergenceSelfHealing
from STATE.yaml snapshots, which go stale between runs. The --strict flag correctly read
live filesystem evidence (23 verify receipts, 32 retro evidence files, 64 retro sessions,
1582-line lessons.md) and always produced accurate scores — but users had to know to pass
--strict.

## Winning Experiment

### Experiment 1: Always apply strict overrides for evidence-based dimensions

**Hypothesis**: Moving computeStrictDimensions for the three evidence-based dims out of
the `if (options.strict)` guard makes the default score accurate.

**Change**: src/cli/commands/score.ts — always call computeStrictDimensions and apply
its values for autonomy, selfImprovement, convergenceSelfHealing. --strict now only
additionally overrides the remaining 4 dims and enforces automation ceilings.

**Metric delta**: autonomy 6.5→9.0, selfImprovement 6.5→10.0, convergence 7.0→9.0.
Overall: 9.0→9.4.

**Tests**: 16/16 pass. Updated makeOpts in score-command.test.ts to inject _gitLog,
_listDir, _fileExistsStrict stubs. Updated appendScoreHistory assertion to check
recorded score matches actual returned score.

## Why No More Experiments

Remaining P0 items are either excluded (communityAdoption) or LLM-assessed
(enterpriseReadiness, maintainability) — not improveable via code experiments.

## Key Insights

1. STATE.yaml snapshots decay while the project improves. Evidence-based dims should
   always read from the filesystem, not from mutable config.

2. The --strict design was backwards: strict should be the default for dims with
   reliable filesystem signals.

3. Test injection seams must cover all code paths — always inject _gitLog/_listDir/
   _fileExistsStrict stubs in score tests or you get non-deterministic host-fs reads.
