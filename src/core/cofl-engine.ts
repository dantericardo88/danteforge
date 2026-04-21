// cofl-engine.ts — Competitive Operator Forge Loop core engine
// Implements the 10-phase loop from docs/OperatorCompLoop.md:
// Universe → Partition → Harvest → Map → Prioritize → Forge → Verify → Score → Persist → Reframe

import fs from 'fs/promises';
import path from 'path';

// ── Role taxonomy ─────────────────────────────────────────────────────────────

export type CompetitorRole =
  | 'direct_peer'        // closed-source tools we must beat in operator experience
  | 'specialist_teacher' // tools with local ceilings we borrow from
  | 'reference_teacher'; // OSS tools we learn patterns from

// ── Pattern taxonomy ──────────────────────────────────────────────────────────

export type PatternCategory =
  | 'product_behavior'
  | 'ux_loop'
  | 'control_surface'
  | 'runtime_pattern'
  | 'trust_pattern';

// ── Three layers of truth ─────────────────────────────────────────────────────

export interface TruthLayers {
  patternTruth: string;     // "This tool does something worth learning from"
  capabilityTruth?: string; // "Dante now actually does it"
  marketTruth?: string;     // "Users would prefer Dante more because of it"
}

// ── Core data types ───────────────────────────────────────────────────────────

export interface CoflPattern {
  id: string;
  sourceCompetitor: string;
  sourceRole: CompetitorRole;
  description: string;
  category: PatternCategory;
  truth: TruthLayers;
  affectedDimensions: string[];
  operatorOutcome: string;
  operatorLeverageScore: number;     // 0-10
  proofRequirement: string;
  estimatedLift: number;             // 0-1
  implementationScope: 'narrow' | 'medium' | 'broad';
  status: 'extracted' | 'mapped' | 'forged' | 'verified';
  extractedAt: string;
  forgedAt?: string;
  verifiedAt?: string;
}

export interface UniversePartition {
  directPeers: string[];       // scoreboard: closed-source tools we must rival
  specialistTeachers: string[]; // borrow targets: tools with local expertise ceilings
  referenceTeachers: string[];  // OSS tools we learn patterns from
}

export interface OperatorLeverageEntry {
  dimensionId: string;
  dimensionLabel: string;
  gapToClosedSourceLeader: number;
  gapToOSSLeader: number;
  borrowableFromOSS: boolean;
  operatorVisibleLift: number;   // 0-10, how visible to operators
  implementationCost: number;    // 0-10 (lower = cheaper)
  proofable: boolean;
  leverageScore: number;         // primary ranking signal
}

export interface DecisionCheck {
  question: string;
  passed: boolean;
  reason?: string;
}

export interface DecisionRuleResult {
  passedAll: boolean;
  checks: DecisionCheck[];
}

export interface AntiFailureCheck {
  failureMode: string;
  guardrail: string;
  passed: boolean;
  violation?: string;
}

export interface ReframeAssessment {
  becomeMorePreferred: boolean;
  becomeMoreCoherent: boolean;
  onlyInflatingRows: boolean;
  preferenceGainDelta: number;
  coherenceDelta: number;
  objectiveFunctionValue: number;
  recommendation: string;
}

export interface CoflObjectiveFunction {
  operator_preference_gain: number;
  closed_source_gap_reduction: number;
  preserved_governance_moat: number;
  reusable_product_patterns: number;
}

export interface CoflCycleResult {
  cycleNumber: number;
  completedAt: string;
  partition: UniversePartition;
  extractedPatterns: CoflPattern[];
  operatorLeverage: OperatorLeverageEntry[];
  antiFailureChecks: AntiFailureCheck[];
  reframe: ReframeAssessment;
  persistedAt: string;
  objectiveFunction: CoflObjectiveFunction;
}

export interface CoflRegistry {
  version: '1.0.0';
  cyclesRun: number;
  partition: UniversePartition;
  patterns: CoflPattern[];
  lessons: string[];
  gapMap: Record<string, string[]>;  // dimensionId → pattern ids
  strategyNotes: string[];
  lastCycleAt: string;
  updatedAt: string;
}

// ── Known OSS tools (reference + specialist teachers) ─────────────────────────

const KNOWN_REFERENCE_TEACHERS = new Set([
  'Aider', 'Continue', 'Continue.dev', 'OpenHands', 'SWE-Agent', 'MetaGPT',
  'GPT-Engineer', 'AutoGen', 'CrewAI', 'LangChain', 'Cline', 'Goose',
  'Tabby', 'CodeGeeX', 'FauxPilot', 'Ollama', 'OpenDevin', 'AgentCoder',
  'Plandex', 'Zed', 'OpenCopilot',
]);

