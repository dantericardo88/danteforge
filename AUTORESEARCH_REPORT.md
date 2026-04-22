# AutoResearch Report: reduce large function count

**Goal:** Get large functions (>100 LOC, AST-accurate) below 25
**Metric:** `90 - current_count` (higher = better)
**Branch:** `autoresearch/reduce-large-fn-count`

---

## Metric Progress
- **Baseline:** 90 large functions (metric = 0)
- **Final:** 23 large functions (metric = 67)
- **Total improvement:** 67 points (74.4% reduction in large functions)

---

## Winning Experiments (in order applied)

| Experiment | Description | Fn Count | Metric |
|------------|-------------|----------|--------|
| baseline | unmodified baseline | 90 | 0 |
| exp01 | agent-dag buildDagMaps + self-scorer buildDossierDimensions | 88 | 2 |
| exp02 | report/spend-optimizer/wiki-linter/magic-presets extractions | 84 | 6 |
| exp03 | scorePerformance, buildTasksPrompt, loadCritiqueContext | 81 | 9 |
| exp04 | showConfigStatus, computePlanningPhase | 79 | 11 |
| exp05 | buildRepairCycles, printScoreSummary, buildEvidenceBundle | 76 | 14 |
| exp06 | buildMissingArtifactResult, applyReplaceOp | 74 | 16 |
| exp07 | scoreFoundArtifacts, buildColdStartPlan, buildMultiSessionResumePlan | 72 | 18 |
| exp08 | buildExternalSummary, renderWikiSection, renderMetricGrid | 70 | 20 |
| exp09 | persistDesignArtifact, runDesignLintCheck, cloneAndLicenseGate | 68 | 22 |
| exp10 | printDefaultHelp, buildAdoptionPrompt | 66 | 24 |
| exp11 | handleNewProject, askImprovementChoice | 65 | 25 |
| exp12 | runMagicPlanStepPipeline/Support, runMaturityGuidedAutoforge | 63 | 27 |
| exp13 | mergePatternIntoLibrary, absorbRefusedPatterns, applyArtifactHandoff | 61 | 29 |
| exp14 | hoisted ZSH_CMD_ENTRIES to module level | 60 | 30 |
| exp15 | handleLessonCorrection extracted from lessons | 59 | 31 |
| exp16 | showFirstRunCTA, runCompetitorScan, runFeatureUniverseAssessment | 58 | 32 |
| exp17 | logSprintGaps, buildHarvestBriefPrompt, displayCoflOperatorPanel | 57 | 33 |
| exp18 | runHarvestSteps, persistHarvestTrack from harvest | 56 | 34 |
| exp19-29 | 11 more single-function extractions across diverse modules | 40 | 45 |
| exp30 | executeCycleActions + runSelfImproveLoop from selfImprove | 39 | 51 |
| exp31 | runCoflHarvestAndPrioritize + persistAndSummarizeCoflCycle from cofl | 38 | 52 |
| exp32 | loadLibraryPatterns + runWave1QueuePopulation + runDeepHarvestLoop from ossIntel | 37 | 53 |
| exp33 | helpers from score.ts + review.ts | 35 | 55 |
| exp34-37 | scoreEvidence, BOOTSTRAP_*_MAP constants, generateAndDisplayUXPrompt, installNativeSkills | 31 | 59 |
| exp38 | ENTERPRISE_FEATURES const, assembleBenchmarkResult+buildDanteForgePrompt, awaitAgentProcess, handleCallSuccess | 27 | 63 |
| exp39 | collectAllConcerns, formatPatternsSectionLines, writeHarvestReportFiles, consumeBlockComment | 23 | **67** |

---

## Key Insights

- **Module-level const extraction** is the easiest technique for data-heavy functions (lookup tables, feature configs, label maps). Zero logic change, instant size reduction.
- **Sequential extraction strategy**: for 200L+ functions, plan both extractions before implementing — the first extracted helper can itself exceed 100L.
- **Parameter passing**: context objects/interfaces avoid parameter explosion when extracting from functions with many local variables.
- **TypeScript strict mode discipline**: every extraction required reading types before writing helpers to avoid incorrect annotations.
- **Remaining 23 large functions** are genuinely complex: runAscend (513L), runAutoforgeLoop (408L), verify (380L), harvestForge (375L), runMagicPreset (372L), autoResearch (312L), ossDeep (262L), computeHarshScore (275L), computeStrictDimensions (215L), executeAutoForgePlan (213L). Further reduction requires more invasive refactoring.

---

## Full Results Log

See `results.tsv` for complete experiment history.
