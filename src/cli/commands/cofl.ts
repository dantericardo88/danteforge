// cofl.ts — Competitive Operator Forge Loop CLI command
// 10-phase disciplined system: Universe → Partition → Harvest → Map → Prioritize →
//   Forge → Verify → Score → Persist → Reframe

import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import {
  classifyCompetitorRoles,
  scoreOperatorLeverage,
  runDecisionFilter,
  runAntiFailureGuards,
  runReframePhase,
  computeObjectiveFunction,
  loadCoflRegistry,
  saveCoflRegistry,
  persistCycleLearnings,
  generatePatternId,
  renderPartitionTable,
  renderLeverageTable,
  renderAntiFailureReport,
  renderReframe,
  type CoflPattern,
  type CoflCycleResult,
  type UniversePartition,
  type OperatorLeverageEntry,
} from '../../core/cofl-engine.js';

// ── Options ───────────────────────────────────────────────────────────────────

export interface CoflOptions {
  universe?: boolean;     // Phase 1-2: refresh + partition competitor universe
  harvest?: boolean;      // Phase 3: extract patterns from teacher set
  map?: boolean;          // Phase 4: map patterns to Dante dimensions
  prioritize?: boolean;   // Phase 5: rank opportunities by operator leverage
  report?: boolean;       // Generate COFL_REPORT.md
  auto?: boolean;         // Run all phases in sequence
  dryRun?: boolean;
  json?: boolean;
  guards?: boolean;       // Run anti-failure guardrail check only
  reframe?: boolean;      // Run reframe phase only
}

// ── Injection seams ───────────────────────────────────────────────────────────

export interface CoflOpts {
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
  _isLLMAvailable?: () => Promise<boolean>;
  _callLLM?: typeof callLLM;
  _loadMatrix?: typeof loadMatrix;
  _loadRegistry?: typeof loadCoflRegistry;
  _saveRegistry?: typeof saveCoflRegistry;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _now?: () => string;
  _cwd?: string;
}

// ── LLM-assisted pattern extraction ──────────────────────────────────────────