// Specialists have local ceilings but teach specific patterns
const KNOWN_SPECIALIST_TEACHERS = new Set([
  'CodiumAI', 'Qodo', 'CodeRabbit', 'Swimm', 'Sourcegraph', 'Tabnine',
  'AskCodi', 'Bito',
]);

// Direct peers are closed-source market leaders
const KNOWN_DIRECT_PEERS = new Set([
  'Cursor', 'Devin', 'Copilot', 'GitHub Copilot', 'Claude Code',
  'Copilot Workspace', 'Kiro', 'Codex CLI', 'Gemini CLI', 'Replit Agent',
  'Zencoder',
]);

// ── Phase: Universe partition ─────────────────────────────────────────────────

export function classifyCompetitorRoles(
  closedSource: string[],
  ossTools: string[],
): UniversePartition {
  const directPeers: string[] = [];
  const specialistTeachers: string[] = [];
  const referenceTeachers: string[] = [];

  for (const tool of closedSource) {
    directPeers.push(tool);
  }

  for (const tool of ossTools) {
    const normalized = tool.trim();
    if (KNOWN_SPECIALIST_TEACHERS.has(normalized)) {
      specialistTeachers.push(normalized);
    } else if (KNOWN_REFERENCE_TEACHERS.has(normalized) || !KNOWN_DIRECT_PEERS.has(normalized)) {
      referenceTeachers.push(normalized);
    } else {
      directPeers.push(normalized); // OSS peer that's also a market leader
    }
  }

  return { directPeers, specialistTeachers, referenceTeachers };
}

// ── Phase: Operator leverage scoring ─────────────────────────────────────────

export function scoreOperatorLeverage(
  dimensions: Array<{
    id: string;
    label: string;
    gap_to_closed_source_leader: number;
    gap_to_oss_leader: number;
    oss_leader: string;
    weight: number;
    frequency: string;
  }>,
  partition: UniversePartition,
): OperatorLeverageEntry[] {
  return dimensions.map(dim => {
    const borrowable = partition.referenceTeachers.includes(dim.oss_leader) ||
      partition.specialistTeachers.includes(dim.oss_leader);

    const freqMultiplier = dim.frequency === 'high' ? 1.5
      : dim.frequency === 'medium' ? 1.0 : 0.5;

    // Operator visibility: weighted gap × frequency — measures user-facing impact
    const operatorVisibleLift = Math.min(10,
      dim.gap_to_closed_source_leader * dim.weight * freqMultiplier);

    // Implementation cost proxy: broader gaps tend to cost more
    const implementationCost = Math.min(10, dim.gap_to_oss_leader * 2);

    // Core leverage formula: prefer operator-visible gains over internal elegance
    const leverageScore =
      (operatorVisibleLift * 0.5) +
      (dim.gap_to_closed_source_leader * 0.3) +
      ((borrowable ? 2 : 0)) +
      ((10 - implementationCost) * 0.1);

    return {
      dimensionId: dim.id,
      dimensionLabel: dim.label,
      gapToClosedSourceLeader: dim.gap_to_closed_source_leader,
      gapToOSSLeader: dim.gap_to_oss_leader,
      borrowableFromOSS: borrowable,
      operatorVisibleLift,
      implementationCost,
      proofable: dim.gap_to_oss_leader < 5, // wide gaps are harder to prove quickly
      leverageScore: Math.round(leverageScore * 100) / 100,
    };
  });
}

// ── Phase: Decision rule filter ───────────────────────────────────────────────

export function runDecisionFilter(
  pattern: Pick<CoflPattern, 'sourceRole' | 'operatorLeverageScore' | 'affectedDimensions' | 'proofRequirement' | 'implementationScope'>,
  context: {
    validTeacherRoles: CompetitorRole[];
    knownGapDimensions: string[];
    minOperatorLeverage?: number;
  },
): DecisionRuleResult {
  const minLeverage = context.minOperatorLeverage ?? 3;
  const checks: DecisionCheck[] = [
    {
      question: 'Does it come from a tool we actually want to learn from?',
      passed: context.validTeacherRoles.includes(pattern.sourceRole),
      reason: `source role: ${pattern.sourceRole}`,
    },
    {
      question: 'Does it improve operator preference, not just architecture?',
      passed: pattern.operatorLeverageScore >= minLeverage,
      reason: `operator leverage: ${pattern.operatorLeverageScore}/${minLeverage}`,
    },
    {
      question: 'Does it map to a real Dante gap?',
      passed: pattern.affectedDimensions.some(d => context.knownGapDimensions.includes(d)),
      reason: `affected dims: ${pattern.affectedDimensions.join(', ')}`,
    },
    {
      question: 'Can we prove it harshly?',
      passed: pattern.proofRequirement.length > 10,
      reason: `proof: ${pattern.proofRequirement.slice(0, 60)}`,
    },
    {
      question: 'Does it strengthen Dante\'s own identity?',
      passed: pattern.implementationScope !== 'broad',
      reason: `scope: ${pattern.implementationScope} (broad risks cargo-culting)`,
    },
  ];

  return { passedAll: checks.every(c => c.passed), checks };
}

