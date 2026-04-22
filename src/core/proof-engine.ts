// Proof-of-Value Engine — compares raw user prompt quality against DanteForge-structured artifacts.
// scoreRawPrompt is a pure deterministic function. runProof performs I/O via injected seams.
import path from 'path';
import { scoreArtifact } from './pdse.js';
import { loadState } from './state.js';
import type { ScoredArtifact, ScoringContext } from './pdse.js';
import type { DanteState } from './state.js';

export interface RawPromptScore {
  completeness: number;    // 0-20
  clarity: number;         // 0-20
  testability: number;     // 0-20
  contextDensity: number;  // 0-20
  specificity: number;     // 0-10
  freshness: number;       // 0-10
  total: number;           // sum of all above
  breakdown: Record<string, string>;  // human-readable per-dimension explanation
}

export interface ProofReport {
  rawScore: RawPromptScore;
  pdseScore: number;           // weighted average from PDSE scoring (0-100)
  improvementPercent: number;  // ((pdseScore - raw.total) / Math.max(raw.total, 1)) * 100
  rawPrompt: string;
  artifactSummary: string;     // e.g. "Found CONSTITUTION.md, SPEC.md (2/5 artifacts)"
  verdict: 'strong' | 'moderate' | 'weak';  // strong: >200%, moderate: >50%, weak: <=50%
  recommendation: string;
}

export interface ProofEngineOptions {
  cwd?: string;
  _readFile?: (p: string) => Promise<string>;
  _exists?: (p: string) => Promise<boolean>;
}

// ── Artifact metadata ──────────────────────────────────────────────────────────

const ARTIFACT_FILES = [
  'CONSTITUTION.md',
  'SPEC.md',
  'CLARIFY.md',
  'PLAN.md',
  'TASKS.md',
] as const;

type ArtifactFile = (typeof ARTIFACT_FILES)[number];

const ARTIFACT_WEIGHTS: Record<ArtifactFile, number> = {
  'CONSTITUTION.md': 30,
  'SPEC.md': 30,
  'CLARIFY.md': 20,
  'PLAN.md': 15,
  'TASKS.md': 5,
};

const ARTIFACT_NAME_MAP: Record<ArtifactFile, ScoredArtifact> = {
  'CONSTITUTION.md': 'CONSTITUTION',
  'SPEC.md': 'SPEC',
  'CLARIFY.md': 'CLARIFY',
  'PLAN.md': 'PLAN',
  'TASKS.md': 'TASKS',
};

// ── Pure scoring helpers ───────────────────────────────────────────────────────

function scoreCompleteness(prompt: string): { score: number; notes: string[] } {
  const groups: Array<{ label: string; re: RegExp }> = [
    { label: 'has goal', re: /\b(build|create|implement|develop|make|add|write)\b/i },
    { label: 'has constraint', re: /\b(must|should|require[sd]?|needs? to|cannot|only|no)\b/i },
    { label: 'has success criteria', re: /\b(success|done|complet[eing]+|test[s]?|pass[es]*|achiev)\b/i },
    { label: 'has stack context', re: /\b(using|with|stack|framework|librar[yies]+|npm|package)\b/i },
    { label: 'has stakeholder', re: /\b(user[s]?|customer[s]?|client[s]?|team|stakeholder|developer)\b/i },
  ];
  const notes: string[] = [];
  let score = 0;
  for (const g of groups) {
    if (g.re.test(prompt)) {
      score += 4;
      notes.push(`+4 (${g.label})`);
    }
  }
  return { score, notes };
}

function scoreClarity(prompt: string): { score: number; notes: string[] } {
  const checks: Array<{ label: string; pass: boolean }> = [
    {
      label: 'specific noun count ≥ 3',
      pass:
        (
          prompt.match(
            /\b[A-Z][a-z]+[A-Z]\w*|\b\w+\.js|\b\w+\.ts|\bAPI\b|\bREST\b|\bJSON\b|\bSQL\b|\bJWT\b|\bOAuth\b/g,
          ) ?? []
        ).length >= 3,
    },
    {
      label: 'measurable verb present',
      pass: /\b(return[s]?|render[s]?|store[s]?|accept[s]?|validate[s]?|emit[s]?|output[s]?)\b/i.test(prompt),
    },
    { label: 'word count ≤ 200', pass: prompt.split(/\s+/).filter(Boolean).length <= 200 },
    {
      label: 'no filler words',
      pass: !/\b(something|somehow|kind of|sort of|basically|thing[s]?|stuff)\b/i.test(prompt),
    },
    { label: 'has code block or backtick', pass: /`[^`]+`|```/.test(prompt) },
  ];
  const notes: string[] = [];
  let score = 0;
  for (const c of checks) {
    if (c.pass) {
      score += 4;
      notes.push(`+4 (${c.label})`);
    }
  }
  return { score, notes };
}