async function extractPatternsFromTeachers(
  partition: UniversePartition,
  knownGapDimensions: string[],
  callLLMFn: typeof callLLM,
  cwd: string,
): Promise<CoflPattern[]> {
  const teachers = [...partition.referenceTeachers, ...partition.specialistTeachers];
  if (teachers.length === 0) return [];

  const prompt = `You are the DanteForge Competitive Operator Forge Loop pattern extractor.

Teacher set (tools to learn from): ${teachers.join(', ')}
Scoreboard (closed-source leaders to rival): ${partition.directPeers.join(', ')}
Known Dante gaps to address: ${knownGapDimensions.join(', ')}

For each tool in the teacher set, identify the STRONGEST product behavior, UX loop, control surface,
runtime pattern, or trust pattern that DanteForge could adopt as a narrowly-scoped improvement.

Focus on: operator-visible patterns only. Reject patterns that only improve internals.
Each pattern must answer: what would a user SEE or FEEL differently?

Respond with a JSON array of up to 5 patterns:
[
  {
    "sourceCompetitor": "<tool name>",
    "description": "<one sentence: what the pattern is and why it matters to operators>",
    "category": "<product_behavior|ux_loop|control_surface|runtime_pattern|trust_pattern>",
    "patternTruth": "<what this tool does that is worth learning>",
    "affectedDimensions": ["<dim1>", "<dim2>"],
    "operatorOutcome": "<what operator experiences better>",
    "operatorLeverageScore": <0-10>,
    "proofRequirement": "<how we prove this harsh/local/repeatable>",
    "estimatedLift": <0.0-1.0>,
    "implementationScope": "<narrow|medium|broad>"
  }
]`;

  try {
    const response = await callLLMFn(prompt, undefined, { enrichContext: false, cwd });
    const cleaned = response
      .replace(/^```(?:json)?\n?/m, '')
      .replace(/\n?```$/m, '')
      .trim();
    const raw = JSON.parse(cleaned) as Array<Record<string, unknown>>;
    return raw.map(p => ({
      id: generatePatternId(String(p['sourceCompetitor'] ?? ''), String(p['description'] ?? '')),
      sourceCompetitor: String(p['sourceCompetitor'] ?? ''),
      sourceRole: partition.referenceTeachers.includes(String(p['sourceCompetitor'])) ?
        'reference_teacher' : 'specialist_teacher',
      description: String(p['description'] ?? ''),
      category: (p['category'] as CoflPattern['category']) ?? 'product_behavior',
      truth: {
        patternTruth: String(p['patternTruth'] ?? p['description'] ?? ''),
      },
      affectedDimensions: Array.isArray(p['affectedDimensions']) ?
        (p['affectedDimensions'] as string[]) : [],
      operatorOutcome: String(p['operatorOutcome'] ?? ''),
      operatorLeverageScore: Number(p['operatorLeverageScore'] ?? 5),
      proofRequirement: String(p['proofRequirement'] ?? ''),
      estimatedLift: Number(p['estimatedLift'] ?? 0.3),
      implementationScope: (p['implementationScope'] as CoflPattern['implementationScope']) ?? 'narrow',
      status: 'extracted' as const,
      extractedAt: new Date().toISOString(),
    }));
  } catch (err) {
    logger.warn(`Pattern extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ── Report writer ─────────────────────────────────────────────────────────────

function buildCoflReport(
  cycleResult: CoflCycleResult,
  cycleNumber: number,
): string {
  const { partition, extractedPatterns, operatorLeverage, antiFailureChecks, reframe, objectiveFunction } = cycleResult;

  const passedGuards = antiFailureChecks.filter(g => g.passed).length;
  const failedGuards = antiFailureChecks.filter(g => !g.passed);

  const lines: string[] = [
    '# COFL Report — Competitive Operator Forge Loop',
    '',
    `**Cycle**: ${cycleNumber}  `,
    `**Generated**: ${new Date().toISOString()}  `,
    `**Patterns extracted**: ${extractedPatterns.length}  `,
    `**Guardrails**: ${passedGuards}/${antiFailureChecks.length} passed`,
    '',
    '---',
    '',
    renderPartitionTable(partition),
    '',
    '---',
    '',
    renderLeverageTable(operatorLeverage),
    '',
    '---',
    '',
    '## Extracted Patterns',
    '',
  ];

  if (extractedPatterns.length === 0) {
    lines.push('No patterns extracted this cycle. Run `danteforge cofl --harvest` to extract.');
  } else {
    for (const p of extractedPatterns) {
      lines.push(`### ${p.description}`);
      lines.push(`- **Source**: ${p.sourceCompetitor} (${p.sourceRole})`);
      lines.push(`- **Category**: ${p.category}`);
      lines.push(`- **Operator leverage**: ${p.operatorLeverageScore}/10`);
      lines.push(`- **Dimensions**: ${p.affectedDimensions.join(', ')}`);
      lines.push(`- **Proof required**: ${p.proofRequirement}`);
      lines.push(`- **Scope**: ${p.implementationScope}`);
      lines.push(`- **Status**: ${p.status}`);
      lines.push('');
    }
  }

  lines.push('---', '');
  lines.push(renderAntiFailureReport(antiFailureChecks));

  if (failedGuards.length > 0) {
    lines.push('');
    lines.push('### Violated Guardrails — Actions Required');
    for (const g of failedGuards) {
      lines.push(`- [ ] **${g.failureMode}**: ${g.violation}`);
    }
  }

  lines.push('', '---', '');
  lines.push(renderReframe(reframe));

  lines.push('', '---', '');
  lines.push('## Objective Function');
  lines.push('');
  lines.push('```');
  lines.push(`maximize(`);
  lines.push(`  operator_preference_gain:    +${objectiveFunction.operator_preference_gain}`);
  lines.push(`  closed_source_gap_reduction: +${objectiveFunction.closed_source_gap_reduction}`);
  lines.push(`  preserved_governance_moat:   +${objectiveFunction.preserved_governance_moat}`);
  lines.push(`  reusable_product_patterns:    ${objectiveFunction.reusable_product_patterns}`);
  lines.push(`)`);
  lines.push('```');

  lines.push('', '---', '');
  lines.push('## Next Steps');
  lines.push('');
  lines.push('1. Run `danteforge cofl --prioritize` to rank opportunities by leverage');
  lines.push('2. For top opportunity: run `/inferno <goal>` to forge the pattern');
  lines.push('3. After forge: run `danteforge compete --rescore <dim>=<score>` to update matrix');
  lines.push('4. Run `danteforge cofl --reframe` to assess strategic position');
  lines.push('5. Repeat: `danteforge cofl --auto`');

  return lines.join('\n');
}