// ── Phase: Anti-failure guardrails ────────────────────────────────────────────

const ANTI_FAILURE_RULES: Array<{
  failureMode: string;
  guardrail: string;
  check: (
    patterns: CoflPattern[],
    dims: Array<{ id: string; scores: Record<string, number> }>,
    registry: CoflRegistry,
  ) => { passed: boolean; violation?: string };
}> = [
  {
    failureMode: 'Drifting back to coding-agent comparisons only',
    guardrail: 'Registry must preserve operator-first peers',
    check: (_p, _d, registry) => {
      const hasOperatorPeers = registry.partition.directPeers.length > 0;
      return {
        passed: hasOperatorPeers,
        violation: hasOperatorPeers ? undefined :
          'No direct operator peers in registry — add closed-source leaders',
      };
    },
  },
  {
    failureMode: 'Harvesting patterns without shipping them',
    guardrail: 'Every pattern must map to a forgeable task',
    check: (patterns) => {
      const unmapped = patterns.filter(p => p.affectedDimensions.length === 0 && p.status === 'extracted');
      return {
        passed: unmapped.length === 0,
        violation: unmapped.length > 0 ?
          `${unmapped.length} pattern(s) extracted but not mapped to dimensions` : undefined,
      };
    },
  },
  {
    failureMode: 'Inflating scores via tests',
    guardrail: 'Market-adjusted reading stays separate from raw matrix',
    check: (_p, dims) => {
      // Check for suspiciously high self-scores that lack evidence
      const inflated = dims.filter(d => (d.scores['self'] ?? 0) > 8.5 && (d.scores['dantescode'] ?? 0) > 8.5);
      return {
        passed: inflated.length < dims.length * 0.5,
        violation: inflated.length >= dims.length * 0.5 ?
          'Over 50% of dimensions score >8.5 — possible inflation, run --validate' : undefined,
      };
    },
  },
  {
    failureMode: 'Cargo-culting OSS tools',
    guardrail: 'Extract patterns, not branding or architecture wholesale',
    check: (patterns) => {
      const broadScope = patterns.filter(p => p.implementationScope === 'broad' && p.status !== 'verified');
      return {
        passed: broadScope.length < 3,
        violation: broadScope.length >= 3 ?
          `${broadScope.length} broad-scope patterns pending — risk of cargo-culting` : undefined,
      };
    },
  },
  {
    failureMode: 'Building internals instead of product',
    guardrail: 'Product filter required before prioritization',
    check: (patterns) => {
      const lowLeverage = patterns.filter(p => p.operatorLeverageScore < 3 && p.status === 'extracted');
      return {
        passed: patterns.length === 0 || lowLeverage.length < patterns.length * 0.4,
        violation: lowLeverage.length >= patterns.length * 0.4 ?
          'Too many low-leverage patterns — apply product filter before forging' : undefined,
      };
    },
  },
  {
    failureMode: 'Forgetting past competitors',
    guardrail: 'Canonical registry is the source of truth',
    check: (_p, _d, registry) => {
      const total = registry.partition.directPeers.length +
        registry.partition.specialistTeachers.length +
        registry.partition.referenceTeachers.length;
      return {
        passed: total >= 3,
        violation: total < 3 ?
          'Registry has fewer than 3 classified competitors — run cofl --universe to refresh' : undefined,
      };
    },
  },
  {
    failureMode: 'Improving rows without improving preference',
    guardrail: 'Every sprint must state expected operator-visible lift',
    check: (patterns) => {
      const missingLift = patterns.filter(p => p.operatorLeverageScore === 0 && p.status === 'extracted');
      return {
        passed: missingLift.length === 0,
        violation: missingLift.length > 0 ?
          `${missingLift.length} pattern(s) have no operator-leverage score set` : undefined,
      };
    },
  },
];

