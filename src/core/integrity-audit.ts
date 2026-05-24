// integrity-audit.ts — Completion-integrity audit engine.
// Treats all prior score claims as untrusted. Re-derives scores from
// independently verified evidence against the 10-tier rubric.
// Code without a receipt is a hypothesis, not a feature.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MatrixDimension } from './compete-matrix.js';
import type {
  StubFinding,
  CapabilityTestResult,
  ScoreCapResult,
  IntegrityAuditRecord,
  CapabilityStatus,
  EvidenceLevel,
  ScoringScriptAudit,
} from '../matrix/types/integrity.js';

const execFileAsync = promisify(execFile);
const CAP_TEST_TIMEOUT_MS = 60_000;
const STUB_SCAN_TIMEOUT_MS = 10_000;

// ── Stub pattern registry ─────────────────────────────────────────────────────
// These patterns in the EXECUTION PATH indicate incomplete implementation.

export const STUB_PATTERNS: ReadonlyArray<{ pattern: string; regex: RegExp }> = [
  { pattern: 'TODO',               regex: /\bTODO\b/i },
  { pattern: 'FIXME',              regex: /\bFIXME\b/i },
  { pattern: 'stub',               regex: /\bstub\b/i },
  { pattern: 'placeholder',        regex: /\bplaceholder\b/i },
  { pattern: 'not implemented',    regex: /not\s+implemented/i },
  { pattern: 'coming soon',        regex: /coming\s+soon/i },
  { pattern: 'hardcoded',          regex: /\bhardcoded?\b/i },
  { pattern: 'fake',               regex: /\bfake\b/i },
  { pattern: 'dummy',              regex: /\bdummy\b/i },
  { pattern: 'throw.*not.*impl',   regex: /throw\s+new\s+Error\(['"`][^'"`]*not\s+impl/i },
  { pattern: 'jest.mock(',         regex: /jest\.mock\s*\(/ },
  { pattern: 'vi.mock(',           regex: /vi\.mock\s*\(/ },
  { pattern: 'sinon.stub(',        regex: /sinon\.stub\s*\(/ },
  { pattern: 'test.skip',          regex: /\bit\.skip\b|\btest\.skip\b|\bxtest\b|\bxit\b/ },
  { pattern: 'describe.skip',      regex: /\bdescribe\.skip\b|\bxdescribe\b/ },
] as const;

// ── Stub scanner ──────────────────────────────────────────────────────────────

export interface RawStubHit {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

export async function scanForStubs(cwd: string): Promise<RawStubHit[]> {
  const srcDir = path.join(cwd, 'src');
  const hits: RawStubHit[] = [];

  try {
    await fs.access(srcDir);
  } catch {
    return hits;
  }

  for (const { pattern, regex } of STUB_PATTERNS) {
    try {
      const { stdout } = await execFileAsync(
        'grep',
        ['-rn', '--include=*.ts', regex.source, srcDir],
        { timeout: STUB_SCAN_TIMEOUT_MS, cwd },
      ).catch(() => ({ stdout: '' }));

      for (const rawLine of stdout.split('\n')) {
        if (!rawLine.trim()) continue;
        const colonIdx = rawLine.indexOf(':');
        const rest = rawLine.slice(colonIdx + 1);
        const lineNumIdx = rest.indexOf(':');
        const file = rawLine.slice(0, colonIdx);
        const lineNum = parseInt(rest.slice(0, lineNumIdx), 10);
        const snippet = rest.slice(lineNumIdx + 1).trim();

        if (!isNaN(lineNum) && file) {
          hits.push({ file: path.relative(cwd, file), line: lineNum, pattern, snippet: snippet.slice(0, 120) });
        }
      }
    } catch {
      // grep failing means no matches — continue
    }
  }

  return hits;
}

// ── Critical path heuristic ───────────────────────────────────────────────────
// Determines whether a stub finding is likely in the execution path for a dim.
// Heuristic: file name or directory matches the dimension id or its label words.

export function isInCriticalPath(filePath: string, dim: MatrixDimension): boolean {
  const f = filePath.toLowerCase();
  const words = [dim.id, ...dim.label.toLowerCase().split(/\W+/).filter(w => w.length > 3)];
  return words.some(w => f.includes(w.replace(/_/g, '-')) || f.includes(w.replace(/-/g, '_')));
}

// ── Capability test runner ────────────────────────────────────────────────────

export async function runCapabilityTest(
  dim: MatrixDimension,
  cwd: string,
): Promise<CapabilityTestResult | null> {
  const capTest = (dim as unknown as Record<string, unknown>)['capability_test'];
  if (!capTest || typeof capTest !== 'object') return null;

  const cmd = (capTest as { command?: string }).command;
  if (!cmd || typeof cmd !== 'string') return null;

  const t0 = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(
      process.platform === 'win32' ? 'cmd' : 'sh',
      process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd],
      { cwd, timeout: CAP_TEST_TIMEOUT_MS },
    );
    return {
      command: cmd,
      exitCode: 0,
      passed: true,
      durationMs: Date.now() - t0,
      stdout: stdout.slice(0, 500),
      stderr: stderr.slice(0, 200),
    };
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      command: cmd,
      exitCode: e.code ?? 1,
      passed: false,
      durationMs: Date.now() - t0,
      stdout: (e.stdout ?? '').slice(0, 500),
      stderr: (e.stderr ?? '').slice(0, 200),
    };
  }
}

// ── Score cap engine ──────────────────────────────────────────────────────────
// Implements the 10-tier rubric from the integrity audit protocol verbatim.

export function computeScoreCap(opts: {
  capabilityTestResult: CapabilityTestResult | null;
  outcomeCount: number;
  passingOutcomes: number;
  criticalPathStubCount: number;
  anyStubInPath: boolean;
  hasSrcImplementation: boolean;
}): ScoreCapResult {
  const { capabilityTestResult, outcomeCount, passingOutcomes, criticalPathStubCount, anyStubInPath, hasSrcImplementation } = opts;

  if (!hasSrcImplementation) {
    return { cap: 1, reason: 'No meaningful implementation found in src/', evidenceLevel: 'missing' };
  }

  if (!capabilityTestResult) {
    return { cap: 4, reason: 'Code exists but no capability_test declared — cannot prove it runs', evidenceLevel: 'code-exists' };
  }

  if (!capabilityTestResult.passed) {
    return { cap: 4, reason: `capability_test failed (exit ${capabilityTestResult.exitCode}) — code exists but not proven to run`, evidenceLevel: 'code-exists' };
  }

  if (outcomeCount === 0) {
    return { cap: 5, reason: 'capability_test passes but no outcomes declared — unit evidence only, E2E unproven', evidenceLevel: 'unit-tests' };
  }

  if (passingOutcomes === 0) {
    return { cap: 5, reason: `capability_test passes but 0/${outcomeCount} outcomes verified — E2E unproven`, evidenceLevel: 'unit-tests' };
  }

  const passingRatio = passingOutcomes / outcomeCount;

  if (anyStubInPath && criticalPathStubCount > 0) {
    return {
      cap: 6,
      reason: `E2E workflow has ${criticalPathStubCount} stub/mock/TODO finding(s) in the critical path — capped at 6`,
      evidenceLevel: 'mocks-only',
    };
  }

  if (passingRatio < 0.7) {
    return {
      cap: 7,
      reason: `Only ${passingOutcomes}/${outcomeCount} outcomes pass (${Math.round(passingRatio * 100)}%) — E2E works with material caveats`,
      evidenceLevel: 'e2e-with-caveats',
    };
  }

  if (passingRatio < 1.0) {
    return {
      cap: 8,
      reason: `${passingOutcomes}/${outcomeCount} outcomes pass — near-complete E2E but not all scenarios verified`,
      evidenceLevel: 'e2e-realistic',
    };
  }

  // All outcomes pass, capability_test passes, no critical path stubs
  return {
    cap: 9,
    reason: `All ${outcomeCount}/${outcomeCount} outcomes pass, capability_test passes, no critical-path stubs found`,
    evidenceLevel: 'production-real',
  };
}

// ── Scoring script auditor ────────────────────────────────────────────────────
// The scoring script is evidence, not authority. Validate that it doesn't
// produce hardcoded results.

export async function auditScoringScript(cwd: string): Promise<ScoringScriptAudit> {
  const scriptPath = path.join(cwd, 'scripts', 'evidence-rescore.mjs');
  const rel = 'scripts/evidence-rescore.mjs';
  const issues: string[] = [];

  let content = '';
  try {
    content = await fs.readFile(scriptPath, 'utf8');
  } catch {
    return { scriptPath: rel, hardcodedScoreLines: [], readsEvidenceFiles: false, valid: false, issues: ['Script not found'] };
  }

  const lines = content.split('\n');
  const hardcodedScoreLines: Array<{ line: number; content: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? '';
    // Flag lines that assign a literal number directly to a score field
    if (/scores\s*\.\s*self\s*=\s*\d+/.test(l) || /score\s*=\s*\d+(?:\.\d+)?[^.]/.test(l)) {
      hardcodedScoreLines.push({ line: i + 1, content: l.trim() });
    }
  }

  const readsEvidenceFiles =
    content.includes('loadOutcomeEvidence') ||
    content.includes('evidence') ||
    content.includes('.danteforge');

  if (hardcodedScoreLines.length > 0) {
    issues.push(`${hardcodedScoreLines.length} line(s) appear to assign hardcoded score values`);
  }
  if (!readsEvidenceFiles) {
    issues.push('Script does not appear to read evidence files — scores may be fabricated');
  }

  return {
    scriptPath: rel,
    hardcodedScoreLines,
    readsEvidenceFiles,
    valid: issues.length === 0,
    issues,
  };
}

// ── Status classifier ─────────────────────────────────────────────────────────

export function classifyStatus(cap: ScoreCapResult): CapabilityStatus {
  const level: EvidenceLevel = cap.evidenceLevel;
  if (level === 'missing') return 'missing';
  if (level === 'docs-only') return 'claimed';
  if (level === 'code-exists') return 'structural';
  if (level === 'unit-tests' || level === 'mocks-only') return 'partially-verified';
  return 'verified'; // e2e-with-caveats, e2e-realistic, production-real
}

// ── Record builder ────────────────────────────────────────────────────────────

export function buildAuditRecord(opts: {
  dim: MatrixDimension;
  capTestResult: CapabilityTestResult | null;
  capResult: ScoreCapResult;
  stubFindings: StubFinding[];
  outcomeCount: number;
  passingOutcomes: number;
  hasSrcImplementation: boolean;
}): IntegrityAuditRecord {
  const { dim, capTestResult, capResult, stubFindings, outcomeCount, passingOutcomes } = opts;
  const priorScore = dim.scores['self'] ?? 0;
  const adjScore = Math.min(priorScore, capResult.cap);
  const capApplied = adjScore < priorScore ? capResult.cap : null;

  const whatWorks: string[] = [];
  const whatDoesNotWork: string[] = [];
  const whatIsUnverified: string[] = [];

  if (capTestResult?.passed) {
    whatWorks.push(`capability_test passes: \`${capTestResult.command}\``);
  } else if (capTestResult) {
    whatDoesNotWork.push(`capability_test failed (exit ${capTestResult.exitCode}): \`${capTestResult.command}\``);
  } else {
    whatIsUnverified.push('No capability_test declared for this dimension');
  }

  if (passingOutcomes > 0) {
    whatWorks.push(`${passingOutcomes}/${outcomeCount} outcome receipts verified`);
  }
  if (passingOutcomes < outcomeCount && outcomeCount > 0) {
    whatDoesNotWork.push(`${outcomeCount - passingOutcomes}/${outcomeCount} outcomes not passing`);
  }
  if (outcomeCount === 0) {
    whatIsUnverified.push('No outcomes declared — E2E workflow not verifiable by this system');
  }

  const criticalStubs = stubFindings.filter(s => s.inCriticalPath);
  if (criticalStubs.length > 0) {
    whatDoesNotWork.push(`${criticalStubs.length} stub/TODO finding(s) in critical path`);
  }

  const leaderScore = Math.max(
    ...Object.entries(dim.scores)
      .filter(([k]) => k !== 'self')
      .map(([, v]) => v),
    0,
  );

  return {
    dimension: dim.id,
    label: dim.label,
    claimedCapability: dim.label,
    actualCompetitorLeader: dim.leader ?? dim.oss_leader ?? 'unknown',
    ourScorePre: priorScore,
    ourScore: adjScore,
    leaderScore,
    gapToLeader: Math.max(0, leaderScore - adjScore),
    capApplied,
    capReason: capApplied !== null ? capResult.reason : null,
    evidenceInspected: capTestResult
      ? [`capability_test: ${capTestResult.command}`]
      : [],
    commandsRun: capTestResult ? [capTestResult.command] : [],
    testsRun: outcomeCount > 0 ? [`${outcomeCount} declared outcomes`] : [],
    endToEndVerified: capResult.evidenceLevel === 'e2e-realistic' || capResult.evidenceLevel === 'production-real',
    stubFindings,
    whatWorks,
    whatDoesNotWork,
    whatIsUnverified,
    reasonForScore: capResult.reason,
    highestImpactNextAction: deriveNextAction(capResult, outcomeCount, passingOutcomes, criticalStubs.length),
    status: classifyStatus(capResult),
    auditedAt: new Date().toISOString(),
  };
}

function deriveNextAction(
  cap: ScoreCapResult,
  outcomeCount: number,
  passingOutcomes: number,
  criticalStubCount: number,
): string {
  if (cap.evidenceLevel === 'missing') return 'Implement the capability from scratch';
  if (cap.evidenceLevel === 'docs-only') return 'Write working code — documentation does not count as capability';
  if (cap.evidenceLevel === 'code-exists') return 'Add capability_test: a command that exits 0 when the feature actually works';
  if (cap.evidenceLevel === 'unit-tests') return 'Declare outcomes in matrix.json and run `danteforge validate <dim>` to produce E2E receipts';
  if (cap.evidenceLevel === 'mocks-only') {
    return criticalStubCount > 0
      ? `Replace ${criticalStubCount} stub/mock/TODO finding(s) in the critical path with real implementations`
      : 'Wire real integrations — remove fake adapters from the execution path';
  }
  if (passingOutcomes < outcomeCount) {
    return `Fix ${outcomeCount - passingOutcomes} failing outcome(s) to reach full E2E coverage`;
  }
  return 'Run competitive benchmark against the actual leader to confirm parity';
}