// ── Phase 3-5: Harvest + Map + Prioritize ────────────────────────────────────

interface LeverageInput {
  id: string; label: string; gap_to_closed_source_leader: number;
  gap_to_oss_leader: number; oss_leader: string; weight: number; frequency: string;
}

interface HarvestResult {
  filteredPatterns: CoflPattern[];
  extractedPatterns: CoflPattern[];
  operatorLeverage: OperatorLeverageEntry[];
}

async function runCoflHarvestAndPrioritize(
  partition: UniversePartition,
  registryPatterns: CoflPattern[],
  knownGapsForHarvest: string[],
  knownGapDimensions: string[],
  leverageInput: LeverageInput[],
  options: CoflOptions,
  isLLMAvailableFn: () => Promise<boolean>,
  callLLMFn: typeof callLLM,
  cwd: string,
): Promise<HarvestResult> {
  let extractedPatterns: CoflPattern[] = [...registryPatterns];
  const newPatterns: CoflPattern[] = [];

  if (options.harvest || options.auto) {
    logger.info('Phase 3: Harvesting patterns from teacher set...');
    const llmOk = await isLLMAvailableFn();
    if (!llmOk) {
      logger.warn('No LLM available — skipping pattern extraction. Run with an LLM configured.');
    } else {
      const freshPatterns = await extractPatternsFromTeachers(partition, knownGapsForHarvest, callLLMFn, cwd);
      newPatterns.push(...freshPatterns);
      extractedPatterns = [...extractedPatterns, ...freshPatterns];
      logger.success(`Extracted ${freshPatterns.length} new pattern(s)`);
    }
    logger.info('');
  }

  const filteredPatterns = newPatterns.filter(p => {
    const r = runDecisionFilter(p, {
      validTeacherRoles: ['reference_teacher', 'specialist_teacher'],
      knownGapDimensions,
      minOperatorLeverage: 3,
    });
    if (!r.passedAll) {
      const failed = r.checks.filter(c => !c.passed).map(c => c.question);
      logger.warn(`Pattern "${p.description.slice(0, 50)}" filtered: ${failed[0]}`);
    }
    return r.passedAll;
  });

  const operatorLeverage: OperatorLeverageEntry[] = scoreOperatorLeverage(leverageInput, partition);

  if (options.prioritize || options.auto) {
    logger.info('Phase 5: Operator Leverage Rankings (top 5)');
    const top5 = [...operatorLeverage].sort((a, b) => b.leverageScore - a.leverageScore).slice(0, 5);
    for (const e of top5) {
      const borrowed = e.borrowableFromOSS ? '[OSS borrowable]' : '';
      logger.info(`  ${e.dimensionLabel.padEnd(24)} leverage=${e.leverageScore.toFixed(2)} ${borrowed}`);
    }
    logger.info('');
  }

  return { filteredPatterns, extractedPatterns, operatorLeverage };
}

// ── Phases 8-10: Score + Persist + Reframe + Summary ─────────────────────────