export function runAntiFailureGuards(
  patterns: CoflPattern[],
  dimensions: Array<{ id: string; scores: Record<string, number> }>,
  registry: CoflRegistry,
): AntiFailureCheck[] {
  return ANTI_FAILURE_RULES.map(rule => {
    const result = rule.check(patterns, dimensions, registry);
    return {
      failureMode: rule.failureMode,
      guardrail: rule.guardrail,
      passed: result.passed,
      violation: result.violation,
    };
  });
}

// ── Phase: Reframe ────────────────────────────────────────────────────────────

export function runReframePhase(
  beforeScore: number,
  afterScore: number,
  cyclesRun: number,
  leverageEntries: OperatorLeverageEntry[],
  closedSourceGapBefore: number,
  closedSourceGapAfter: number,
): ReframeAssessment {
  const preferenceGainDelta = afterScore - beforeScore;
  const closedSourceGapDelta = closedSourceGapBefore - closedSourceGapAfter;

  const borrowedCount = leverageEntries.filter(e => e.borrowableFromOSS).length;
  const highLeverageCount = leverageEntries.filter(e => e.leverageScore > 5).length;

  // Governance moat proxy: high leverage + borrowable = we have patterns they can't easily copy
  const preservedMoat = borrowedCount > 0 && highLeverageCount > 0;

  // Coherence: we're getting better on multiple fronts, not just inflating one metric
  const becomeMoreCoherent = leverageEntries.filter(e => e.operatorVisibleLift > 3).length >= 2;

  // Inflation warning: score improved but gap to closed-source didn't close
  const onlyInflatingRows = preferenceGainDelta > 0 && closedSourceGapDelta <= 0;

  const objectiveFunctionValue =
    (preferenceGainDelta * 2) +
    (closedSourceGapDelta * 3) +
    (preservedMoat ? 1.5 : 0) +
    (borrowedCount * 0.5);

  let recommendation: string;
  if (onlyInflatingRows) {
    recommendation = 'Scores improved but closed-source gap is not closing — focus next sprint on operator-visible gaps vs direct_peer competitors.';
  } else if (!becomeMoreCoherent) {
    recommendation = 'Improvements are concentrated in few dimensions — broaden next cycle to improve coherence and preference.';
  } else if (objectiveFunctionValue > 5) {
    recommendation = `Strong cycle (objective Δ: +${objectiveFunctionValue.toFixed(2)}). Continue harvesting from specialist_teacher set for next highest-leverage dimension.`;
  } else {
    recommendation = `Cycle ${cyclesRun} complete. Preference gain: +${preferenceGainDelta.toFixed(2)}. Run cofl --universe to refresh competitor universe before next cycle.`;
  }

  return {
    becomeMorePreferred: preferenceGainDelta > 0,
    becomeMoreCoherent,
    onlyInflatingRows,
    preferenceGainDelta,
    coherenceDelta: becomeMoreCoherent ? 1 : -0.5,
    objectiveFunctionValue: Math.round(objectiveFunctionValue * 100) / 100,
    recommendation,
  };
}

// ── Objective function ────────────────────────────────────────────────────────

export function computeObjectiveFunction(
  leverages: OperatorLeverageEntry[],
  patterns: CoflPattern[],
  closedSourceGapDelta: number,
): CoflObjectiveFunction {
  const avgPreferenceGain = leverages.length > 0
    ? leverages.reduce((s, e) => s + e.operatorVisibleLift, 0) / leverages.length
    : 0;

  const reusablePatterns = patterns.filter(p =>
    p.status === 'verified' || p.status === 'forged').length;

  const governanceMoat = patterns.filter(p =>
    p.implementationScope === 'narrow' && p.status === 'verified').length * 0.5;

  return {
    operator_preference_gain: Math.round(avgPreferenceGain * 10) / 10,
    closed_source_gap_reduction: Math.round(Math.max(0, closedSourceGapDelta) * 10) / 10,
    preserved_governance_moat: Math.round(governanceMoat * 10) / 10,
    reusable_product_patterns: reusablePatterns,
  };
}

// ── Registry persistence ──────────────────────────────────────────────────────

const REGISTRY_PATH = '.danteforge/cofl/registry.json';

function emptyRegistry(): CoflRegistry {
  return {
    version: '1.0.0',
    cyclesRun: 0,
    partition: { directPeers: [], specialistTeachers: [], referenceTeachers: [] },
    patterns: [],
    lessons: [],
    gapMap: {},
    strategyNotes: [],
    lastCycleAt: '',
    updatedAt: new Date().toISOString(),
  };
}

