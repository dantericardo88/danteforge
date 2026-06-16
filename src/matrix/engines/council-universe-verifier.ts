// Matrix Kernel — CouncilUniverseVerifier
//
// Second-agent verification for universe files. After a researcher writes a
// universe file, an independent verifier (opposite council member) checks:
//   1. OSS leader exists and is cited in ## Sources
//   2. Techniques name real functions/algorithms (not just concepts)
//   3. Score Ladder has concrete, observable evidence per tier
//   4. Judge scoring criteria names specific diff evidence (functions, log lines)
//   5. ## Sources has ≥2 real URLs with dates
//
// On NEEDS_REVISION: notes are returned to the caller (universe-runner), which
// re-invokes the researcher with the original prompt + appended revision notes.
// Only one revision cycle allowed. After that, file is kept with verdict noted.
//
// Storage: .danteforge/compete/universe/<dimId>.verdict.json
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { logger } from '../../core/logger.js';
import { CodexAdapter } from '../adapters/codex-adapter.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code-adapter.js';
import { runAdapter } from '../adapters/adapter-interface.js';
import type { WorkPacket } from '../types/work-graph.js';
import { makeReadOnlyLease } from './council-worktree.js';

export interface VerificationOptions {
  projectPath: string;
  dimId: string;
  dimName: string;
  universeContent: string;
  verifier: 'claude-code' | 'codex';
  timeoutMs?: number;
  _runAdapter?: typeof runAdapter;
}

export interface VerificationResult {
  verdict: 'VERIFIED' | 'NEEDS_REVISION' | 'ERROR';
  reason: string;
  issues: string[];
  suggestedFixes: string[];
}

export interface VerdictRecord {
  dimId: string;
  verifiedBy: string;
  verifiedAt: string;
  verdict: 'VERIFIED' | 'NEEDS_REVISION' | 'ERROR';
  reason: string;
  issues: string[];
  suggestedFixes: string[];
  revised: boolean;
  revisionCount: number;
  /** SHA-256 of the universe file content at verification time. */
  universeSha256: string;
}

/** Mechanical pre-check of the ## Sources table. Returns issue strings if invalid. */
export function checkSourcesTable(content: string): string[] {
  const issues: string[] = [];
  const sourcesMatch = /## Sources([\s\S]*?)(?=\n## |$)/i.exec(content);
  if (!sourcesMatch) {
    issues.push('Missing ## Sources section');
    return issues;
  }

  const rows = (sourcesMatch[1]!.match(/\|[^|]+\|[^|]+\|/g) ?? [])
    .filter(r => !r.includes('---') && !r.toLowerCase().includes('url'));

  if (rows.length < 2) {
    issues.push(`## Sources has ${rows.length} data row(s) — need at least 2`);
  }

  const placeholderPattern = /example\.com|github-url|reddit-url|<github|<reddit|placeholder/i;
  const datePattern = /\d{4}-\d{2}-\d{2}/;
  const urlPattern = /https?:\/\/[^\s|]+/;

  for (const row of rows) {
    if (placeholderPattern.test(row)) {
      issues.push(`Sources row contains placeholder text: ${row.trim().slice(0, 80)}`);
    }
    if (!urlPattern.test(row)) {
      issues.push(`Sources row missing a valid https:// URL: ${row.trim().slice(0, 80)}`);
    }
    if (!datePattern.test(row)) {
      issues.push(`Sources row missing date (YYYY-MM-DD): ${row.trim().slice(0, 80)}`);
    }
  }

  return issues;
}

function verdictDir(projectPath: string): string {
  return path.join(projectPath, '.danteforge', 'compete', 'universe');
}

function verdictPath(projectPath: string, dimId: string): string {
  return path.join(verdictDir(projectPath), `${dimId}.verdict.json`);
}

export async function loadVerdictFile(projectPath: string, dimId: string): Promise<VerdictRecord | null> {
  try {
    const raw = await fs.readFile(verdictPath(projectPath, dimId), 'utf8');
    return JSON.parse(raw) as VerdictRecord;
  } catch { return null; }
}