function scoreTestability(prompt: string): { score: number; notes: string[] } {
  const checks: Array<{ label: string; re: RegExp }> = [
    { label: 'explicit test mention', re: /\b(test[s]?|spec[s]?|unit|integration|e2e|TDD)\b/i },
    { label: 'numeric success criteria', re: /\b\d+(%|ms|seconds?|requests?|users?|concurrent)\b/i },
    { label: 'error condition described', re: /\b(error[s]?|fail[s]?|invalid|reject|throw|catch|exception)\b/i },
    { label: 'expected output described', re: /\b(should return|returns|outputs?|responds? with|produces?)\b/i },
  ];
  const notes: string[] = [];
  let score = 0;
  for (const c of checks) {
    if (c.re.test(prompt)) {
      score += 5;
      notes.push(`+5 (${c.label})`);
    }
  }
  return { score, notes };
}

function scoreContextDensity(prompt: string): { score: number; notes: string[] } {
  const checks: Array<{ label: string; re: RegExp }> = [
    {
      label: 'tech stack named',
      re: /\b(React|Vue|Angular|Express|Next\.js|Node|TypeScript|Python|Java|Go|Rust|Django|FastAPI|Spring|Rails)\b/i,
    },
    { label: 'version number present', re: /\b\d+\.\d+(\.\d+)?\b/ },
    { label: 'existing codebase reference', re: /\b(existing|current|already|codebase|repo|project|our)\b/i },
    {
      label: 'domain context',
      re: /\b(auth[entication]*|payment[s]?|invoice[s]?|user[s]?|dashboard|API|database|cache|queue)\b/i,
    },
  ];
  const notes: string[] = [];
  let score = 0;
  for (const c of checks) {
    if (c.re.test(prompt)) {
      score += 5;
      notes.push(`+5 (${c.label})`);
    }
  }
  return { score, notes };
}

function scoreSpecificity(prompt: string): { score: number; notes: string[] } {
  const checks: Array<{ label: string; pass: boolean }> = [
    {
      label: 'no vague filler words',
      pass: !/\b(thing[s]?|stuff|some|any|various|etc|whatever)\b/i.test(prompt),
    },
    {
      label: 'named entity present',
      pass: ((prompt.match(/\b[A-Z][A-Za-z]{3,}\b/g) ?? []).length >= 2),
    },
  ];
  const notes: string[] = [];
  let score = 0;
  for (const c of checks) {
    if (c.pass) {
      score += 5;
      notes.push(`+5 (${c.label})`);
    }
  }
  return { score, notes };
}

function scoreFreshness(prompt: string): { score: number; notes: string[] } {
  const checks: Array<{ label: string; re: RegExp }> = [
    { label: 'version number', re: /\b\d+\.\d+/ },
    {
      label: 'framework name',
      re: /\b(React|Vue|Angular|Express|Next\.js|Node|TypeScript|Python|Java|Go|Rust|Django|FastAPI|Spring|Rails)\b/i,
    },
  ];
  const notes: string[] = [];
  let score = 0;
  for (const c of checks) {
    if (c.re.test(prompt)) {
      score += 5;
      notes.push(`+5 (${c.label})`);
    }
  }
  return { score, notes };
}

// ── Public pure scoring function ───────────────────────────────────────────────