export async function loadCoflRegistry(
  cwd: string,
  _readFile?: (p: string) => Promise<string>,
): Promise<CoflRegistry> {
  const read = _readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const raw = await read(path.join(cwd, REGISTRY_PATH));
    return JSON.parse(raw) as CoflRegistry;
  } catch {
    return emptyRegistry();
  }
}

export async function saveCoflRegistry(
  registry: CoflRegistry,
  cwd: string,
  _writeFile?: (p: string, content: string) => Promise<void>,
): Promise<void> {
  const write = _writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
  const dir = path.join(cwd, '.danteforge/cofl');
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  const updated = { ...registry, updatedAt: new Date().toISOString() };
  await write(path.join(cwd, REGISTRY_PATH), JSON.stringify(updated, null, 2));
}

export function persistCycleLearnings(
  result: CoflCycleResult,
  registry: CoflRegistry,
): CoflRegistry {
  // Merge patterns (deduplicate by id)
  const existingIds = new Set(registry.patterns.map(p => p.id));
  const newPatterns = result.extractedPatterns.filter(p => !existingIds.has(p.id));

  // Update gap map
  const gapMap = { ...registry.gapMap };
  for (const pattern of result.extractedPatterns) {
    for (const dim of pattern.affectedDimensions) {
      gapMap[dim] = [...new Set([...(gapMap[dim] ?? []), pattern.id])];
    }
  }

  return {
    ...registry,
    cyclesRun: registry.cyclesRun + 1,
    partition: result.partition,
    patterns: [...registry.patterns, ...newPatterns],
    gapMap,
    lastCycleAt: result.completedAt,
    updatedAt: new Date().toISOString(),
  };
}

// ── Pattern ID generator ──────────────────────────────────────────────────────

export function generatePatternId(sourceCompetitor: string, description: string): string {
  const slug = (sourceCompetitor + '-' + description)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const rand = Math.random().toString(16).slice(2, 6);
  return `cofl-${slug}-${rand}`;
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

export function renderPartitionTable(partition: UniversePartition): string {
  const lines: string[] = [
    '## Universe Partition',
    '',
    `**Direct Peers** (scoreboard — beat in operator experience): ${partition.directPeers.join(', ') || 'none'}`,
    `**Specialist Teachers** (borrow-targeted): ${partition.specialistTeachers.join(', ') || 'none'}`,
    `**Reference Teachers** (OSS pattern source): ${partition.referenceTeachers.join(', ') || 'none'}`,
  ];
  return lines.join('\n');
}

export function renderLeverageTable(entries: OperatorLeverageEntry[]): string {
  if (entries.length === 0) return 'No leverage entries computed.';
  const sorted = [...entries].sort((a, b) => b.leverageScore - a.leverageScore);
  const rows = sorted.map(e =>
    `| ${e.dimensionLabel.padEnd(24)} | ${e.leverageScore.toFixed(2).padStart(6)} | ${e.gapToClosedSourceLeader.toFixed(1).padStart(8)} | ${e.borrowableFromOSS ? '✓' : '✗'} |`
  );
  return [
    '## Operator Leverage Rankings',
    '(sorted by leverage score — operator-visible impact × gap × borrowability)',
    '',
    '| Dimension                 | Score  | CS Gap   | OSS Borrow |',
    '|---------------------------|--------|----------|------------|',
    ...rows,
  ].join('\n');
}

export function renderAntiFailureReport(checks: AntiFailureCheck[]): string {
  const failed = checks.filter(c => !c.passed);
  const lines = ['## Anti-Failure Guardrails', ''];
  if (failed.length === 0) {
    lines.push('✓ All 7 guardrails passed — no failure modes detected.');
  } else {
    lines.push(`⚠ ${failed.length} guardrail(s) violated:`);
    for (const f of failed) {
      lines.push(`- **${f.failureMode}**: ${f.violation}`);
    }
  }
  return lines.join('\n');
}

export function renderReframe(reframe: ReframeAssessment): string {
  return [
    '## Reframe — Strategic Position',
    '',
    `Becoming more preferred: ${reframe.becomeMorePreferred ? '✓ Yes' : '✗ No'}`,
    `Becoming more coherent:  ${reframe.becomeMoreCoherent ? '✓ Yes' : '✗ No'}`,
    `Only inflating rows:     ${reframe.onlyInflatingRows ? '⚠ Yes (warning)' : '✓ No'}`,
    `Objective Δ: ${reframe.objectiveFunctionValue >= 0 ? '+' : ''}${reframe.objectiveFunctionValue.toFixed(2)}`,
    '',
    `**Recommendation:** ${reframe.recommendation}`,
  ].join('\n');
}