interface PersistCoflParams {
  cycleNumber: number;
  now: () => string;
  partition: UniversePartition;
  filteredPatterns: CoflPattern[];
  extractedPatterns: CoflPattern[];
  operatorLeverage: OperatorLeverageEntry[];
  scoreDimensions: { id: string; scores: Record<string, number> }[];
  currentScore: number;
  closedSourceGapBefore: number;
  registry: Awaited<ReturnType<typeof loadCoflRegistry>>;
  options: CoflOptions;
  saveRegistryFn: typeof saveCoflRegistry;
  writeFileFn: (p: string, content: string) => Promise<void>;
  cwd: string;
}

async function persistAndSummarizeCoflCycle(params: PersistCoflParams): Promise<CoflCycleResult> {
  const { cycleNumber, now, partition, filteredPatterns, extractedPatterns,
    operatorLeverage, scoreDimensions, currentScore, closedSourceGapBefore,
    registry, options, saveRegistryFn, writeFileFn, cwd } = params;

  const antiFailureChecks = runAntiFailureGuards(extractedPatterns, scoreDimensions, registry);
  const failedGuards = antiFailureChecks.filter(g => !g.passed);
  if (failedGuards.length > 0) {
    logger.warn(`⚠ ${failedGuards.length} anti-failure guardrail(s) violated:`);
    for (const g of failedGuards) logger.warn(`  [${g.failureMode}] ${g.violation}`);
    logger.info('');
  }

  const reframe = runReframePhase(currentScore, currentScore, cycleNumber, operatorLeverage, closedSourceGapBefore, closedSourceGapBefore);
  const objectiveFunction = computeObjectiveFunction(operatorLeverage, extractedPatterns, 0);
  if (options.reframe || options.auto) { logger.info(renderReframe(reframe)); logger.info(''); }
  if (options.guards) { logger.info(renderAntiFailureReport(antiFailureChecks)); logger.info(''); }

  const cycleResult: CoflCycleResult = {
    cycleNumber, completedAt: now(), partition,
    extractedPatterns: filteredPatterns, operatorLeverage, antiFailureChecks,
    reframe, persistedAt: now(), objectiveFunction,
  };
  const updatedRegistry = persistCycleLearnings(cycleResult, registry);
  await saveRegistryFn(updatedRegistry, cwd);

  if (options.report || options.auto) {
    const reportPath = `${cwd}/.danteforge/cofl/COFL_REPORT.md`;
    await writeFileFn(reportPath, buildCoflReport(cycleResult, cycleNumber));
    logger.success(`Report written to: ${reportPath}`);
    logger.info('');
  }

  logger.success('='.repeat(60));
  logger.success('  COFL CYCLE COMPLETE');
  logger.success('='.repeat(60));
  logger.info('');
  logger.info(`Cycle:          ${cycleNumber}`);
  logger.info(`Patterns found: ${filteredPatterns.length}`);
  logger.info(`Guardrails:     ${antiFailureChecks.filter(g => g.passed).length}/${antiFailureChecks.length} passed`);
  logger.info(`Preferred:      ${reframe.becomeMorePreferred ? '✓' : '✗'}`);
  logger.info(`Coherent:       ${reframe.becomeMoreCoherent ? '✓' : '✗'}`);
  logger.info(`Inflating rows: ${reframe.onlyInflatingRows ? '⚠ yes' : '✓ no'}`);
  logger.info('');
  logger.info(`Next: ${reframe.recommendation}`);

  return cycleResult;
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function cofl(
  options: CoflOptions = {},
  _opts: CoflOpts = {},
): Promise<CoflCycleResult | null> {
  let result: CoflCycleResult | null = null;
  await withErrorBoundary('cofl', async () => {
    const cwd = _opts._cwd ?? process.cwd();
    const now = _opts._now ?? (() => new Date().toISOString());
    const loadStateFn = _opts._loadState ?? loadState;
    const saveStateFn = _opts._saveState ?? saveState;
    const isLLMAvailableFn = _opts._isLLMAvailable ?? isLLMAvailable;
    const callLLMFn = _opts._callLLM ?? callLLM;
    const loadMatrixFn = _opts._loadMatrix ?? loadMatrix;
    const loadRegistryFn = _opts._loadRegistry ?? loadCoflRegistry;
    const saveRegistryFn = _opts._saveRegistry ?? saveCoflRegistry;
    const writeFileFn = _opts._writeFile ?? (async (p: string, c: string) => {
      const { writeFile, mkdir } = await import('fs/promises');
      const { dirname } = await import('path');
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, c, 'utf8');
    });

    logger.success('DanteForge COFL — Competitive Operator Forge Loop');
    logger.info('');

    const state = await loadStateFn({ cwd });
    const matrix = await loadMatrixFn(cwd);
    const registry = await loadRegistryFn(cwd);
    const cycleNumber = registry.cyclesRun + 1;

    const closedSource = matrix?.competitors_closed_source ?? [];
    const ossTools = matrix?.competitors_oss ?? [];
    const partition = classifyCompetitorRoles(closedSource, ossTools);

    if (options.universe || options.auto) {
      logger.info('Phase 1-2: Universe + Partition');
      logger.info(renderPartitionTable(partition));
      logger.info('');
    }

    const matrixDimensions = matrix?.dimensions ?? [];
    const knownGapsForHarvest = matrixDimensions.filter(d => (d.gap_to_closed_source_leader ?? 0) > 1).map(d => d.id);
    const knownGapDimensions = matrixDimensions.filter(d => (d.gap_to_closed_source_leader ?? 0) > 0.5).map(d => d.id);
    const leverageInput: LeverageInput[] = matrixDimensions.map(d => ({
      id: d.id, label: d.label,
      gap_to_closed_source_leader: d.gap_to_closed_source_leader ?? (d.gap_to_leader ?? 0),
      gap_to_oss_leader: d.gap_to_oss_leader ?? 0,
      oss_leader: d.oss_leader ?? '', weight: d.weight ?? 1, frequency: d.frequency ?? 'medium',
    }));

    const { filteredPatterns, extractedPatterns, operatorLeverage } = await runCoflHarvestAndPrioritize(
      partition, [...registry.patterns], knownGapsForHarvest, knownGapDimensions,
      leverageInput, options, isLLMAvailableFn, callLLMFn, cwd,
    );

    if (options.auto) {
      const topDim = [...operatorLeverage].sort((a, b) => b.leverageScore - a.leverageScore)[0];
      if (topDim) {
        logger.info(`Phase 6: Top opportunity to forge:`);
        logger.info(`  Dimension: ${topDim.dimensionLabel}`);
        logger.info(`  Operator leverage: ${topDim.leverageScore.toFixed(2)}`);
        logger.info(`  Gap to closed-source leader: ${topDim.gapToClosedSourceLeader.toFixed(1)}`);
        if (topDim.borrowableFromOSS) logger.info(`  OSS borrowable: ✓ (run /inferno to harvest)`);
        logger.info('');
        logger.info('  → Run: danteforge inferno "<goal for this dimension>"');
        logger.info('  → Then: danteforge compete --rescore <dimension>=<score>');
        logger.info('');
      }
    }

    const closedSourceGapBefore = matrixDimensions.reduce((sum, d) => sum + (d.gap_to_closed_source_leader ?? 0), 0) / Math.max(1, matrixDimensions.length);
    const currentScore = matrix?.overallSelfScore ?? 0;
    const scoreDimensions = matrixDimensions.map(d => ({ id: d.id, scores: d.scores ?? {} }));

    const cycleResult = await persistAndSummarizeCoflCycle({
      cycleNumber, now, partition, filteredPatterns, extractedPatterns, operatorLeverage,
      scoreDimensions, currentScore, closedSourceGapBefore,
      registry, options, saveRegistryFn, writeFileFn, cwd,
    });

    state.auditLog.push(`${now()} | cofl: cycle ${cycleNumber} — ${filteredPatterns.length} patterns extracted`);
    await saveStateFn(state, { cwd });

    result = cycleResult;
  });
  return result;
}