export function scoreRawPrompt(prompt: string): RawPromptScore {
  const comp = scoreCompleteness(prompt);
  const clar = scoreClarity(prompt);
  const test = scoreTestability(prompt);
  const ctx = scoreContextDensity(prompt);
  const spec = scoreSpecificity(prompt);
  const fresh = scoreFreshness(prompt);

  const completeness = comp.score;
  const clarity = clar.score;
  const testability = test.score;
  const contextDensity = ctx.score;
  const specificity = spec.score;
  const freshness = fresh.score;

  const total = completeness + clarity + testability + contextDensity + specificity + freshness;

  const breakdown: Record<string, string> = {
    completeness:
      comp.notes.length > 0 ? `completeness: ${comp.notes.join(', ')}` : 'completeness: 0 (no keyword groups matched)',
    clarity:
      clar.notes.length > 0 ? `clarity: ${clar.notes.join(', ')}` : 'clarity: 0 (no clarity signals found)',
    testability:
      test.notes.length > 0 ? `testability: ${test.notes.join(', ')}` : 'testability: 0 (no test signals found)',
    contextDensity:
      ctx.notes.length > 0 ? `contextDensity: ${ctx.notes.join(', ')}` : 'contextDensity: 0 (no context signals found)',
    specificity:
      spec.notes.length > 0 ? `specificity: ${spec.notes.join(', ')}` : 'specificity: 0 (no specificity signals found)',
    freshness:
      fresh.notes.length > 0 ? `freshness: ${fresh.notes.join(', ')}` : 'freshness: 0 (no version or framework found)',
  };

  return { completeness, clarity, testability, contextDensity, specificity, freshness, total, breakdown };
}

// ── Minimal default state for scoring when state.yaml is unavailable ───────────

function makeMinimalState(): DanteState {
  return {
    project: 'unknown',
    lastHandoff: '',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    auditLog: [],
    profile: 'default',
  };
}