export async function saveVerdictFile(
  projectPath: string,
  dimId: string,
  result: VerificationResult,
  verifier: string,
  revised = false,
  revisionCount = 0,
  universeContent = '',
): Promise<void> {
  const record: VerdictRecord = {
    dimId,
    verifiedBy: verifier,
    verifiedAt: new Date().toISOString(),
    verdict: result.verdict,
    reason: result.reason,
    issues: result.issues,
    suggestedFixes: result.suggestedFixes,
    revised,
    revisionCount,
    universeSha256: createHash('sha256').update(universeContent).digest('hex'),
  };
  await fs.mkdir(verdictDir(projectPath), { recursive: true });
  await fs.writeFile(verdictPath(projectPath, dimId), JSON.stringify(record, null, 2), 'utf8');
}

function makeVerificationPacket(dimName: string, universeContent: string): WorkPacket {
  return {
    id: `universe-verify.${Date.now()}`,
    dimensionId: 'verify',
    objective: [
      `You are an independent research verifier for the **${dimName}** dimension.`,
      ``,
      `A council member produced the universe file below. Your job: verify its quality and flag issues.`,
      ``,
      `Check ALL of the following:`,
      `1. **OSS Leader** — does it actually exist and lead in this dimension? Is its URL cited in ## Sources?`,
      `2. **Technique specificity** — do "Key techniques" name real functions, algorithms, or patterns?`,
      `   (Not vague concepts like "better context management" — name actual code/algorithm names.)`,
      `3. **Score Ladder** — does each tier (5–10) have CONCRETE, observable evidence requirements?`,
      `   (Not "works better" — e.g., "command exits 0 and stdout matches 'autonomy: enabled'")`,
      `4. **Judge criteria** — does "Evidence to look for in a diff" name specific function signatures,`,
      `   log lines, or file patterns a judge could actually verify?`,
      `5. **Sources** — are at least 2 real, specific URLs with dates cited in ## Sources?`,
      ``,
      `Universe file to verify:`,
      `<universe>`,
      universeContent.slice(0, 8_000),
      `</universe>`,
      ``,
      `Output EXACTLY one of these two formats (no other text):`,
      ``,
      `VERDICT: VERIFIED`,
      `REASON: <1-2 sentences confirming the file meets all quality checks>`,
      ``,
      `OR:`,
      ``,
      `VERDICT: NEEDS_REVISION`,
      `ISSUES:`,
      `- [1] <specific issue — name the section and what is wrong>`,
      `- [2] <specific issue>`,
      `SUGGESTED_FIXES:`,
      `- [1] <what the researcher should correct>`,
      `- [2] <what to correct>`,
    ].join('\n'),
    acceptanceCriteria: ['Output contains VERDICT: VERIFIED or VERDICT: NEEDS_REVISION'],
    proof: { proofRequired: ['VERDICT line present'] },
    globalForbidden: ['.danteforge/compete/matrix.json', '.danteforge/compete/universe/**'],
    context: { mode: 'verify-only' },
  } as unknown as WorkPacket;
}

function parseVerificationOutput(output: string): VerificationResult {
  const verdictMatch = output.match(/VERDICT:\s*(VERIFIED|NEEDS_REVISION)/i);
  if (!verdictMatch) {
    return { verdict: 'ERROR', reason: 'No VERDICT line found in output', issues: [], suggestedFixes: [] };
  }

  const verdict = verdictMatch[1]!.toUpperCase() as 'VERIFIED' | 'NEEDS_REVISION';
  const reasonMatch = output.match(/REASON:\s*(.+?)(?=\n(?:ISSUES:|VERDICT:|$))/is);
  const reason = reasonMatch?.[1]?.trim() ?? '';

  const issues: string[] = [];
  const issuesMatch = output.match(/ISSUES:\s*([\s\S]*?)(?=SUGGESTED_FIXES:|$)/i);
  if (issuesMatch) {
    for (const m of issuesMatch[1]!.matchAll(/- \[\d+\]\s*(.+)/g)) {
      issues.push(m[1]!.trim());
    }
  }

  const fixes: string[] = [];
  const fixesMatch = output.match(/SUGGESTED_FIXES:\s*([\s\S]*?)$/i);
  if (fixesMatch) {
    for (const m of fixesMatch[1]!.matchAll(/- \[\d+\]\s*(.+)/g)) {
      fixes.push(m[1]!.trim());
    }
  }

  return { verdict, reason, issues, suggestedFixes: fixes };
}

