// Complexity classifier — auto-escalation from solo to party mode.
import type { DanteState } from './state.js';
import type { MagicLevel } from './magic-presets.js';
import { MAGIC_PRESETS } from './magic-presets.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComplexitySignals {
  fileCount: number;
  moduleCount: number;
  hasNewModule: boolean;
  hasArchitecturalChange: boolean;
  hasSecurityImplication: boolean;
  hasTestRequirement: boolean;
  hasDatabaseChange: boolean;
  hasAPIChange: boolean;
  estimatedLinesOfCode: number;
  dependencyDepth: number;
}

export interface ComplexityAssessment {
  signals: ComplexitySignals;
  score: number;
  recommendedPreset: MagicLevel;
  reasoning: string;
  shouldUseParty: boolean;
  estimatedDurationMinutes: number;
  estimatedCostUsd: number;
}

export interface ComplexityWeights {
  fileCount: number;
  newModule: number;
  architecturalChange: number;
  securityImplication: number;
  linesOfCode: number;
  dependencyDepth: number;
  testRequirement: number;
  apiChange: number;
  databaseChange: number;
}

export const DEFAULT_COMPLEXITY_WEIGHTS: ComplexityWeights = {
  fileCount: 15,
  newModule: 10,
  architecturalChange: 15,
  securityImplication: 10,
  linesOfCode: 15,
  dependencyDepth: 10,
  testRequirement: 10,
  apiChange: 8,
  databaseChange: 7,
};

// ---------------------------------------------------------------------------
// Keyword sets for signal detection
// ---------------------------------------------------------------------------

const SECURITY_KEYWORDS = ['security', 'auth', 'credential', 'encryption'];
const ARCHITECTURE_KEYWORDS = ['architect', 'design', 'interface', 'module', 'refactor'];
const DATABASE_KEYWORDS = ['database', 'schema', 'migration', 'query', 'prisma'];
const API_KEYWORDS = ['api', 'endpoint', 'route', 'rest', 'graphql'];
const NEW_MODULE_PATTERNS = ['new module', 'create module', 'add module'];

function textMatchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// 1. extractComplexitySignals
// ---------------------------------------------------------------------------

export function extractComplexitySignals(
  tasks: Array<{ name: string; files?: string[]; verify?: string }>,
  _state: DanteState,
): ComplexitySignals {
  // Collect all files across tasks
  const allFiles: string[] = [];
  for (const task of tasks) {
    if (task.files) {
      allFiles.push(...task.files);
    }
  }
  const fileCount = allFiles.length;

  // Count unique top-level directories as modules
  const directories = new Set<string>();
  for (const file of allFiles) {
    const normalized = file.replace(/\\/g, '/');
    const firstSegment = normalized.split('/')[0];
    if (firstSegment) {
      directories.add(firstSegment);
    }
  }
  const moduleCount = directories.size;

  // Aggregate all text from task names, file paths, and verify fields
  const combinedText = tasks
    .map(t => [t.name, ...(t.files ?? []), t.verify ?? ''].join(' '))
    .join(' ');

  const hasSecurityImplication = textMatchesAny(combinedText, SECURITY_KEYWORDS);
  const hasArchitecturalChange = textMatchesAny(combinedText, ARCHITECTURE_KEYWORDS);
  const hasDatabaseChange = textMatchesAny(combinedText, DATABASE_KEYWORDS);
  const hasAPIChange = textMatchesAny(combinedText, API_KEYWORDS);

  // Test requirement detected from verify fields
  const hasTestRequirement = tasks.some(
    t => typeof t.verify === 'string' && t.verify.trim().length > 0,
  );

  // New module detection from task names
  const hasNewModule = tasks.some(t =>
    NEW_MODULE_PATTERNS.some(p => t.name.toLowerCase().includes(p)),
  );

  const estimatedLinesOfCode = fileCount * 100;
  const dependencyDepth = moduleCount;

  return {
    fileCount,
    moduleCount,
    hasNewModule,
    hasArchitecturalChange,
    hasSecurityImplication,
    hasTestRequirement,
    hasDatabaseChange,
    hasAPIChange,
    estimatedLinesOfCode,
    dependencyDepth,
  };
}