function scoreFoundArtifacts(
  foundArtifacts: ArtifactFile[],
  artifactContents: Partial<Record<ArtifactFile, string>>,
  state: DanteState,
  upstreamMap: Partial<Record<ScoredArtifact, string>>,
): number {
  if (foundArtifacts.length === 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const filename of foundArtifacts) {
    const content = artifactContents[filename] ?? '';
    const artifactName = ARTIFACT_NAME_MAP[filename];
    const weight = ARTIFACT_WEIGHTS[filename];
    const result = scoreArtifact({
      artifactContent: content,
      artifactName,
      stateYaml: state,
      upstreamArtifacts: upstreamMap,
      isWebProject: state.projectType === 'web',
    });
    weightedSum += result.score * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

// ── Main async proof function ──────────────────────────────────────────────────

export async function runProof(rawPrompt: string, opts: ProofEngineOptions = {}): Promise<ProofReport> {
  const cwd = opts.cwd ?? process.cwd();
  const stateDir = path.join(cwd, '.danteforge');

  const readFile = opts._readFile ?? (async (p: string) => {
    const fs = await import('fs/promises');
    return fs.readFile(p, 'utf8');
  });

  const existsFn = opts._exists ?? (async (p: string) => {
    const fs = await import('fs/promises');
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  });

  const rawScore = scoreRawPrompt(rawPrompt);

  // Discover and load artifacts
  const foundArtifacts: ArtifactFile[] = [];
  const artifactContents: Partial<Record<ArtifactFile, string>> = {};

  for (const filename of ARTIFACT_FILES) {
    const filePath = path.join(stateDir, filename);
    const exists = await existsFn(filePath);
    if (exists) {
      try {
        const content = await readFile(filePath);
        artifactContents[filename] = content;
        foundArtifacts.push(filename);
      } catch {
        // skip unreadable files
      }
    }
  }

  // Load state for scoring context (best-effort)
  let state: DanteState;
  try {
    state = await loadState({ cwd });
  } catch {
    state = makeMinimalState();
  }

  // Build a map keyed by ScoredArtifact name for upstreamArtifacts (used for integration fitness scoring)
  const upstreamMap: Partial<Record<ScoredArtifact, string>> = {};
  for (const filename of foundArtifacts) {
    const artifactName = ARTIFACT_NAME_MAP[filename];
    upstreamMap[artifactName] = artifactContents[filename] ?? '';
  }

  const pdseScore = scoreFoundArtifacts(foundArtifacts, artifactContents, state, upstreamMap);

  const improvementPercent = ((pdseScore - rawScore.total) / Math.max(rawScore.total, 1)) * 100;

  const verdict: ProofReport['verdict'] =
    improvementPercent > 200 ? 'strong' : improvementPercent > 50 ? 'moderate' : 'weak';

  const artifactSummary =
    foundArtifacts.length > 0
      ? `Found ${foundArtifacts.join(', ')} (${foundArtifacts.length}/${ARTIFACT_FILES.length} artifacts)`
      : `No artifacts found (0/${ARTIFACT_FILES.length} artifacts)`;

  const missingArtifacts = ARTIFACT_FILES.filter((f) => !foundArtifacts.includes(f));

  let recommendation: string;
  if (verdict === 'strong') {
    recommendation =
      'DanteForge substantially enriches your AI context. Run `danteforge forge` to leverage structured artifacts.';
  } else if (verdict === 'moderate') {
    recommendation =
      missingArtifacts.length > 0
        ? `Good start. Generate missing artifacts (${missingArtifacts.join(', ')}) to unlock full context quality.`
        : 'Moderate improvement detected. Enrich your raw prompt with more constraints and success criteria.';
  } else {
    recommendation =
      missingArtifacts.length === ARTIFACT_FILES.length
        ? 'No DanteForge artifacts found. Run `danteforge specify` to begin structuring your project.'
        : `Limited improvement. Generate missing artifacts (${missingArtifacts.join(', ')}) and add more detail to your prompt.`;
  }

  return {
    rawScore,
    pdseScore,
    improvementPercent,
    rawPrompt,
    artifactSummary,
    verdict,
    recommendation,
  };
}

// ── Pipeline proof types ──────────────────────────────────────────────────────

export interface PipelineStageRecord {
  stage: string;
  artifact: string;
  status: 'present' | 'generated' | 'missing';
  pdseScore?: number;
  filesGenerated?: number;
  testsPassing?: boolean;
}

export interface PipelineProofReport {
  pipeline: {
    stages: PipelineStageRecord[];
    artifacts: string[];
    pdseScores: Record<string, number>;
    duration_ms: number;
    success: boolean;
    generatedAt: string;
  };
}

export interface PipelineProofOptions {
  cwd?: string;
  _readFile?: (p: string) => Promise<string>;
  _exists?: (p: string) => Promise<boolean>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _mkdir?: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
}

const PIPELINE_STAGES = [
  { stage: 'constitution', artifact: 'CONSTITUTION.md', scoreKey: 'CONSTITUTION' as ScoredArtifact },
  { stage: 'specify',      artifact: 'SPEC.md',          scoreKey: 'SPEC' as ScoredArtifact },
  { stage: 'clarify',      artifact: 'CLARIFY.md',       scoreKey: 'CLARIFY' as ScoredArtifact },
  { stage: 'plan',         artifact: 'PLAN.md',           scoreKey: 'PLAN' as ScoredArtifact },
  { stage: 'tasks',        artifact: 'TASKS.md',          scoreKey: 'TASKS' as ScoredArtifact },
] as const;

/**
 * Generate structured pipeline execution evidence.
 * Scans the project for PDSE artifacts, scores each, checks for generated source files,
 * and writes evidence to .danteforge/evidence/pipeline-proof.json.
 */
export async function runPipelineProof(opts: PipelineProofOptions = {}): Promise<PipelineProofReport> {
  const { default: nodeFs } = await import('node:fs/promises');
  const cwd = opts.cwd ?? process.cwd();
  const start = Date.now();
  const stateDir = path.join(cwd, '.danteforge');

  const existsFn = opts._exists ?? (async (p: string) => {
    try { await nodeFs.access(p); return true; } catch { return false; }
  });
  const readFile = opts._readFile ?? ((p: string) => nodeFs.readFile(p, 'utf-8'));
  const writeFile = opts._writeFile ?? ((p: string, c: string) => nodeFs.writeFile(p, c, 'utf-8'));
  const mkdir = opts._mkdir ?? ((p: string, o?: { recursive?: boolean }) => nodeFs.mkdir(p, o));

  // Load state for a minimal scoring context
  let state: DanteState | undefined;
  try { state = await loadState({ cwd }); } catch { /* best-effort */ }

  const stages: PipelineStageRecord[] = [];
  const pdseScores: Record<string, number> = {};
  const artifactPaths: string[] = [];

  for (const { stage, artifact, scoreKey } of PIPELINE_STAGES) {
    // Check both root directory and .danteforge/ subdirectory
    const rootPath = path.join(cwd, artifact);
    const dfPath = path.join(stateDir, artifact);
    const rootExists = await existsFn(rootPath);
    const dfExists = !rootExists && await existsFn(dfPath);
    const filePath = rootExists ? rootPath : dfExists ? dfPath : null;

    if (filePath) {
      let pdseScore = 0;
      try {
        const content = await readFile(filePath);
        const ctx: ScoringContext = {
          artifactContent: content,
          artifactName: scoreKey,
          stateYaml: state ?? { project: 'unknown', lastHandoff: '', workflowStage: 'initialized', currentPhase: 0, tasks: {}, auditLog: [], profile: 'balanced', lastVerifyStatus: 'unknown' } as DanteState,
          upstreamArtifacts: {},
          isWebProject: false,
        };
        pdseScore = scoreArtifact(ctx).score;
      } catch { /* score 0 on unreadable */ }
      stages.push({ stage, artifact, status: 'present', pdseScore });
      pdseScores[scoreKey] = pdseScore;
      artifactPaths.push(filePath);
    } else {
      stages.push({ stage, artifact, status: 'missing' });
    }
  }

  // Check for generated source files (forge evidence)
  const srcDir = path.join(cwd, 'src');
  const srcExists = await existsFn(srcDir);
  stages.push({ stage: 'forge', artifact: 'src/', status: srcExists ? 'generated' : 'missing' });

  // Check for tests (verify evidence)
  const testsDir = path.join(cwd, 'tests');
  const testsExists = await existsFn(testsDir);
  stages.push({ stage: 'verify', artifact: 'tests/', status: testsExists ? 'generated' : 'missing' });

  const missingCount = stages.filter((s) => s.status === 'missing').length;
  const success = missingCount === 0;

  const report: PipelineProofReport = {
    pipeline: {
      stages,
      artifacts: artifactPaths,
      pdseScores,
      duration_ms: Date.now() - start,
      success,
      generatedAt: new Date().toISOString(),
    },
  };

  // Write to .danteforge/evidence/pipeline-proof.json (best-effort)
  try {
    const evidenceDir = path.join(stateDir, 'evidence');
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(path.join(evidenceDir, 'pipeline-proof.json'), JSON.stringify(report, null, 2));
  } catch { /* best-effort */ }

  return report;
}

// ── Convergence proof types & runner ─────────────────────────────────────────

export interface ConvergenceProofOptions {
  cwd?: string;
  _readFile?: (p: string) => Promise<string>;
  _exists?: (p: string) => Promise<boolean>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _mkdir?: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
}

export interface RepairCycleRecord {
  cycle: number;
  status: 'pass' | 'fail';
  errorClass: string | null;
  recovered: boolean;
}

export interface ConvergenceProofReport {
  convergence: {
    totalCycles: number;
    repairCycles: RepairCycleRecord[];
    verifyRepairSequences: number;
    recoverySuccessRatio: { total: number; successful: number };
    convergenceVelocity: { avgScoreImprovement: number; monotonic: boolean };
    finalStatus: 'converged' | 'stalled' | 'unknown';
    duration_ms: number;
    generatedAt: string;
  };
}

function buildRepairCycles(
  auditLog: string[],
  failedAttempts: number,
  lastStatus: string,
): { repairCycles: RepairCycleRecord[]; totalCycles: number; verifyRepairSequences: number; recoveredCount: number; finalStatus: 'converged' | 'stalled' | 'unknown' } {
  let verifyRepairSequences = 0;
  for (let i = 0; i < auditLog.length - 1; i++) {
    if (auditLog[i].includes('| verify:') && auditLog[i + 1].includes('| forge:')) {
      verifyRepairSequences++;
    }
  }

  const repairCycles: RepairCycleRecord[] = [];
  if (failedAttempts > 0) {
    for (let i = 1; i <= failedAttempts; i++) {
      repairCycles.push({ cycle: i, status: 'fail', errorClass: 'autoforge-failure', recovered: false });
    }
  }
  const totalCycles = failedAttempts + 1;
  repairCycles.push({
    cycle: totalCycles,
    status: lastStatus === 'pass' ? 'pass' : 'fail',
    errorClass: lastStatus === 'pass' ? null : 'verify-failure',
    recovered: lastStatus === 'pass' && failedAttempts > 0,
  });

  const recoveredCount = repairCycles.filter((c) => c.recovered).length;
  const finalStatus: 'converged' | 'stalled' | 'unknown' =
    lastStatus === 'pass' ? 'converged' :
    failedAttempts > 0 ? 'stalled' : 'unknown';

  return { repairCycles, totalCycles, verifyRepairSequences, recoveredCount, finalStatus };
}

/**
 * Generate structured convergence & self-healing evidence.
 * Reads state and assessment history to reconstruct the loop's convergence story,
 * then writes evidence to .danteforge/evidence/convergence-proof.json.
 */
export async function runConvergenceProof(opts: ConvergenceProofOptions = {}): Promise<ConvergenceProofReport> {
  const { default: nodeFs } = await import('node:fs/promises');
  const cwd = opts.cwd ?? process.cwd();
  const start = Date.now();

  const existsFn = opts._exists ?? (async (p: string) => {
    try { await nodeFs.access(p); return true; } catch { return false; }
  });
  const readFile = opts._readFile ?? ((p: string) => nodeFs.readFile(p, 'utf-8'));
  const writeFile = opts._writeFile ?? ((p: string, c: string) => nodeFs.writeFile(p, c, 'utf-8'));
  const mkdir = opts._mkdir ?? ((p: string, o?: { recursive?: boolean }) => nodeFs.mkdir(p, o));

  // Load state for audit log + convergence fields
  let state: DanteState | undefined;
  try { state = await loadState({ cwd }); } catch { /* best-effort */ }

  const auditLog = state?.auditLog ?? [];
  const failedAttempts = state?.autoforgeFailedAttempts ?? 0;
  const lastStatus = state?.lastVerifyStatus ?? 'unknown';

  const { repairCycles, totalCycles, verifyRepairSequences, recoveredCount, finalStatus } =
    buildRepairCycles(auditLog, failedAttempts, lastStatus);

  // Load assessment history for convergence velocity
  let avgScoreImprovement = 0;
  let monotonic = true;
  try {
    const historyPath = path.join(cwd, '.danteforge', 'assessment-history.json');
    if (await existsFn(historyPath)) {
      const raw = await readFile(historyPath);
      const history = JSON.parse(raw) as Array<{ harshScore: number }>;
      if (history.length >= 2) {
        const deltas: number[] = [];
        for (let i = 1; i < history.length; i++) {
          deltas.push(history[i].harshScore - history[i - 1].harshScore);
        }
        avgScoreImprovement = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        monotonic = deltas.every((d) => d >= 0);
      }
    }
  } catch { /* best-effort */ }

  const report: ConvergenceProofReport = {
    convergence: {
      totalCycles,
      repairCycles,
      verifyRepairSequences,
      recoverySuccessRatio: { total: Math.max(failedAttempts, verifyRepairSequences), successful: recoveredCount },
      convergenceVelocity: { avgScoreImprovement: Math.round(avgScoreImprovement * 10) / 10, monotonic },
      finalStatus,
      duration_ms: Date.now() - start,
      generatedAt: new Date().toISOString(),
    },
  };

  // Write evidence artifact
  try {
    const evidenceDir = path.join(cwd, '.danteforge', 'evidence');
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(path.join(evidenceDir, 'convergence-proof.json'), JSON.stringify(report, null, 2));
  } catch { /* best-effort */ }

  return report;
}

// ── Terminal report formatter ──────────────────────────────────────────────────

export function generateProofReport(report: ProofReport): string {
  const verdictLine =
    report.verdict === 'strong'
      ? '✓ DanteForge significantly improves AI context quality'
      : report.verdict === 'moderate'
        ? '~ DanteForge moderately improves AI context quality'
        : '✗ DanteForge provides minimal improvement over raw prompt';

  const sign = report.improvementPercent >= 0 ? '+' : '';

  return [
    'DanteForge Proof of Value',
    '=========================',
    '',
    'WITHOUT DanteForge (raw prompt):',
    `  Score: ${report.rawScore.total}/100`,
    `  Completeness:    ${report.rawScore.completeness}/20`,
    `  Clarity:         ${report.rawScore.clarity}/20`,
    `  Testability:     ${report.rawScore.testability}/20`,
    `  Context Density: ${report.rawScore.contextDensity}/20`,
    `  Specificity:     ${report.rawScore.specificity}/10`,
    `  Freshness:       ${report.rawScore.freshness}/10`,
    '',
    'WITH DanteForge (structured artifacts):',
    `  PDSE Score: ${report.pdseScore}/100`,
    `  ${report.artifactSummary}`,
    '',
    `IMPROVEMENT: ${sign}${report.improvementPercent.toFixed(0)}% (${report.verdict.toUpperCase()})`,
    `Verdict: ${verdictLine}`,
    '',
    report.recommendation,
  ].join('\n');
}