/** Assign the opposite council member as verifier (anti-anchoring). */
export function assignVerifier(researcher: 'claude-code' | 'codex'): 'claude-code' | 'codex' {
  return researcher === 'codex' ? 'claude-code' : 'codex';
}

function makeVerifierAdapter(verifier: 'claude-code' | 'codex', workPacket: WorkPacket) {
  if (verifier === 'codex') return new CodexAdapter({ workPacket });
  return new ClaudeCodeAdapter({ workPacket, skipPermissions: true });
}

export async function runSingleDimVerification(opts: VerificationOptions): Promise<VerificationResult> {
  const { projectPath: _projectPath, dimId, dimName, universeContent, verifier, timeoutMs = 300_000, _runAdapter: _run = runAdapter } = opts;

  // Mechanical pre-check: Sources table must be structurally valid before LLM verifier runs.
  const mechanicalIssues = checkSourcesTable(universeContent);
  // Phase 2.3: when grounding is ON, every >7 ladder rung must trace to cited external evidence (not
  // LLM prose). Gated behind DANTEFORGE_GROUNDING_GATE so existing universe generation is unaffected
  // until grounding is turned on, then the yardstick itself must be grounded — the auto-solve's honesty.
  if (process.env['DANTEFORGE_GROUNDING_GATE'] === '1') {
    const { parseScoreLadder } = await import('../../core/rubric-ladder.js');
    const { checkLadderGroundedness } = await import('../../core/ladder-groundedness.js');
    const ground = checkLadderGroundedness(parseScoreLadder(universeContent));
    if (!ground.ok) mechanicalIssues.push(...ground.issues);
  }
  if (mechanicalIssues.length > 0) {
    logger.warn(`[universe-verify] ${dimId}: mechanical Sources check failed (${mechanicalIssues.length} issue(s))`);
    return {
      verdict: 'NEEDS_REVISION',
      reason: 'Sources table failed mechanical validation before LLM verifier ran',
      issues: mechanicalIssues,
      suggestedFixes: mechanicalIssues.map(i => `Fix: ${i}`),
    };
  }

  const workPacket = makeVerificationPacket(dimName, universeContent);
  const lease = makeReadOnlyLease(_projectPath, 'universe-verify');
  const adapter = makeVerifierAdapter(verifier, workPacket);

  try {
    const available = await adapter.isAvailable();
    if (!available) {
      logger.warn(`[universe-verify] ${verifier} not available for ${dimId}`);
      return { verdict: 'ERROR', reason: `${verifier} adapter not available`, issues: [], suggestedFixes: [] };
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Verification timeout after ${timeoutMs}ms`)), timeoutMs),
    );
    const result = await Promise.race([_run(adapter, { lease }), timeoutPromise]);
    const parsed = parseVerificationOutput(result.output ?? '');
    logger.info(`[universe-verify] ${dimId}: ${parsed.verdict}${parsed.issues.length ? ` (${parsed.issues.length} issues)` : ''}`);
    return parsed;
  } catch (err) {
    logger.warn(`[universe-verify] ${dimId} failed: ${String(err).split('\n')[0]}`);
    return { verdict: 'ERROR', reason: String(err).split('\n')[0] ?? 'unknown error', issues: [], suggestedFixes: [] };
  }
}