// ---------------------------------------------------------------------------
// 2. computeComplexityScore
// ---------------------------------------------------------------------------

export function computeComplexityScore(
  signals: ComplexitySignals,
  weights: ComplexityWeights = DEFAULT_COMPLEXITY_WEIGHTS,
): number {
  let score = 0;

  // fileCount: 1-2=0, 3-5=33%, 6-10=67%, 11-20=87%, 21+=100% of weight
  if (signals.fileCount >= 21) {
    score += weights.fileCount;
  } else if (signals.fileCount >= 11) {
    score += Math.round(weights.fileCount * 13 / 15);
  } else if (signals.fileCount >= 6) {
    score += Math.round(weights.fileCount * 10 / 15);
  } else if (signals.fileCount >= 3) {
    score += Math.round(weights.fileCount * 5 / 15);
  }

  // hasNewModule: full weight when present
  if (signals.hasNewModule) {
    score += weights.newModule;
  }

  // hasArchitecturalChange: full weight when present
  if (signals.hasArchitecturalChange) {
    score += weights.architecturalChange;
  }

  // hasSecurityImplication: full weight when present
  if (signals.hasSecurityImplication) {
    score += weights.securityImplication;
  }

  // estimatedLinesOfCode: <50=0, <200=33%, <500=67%, <1000=87%, 1000+=100% of weight
  if (signals.estimatedLinesOfCode >= 1000) {
    score += weights.linesOfCode;
  } else if (signals.estimatedLinesOfCode >= 500) {
    score += Math.round(weights.linesOfCode * 13 / 15);
  } else if (signals.estimatedLinesOfCode >= 200) {
    score += Math.round(weights.linesOfCode * 10 / 15);
  } else if (signals.estimatedLinesOfCode >= 50) {
    score += Math.round(weights.linesOfCode * 5 / 15);
  }

  // dependencyDepth: 0=0, 1-2=50%, 3+=100% of weight
  if (signals.dependencyDepth >= 3) {
    score += weights.dependencyDepth;
  } else if (signals.dependencyDepth >= 1) {
    score += Math.round(weights.dependencyDepth * 5 / 10);
  }

  // hasTestRequirement: full weight when present
  if (signals.hasTestRequirement) {
    score += weights.testRequirement;
  }

  // hasAPIChange: full weight when present
  if (signals.hasAPIChange) {
    score += weights.apiChange;
  }

  // hasDatabaseChange: full weight when present
  if (signals.hasDatabaseChange) {
    score += weights.databaseChange;
  }

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// 3. mapScoreToPreset
// ---------------------------------------------------------------------------

export function mapScoreToPreset(score: number): MagicLevel {
  if (score >= 76) return 'inferno';
  if (score >= 56) return 'blaze';
  if (score >= 36) return 'magic';
  if (score >= 16) return 'ember';
  return 'spark';
}

// ---------------------------------------------------------------------------
// 4. assessComplexity
// ---------------------------------------------------------------------------

export function assessComplexity(
  tasks: Array<{ name: string; files?: string[]; verify?: string }>,
  state: DanteState,
): ComplexityAssessment {
  const signals = extractComplexitySignals(tasks, state);
  const score = computeComplexityScore(signals);
  const recommendedPreset = mapScoreToPreset(score);
  const shouldUseParty = score > 55 || signals.fileCount > 10;
  const estimatedDurationMinutes = Math.max(1, Math.round(score / 5));
  const estimatedCostUsd = MAGIC_PRESETS[recommendedPreset].maxBudgetUsd;

  const reasoning = buildReasoning(signals, score, recommendedPreset, shouldUseParty);

  return {
    signals,
    score,
    recommendedPreset,
    reasoning,
    shouldUseParty,
    estimatedDurationMinutes,
    estimatedCostUsd,
  };
}

function buildReasoning(
  signals: ComplexitySignals,
  score: number,
  preset: MagicLevel,
  shouldUseParty: boolean,
): string {
  const factors: string[] = [];

  if (signals.fileCount > 0) {
    factors.push(`${signals.fileCount} file(s) across ${signals.moduleCount} module(s)`);
  }
  if (signals.hasNewModule) {
    factors.push('introduces a new module');
  }
  if (signals.hasArchitecturalChange) {
    factors.push('involves architectural changes');
  }
  if (signals.hasSecurityImplication) {
    factors.push('has security implications');
  }
  if (signals.hasDatabaseChange) {
    factors.push('includes database changes');
  }
  if (signals.hasAPIChange) {
    factors.push('modifies API surface');
  }
  if (signals.hasTestRequirement) {
    factors.push('requires test verification');
  }

  const factorSummary = factors.length > 0
    ? factors.join('; ')
    : 'minimal complexity detected';

  const modeNote = shouldUseParty
    ? 'Party mode recommended for multi-agent coordination.'
    : 'Solo mode sufficient.';

  return `Score ${score}/100 -> ${preset}. ${capitalize(factorSummary)}. ${modeNote}`;
}

// ---------------------------------------------------------------------------
// 5. formatAssessment
// ---------------------------------------------------------------------------

export function formatAssessment(assessment: ComplexityAssessment): string {
  const { signals, score, recommendedPreset, shouldUseParty, estimatedDurationMinutes, estimatedCostUsd } = assessment;

  const lines: string[] = [
    `Complexity Assessment`,
    `---------------------`,
    `Score:        ${score}/100`,
    `Preset:       ${recommendedPreset}`,
    `Mode:         ${shouldUseParty ? 'party (multi-agent)' : 'solo'}`,
    `Est. Time:    ~${estimatedDurationMinutes} min`,
    `Est. Cost:    $${estimatedCostUsd.toFixed(2)}`,
    ``,
    `Signals:`,
    `  Files:              ${signals.fileCount}`,
    `  Modules:            ${signals.moduleCount}`,
    `  Lines (est.):       ${signals.estimatedLinesOfCode}`,
    `  Dependency Depth:   ${signals.dependencyDepth}`,
    `  New Module:         ${signals.hasNewModule ? 'yes' : 'no'}`,
    `  Architectural:      ${signals.hasArchitecturalChange ? 'yes' : 'no'}`,
    `  Security:           ${signals.hasSecurityImplication ? 'yes' : 'no'}`,
    `  Database:           ${signals.hasDatabaseChange ? 'yes' : 'no'}`,
    `  API:                ${signals.hasAPIChange ? 'yes' : 'no'}`,
    `  Test Requirement:   ${signals.hasTestRequirement ? 'yes' : 'no'}`,
    ``,
    assessment.reasoning,
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 6. loadComplexityWeights — YAML-based config loader (best-effort)
// ---------------------------------------------------------------------------

export async function loadComplexityWeights(cwd?: string): Promise<ComplexityWeights> {
  try {
    const { default: fs } = await import('node:fs/promises');
    const { default: path } = await import('node:path');
    const { default: YAML } = await import('yaml');
    const filePath = path.join(cwd ?? process.cwd(), '.danteforge', 'complexity-weights.yaml');
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = YAML.parse(content) as Record<string, unknown>;
    return { ...DEFAULT_COMPLEXITY_WEIGHTS, ...pickWeightFields(parsed) };
  } catch {
    return DEFAULT_COMPLEXITY_WEIGHTS;
  }
}

function pickWeightFields(obj: Record<string, unknown>): Partial<ComplexityWeights> {
  const result: Partial<ComplexityWeights> = {};
  const keys: Array<keyof ComplexityWeights> = [
    'fileCount', 'newModule', 'architecturalChange', 'securityImplication',
    'linesOfCode', 'dependencyDepth', 'testRequirement', 'apiChange', 'databaseChange',
  ];
  for (const key of keys) {
    if (typeof obj[key] === 'number' && obj[key] > 0) {
      result[key] = obj[key] as number;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 7. recordComplexityOutcome — feedback loop for weight calibration
// ---------------------------------------------------------------------------

export function recordComplexityOutcome(
  assessment: ComplexityAssessment,
  actualPreset: MagicLevel,
  actualCostUsd: number,
): string | null {
  const presetOrder: MagicLevel[] = ['spark', 'ember', 'magic', 'blaze', 'inferno'];
  const predicted = presetOrder.indexOf(assessment.recommendedPreset);
  const actual = presetOrder.indexOf(actualPreset);
  const drift = Math.abs(predicted - actual);
  if (drift < 2) return null; // Close enough
  const direction = actual > predicted ? 'underestimated' : 'overestimated';
  return `Complexity ${direction}: predicted ${assessment.recommendedPreset} (score ${assessment.score}), actual ${actualPreset} ($${actualCostUsd.toFixed(4)}). Consider adjusting weights.`;
}

// ---------------------------------------------------------------------------
// 8. adjustWeightsFromOutcome — pure function for weight adjustment
// ---------------------------------------------------------------------------

export function adjustWeightsFromOutcome(
  current: ComplexityWeights,
  predicted: MagicLevel,
  actual: MagicLevel,
  adjustmentFactor: number = 0.1,
): ComplexityWeights | null {
  const presetOrder: MagicLevel[] = ['spark', 'ember', 'magic', 'blaze', 'inferno'];
  const predictedIdx = presetOrder.indexOf(predicted);
  const actualIdx = presetOrder.indexOf(actual);
  const drift = Math.abs(predictedIdx - actualIdx);
  if (drift < 2) return null; // Close enough — no adjustment needed

  const keys: Array<keyof ComplexityWeights> = [
    'fileCount', 'newModule', 'architecturalChange', 'securityImplication',
    'linesOfCode', 'dependencyDepth', 'testRequirement', 'apiChange', 'databaseChange',
  ];

  const direction = actualIdx > predictedIdx ? 1 : -1; // +1 = underestimate, -1 = overestimate
  const adjusted = { ...current };
  for (const key of keys) {
    const delta = Math.round(current[key] * adjustmentFactor * direction);
    adjusted[key] = Math.max(1, Math.min(30, current[key] + delta));
  }

  // Normalize so sum stays close to 100
  const sum = keys.reduce((acc, k) => acc + adjusted[k], 0);
  if (sum > 0) {
    const scale = 100 / sum;
    for (const key of keys) {
      adjusted[key] = Math.max(1, Math.round(adjusted[key] * scale));
    }
  }

  // If normalization canceled all adjustments (integer rounding artifact), force-nudge
  // the two highest-impact weights so the calibration signal is preserved.
  const hasChanged = keys.some(k => adjusted[k] !== current[k]);
  if (!hasChanged) {
    adjusted['fileCount'] = Math.max(1, Math.min(30, adjusted['fileCount'] + direction));
    adjusted['linesOfCode'] = Math.max(1, Math.min(30, adjusted['linesOfCode'] + direction));
  }

  return adjusted;
}

// ---------------------------------------------------------------------------
// 9. persistComplexityWeights — write adjusted weights to YAML (best-effort)
// ---------------------------------------------------------------------------

export async function persistComplexityWeights(
  weights: ComplexityWeights,
  cwd?: string,
): Promise<void> {
  try {
    const { default: fs } = await import('node:fs/promises');
    const { default: path } = await import('node:path');
    const { default: YAML } = await import('yaml');
    const dirPath = path.join(cwd ?? process.cwd(), '.danteforge');
    await fs.mkdir(dirPath, { recursive: true });
    const filePath = path.join(dirPath, 'complexity-weights.yaml');
    await fs.writeFile(filePath, YAML.stringify(weights), 'utf8');
  } catch {
    // Best-effort — never block the main pipeline
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
