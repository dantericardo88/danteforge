// Plan Critic — adversarial plan review engine.
// Finds gaps before they become bugs: platform issues, missing injection seams,
// schema problems, security assumptions, interaction conflicts, and more.
// Three modes: multi-persona LLM / deterministic regex fallback / diff mode.

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';
import { detectAmbiguitySignals } from './ceo-review-engine.js';

// ── Version ───────────────────────────────────────────────────────────────────

export const CRITIQUE_PROMPT_VERSION = 'v1.0';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CritiqueCategory =
  | 'reality'         // plan claims don't match codebase
  | 'interaction'     // two parts of the plan conflict
  | 'ordering'        // build dependencies in wrong sequence
  | 'platform'        // Windows/Linux/Mac incompatibility
  | 'schema'          // missing version field, no migration path
  | 'security'        // auth assumptions, trust chain gaps
  | 'terminology'     // technically wrong language (hash vs signature)
  | 'test-discipline' // missing injection seams, real I/O in tests
  | 'fallback'        // no path when LLM/network/config unavailable
  | 'dependency'      // new runtime dep without justification
  | 'completeness'    // missing prerequisites, ambiguous order
  | 'honesty';        // overstated capability, understated complexity

export type CritiquePersona = 'platform' | 'test-discipline' | 'security' | 'general';

export type CritiqueStakes = 'low' | 'medium' | 'high' | 'critical';

export interface CritiqueGap {
  category: CritiqueCategory;
  severity: 'blocking' | 'high' | 'medium';
  description: string;
  specificFix: string;      // exact instruction, not general advice
  relatedFiles?: string[];
}

export interface CritiqueReport {
  planFile: string;
  gapsFound: CritiqueGap[];
  blockingCount: number;
  highCount: number;
  approved: boolean;              // true only when 0 blocking gaps
  premortemHypotheses: string[];  // top 3 failure modes from pre-mortem
  critiquePromptVersion: string;
  stakes: CritiqueStakes;
  durationMs: number;
}

export interface CritiqueMiss {
  category: CritiqueCategory;
  description: string;
  buildFailureEvidence: string;
  timestamp: string;
}

export interface CritiqueMissLog {
  version: '1.0.0';
  misses: CritiqueMiss[];
  categoryMissCounts: Partial<Record<CritiqueCategory, number>>;
  lastUpdatedAt: string;
}

export interface PlanCriticOptions {
  cwd?: string;
  planContent: string;
  specContent?: string;
  sourceFilesToRead?: string[];
  lessonsContent?: string;
  stakes?: CritiqueStakes;
  personas?: CritiquePersona[];    // defaults to all 4
  enablePremortem?: boolean;       // defaults to true
  diffContent?: string;            // for --diff mode
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  _readFile?: (filePath: string) => Promise<string>;
  _recordMiss?: (miss: CritiqueMiss) => Promise<void>;
}

// ── Deterministic checks (regex, no LLM required) ────────────────────────────

interface DeterministicCheck {
  pattern: RegExp;
  category: CritiqueCategory;
  severity: 'blocking' | 'high' | 'medium';
  description: string;
  fix: string;
}

const DETERMINISTIC_CHECKS: DeterministicCheck[] = [
  {
    // Match ~/ with or without a preceding quote — catches both code and prose
    pattern: /(?:['"`]|[\s:(])~\//,
    category: 'platform',
    severity: 'blocking',
    description: "Hard-coded '~/' home directory path — fails on Windows",
    fix: "Replace '~/' with path.join(os.homedir(), ...) using node:os",
  },
  {
    pattern: /assert\.ok\(true\)/,
    category: 'test-discipline',
    severity: 'high',
    description: 'Vacuous assert.ok(true) — test passes without verifying anything',
    fix: 'Replace with a behavioral assertion on actual output',
  },
  {
    pattern: /callLLM\s*\(/,
    category: 'test-discipline',
    severity: 'blocking',
    description: 'Direct callLLM call detected — needs _llmCaller injection seam',
    fix: 'Add _llmCaller?: (prompt: string) => Promise<string> to options interface, call opts._llmCaller ?? callLLM',
  },
  {
    pattern: /process\.chdir\(/,
    category: 'test-discipline',
    severity: 'high',
    description: 'process.chdir() in tests causes global state mutation across test suite',
    fix: 'Use cwd? injection parameter instead of process.chdir()',
  },
];

// Ambiguity signals that indicate vague/uncommitted plan language (reuses CEO engine logic)
const PLAN_VAGUENESS_SIGNALS = [
  'somehow', 'maybe', 'probably', 'TBD', 'figure out', 'not sure', 'unclear',
  'something like', 'kind of', 'roughly', 'approximately',
];

/**
 * Run purely deterministic checks against plan + source file content.
 * Works offline — no LLM required. Returns gaps for common DanteForge failure patterns.
 */
export function runDeterministicChecks(planContent: string, sourceFiles: string): CritiqueGap[] {
  const combined = planContent + '\n' + sourceFiles;
  const gaps: CritiqueGap[] = [];

  for (const check of DETERMINISTIC_CHECKS) {
    if (check.pattern.test(combined)) {
      gaps.push({
        category: check.category,
        severity: check.severity,
        description: check.description,
        specificFix: check.fix,
      });
    }
  }

  // Vagueness check via CEO engine's ambiguity signal detection
  const ambiguitySignals = detectAmbiguitySignals(planContent);
  const planVague = PLAN_VAGUENESS_SIGNALS.filter(s => planContent.toLowerCase().includes(s));
  const allVague = [...new Set([...ambiguitySignals, ...planVague])];
  if (allVague.length >= 3) {
    gaps.push({
      category: 'honesty',
      severity: 'medium',
      description: `Plan contains ${allVague.length} vague language signals: ${allVague.slice(0, 5).join(', ')}`,
      specificFix: 'Replace vague terms with specific, measurable, verifiable statements. Each claim should be falsifiable.',
    });
  }

  return gaps;
}

// ── Critique prompt builders (per persona) ────────────────────────────────────

const PERSONA_CATEGORIES: Record<CritiquePersona, CritiqueCategory[]> = {
  platform: ['platform'],
  'test-discipline': ['test-discipline'],
  security: ['security', 'terminology'],
  general: ['reality', 'interaction', 'ordering', 'schema', 'fallback', 'dependency', 'completeness', 'honesty'],
};

const PERSONA_INSTRUCTIONS: Record<CritiquePersona, string> = {
  platform: `Focus ONLY on platform compatibility issues:
- Hard-coded '~/' paths (use os.homedir())
- Path separator assumptions (use path.join, not string concatenation with '/')
- Shell command syntax that differs between bash and cmd.exe
- Case-sensitivity assumptions (Windows filesystems are case-insensitive)
- Environment variable names that differ across platforms
- process.platform checks that may be incomplete`,

  'test-discipline': `Focus ONLY on test infrastructure and injection seam discipline:
- Functions that call callLLM/isLLMAvailable directly without _llmCaller seam
- Functions that do fs I/O without _readFile/_writeFile injection
- Tests using process.chdir() instead of cwd? injection
- assert.ok(true) or assert.ok(false) vacuous assertions
- Tests that would make real network calls if injection seam is not provided
- Missing beforeEach/afterEach cleanup for temp directories
- Structural text-grep assertions instead of behavioral assertions`,

  security: `Focus ONLY on security, trust, and terminology correctness:
- MCP tools or commands described as "safe" that write files, run processes, or make network calls
- External content (OSS patterns, user input) injected into commands without sanitization
- Cryptographic hashes presented as signatures (SHA-256 is NOT a signature)
- "Autonomous" used for operations that require human approval
- API keys or secrets in hardcoded paths or strings
- Operations that bypass safe-self-edit approval flow
- Authorization gates missing on destructive operations`,

  general: `Focus on all remaining plan quality issues:
[REALITY] Claims about existing functions/files that don't exist in the codebase
[INTERACTION] Two sprints modifying the same function incompatibly, or feature A requiring feature B scheduled after it
[ORDERING] Build dependencies in wrong sequence (tests before injection seams, commands before modules they depend on)
[SCHEMA] New JSON files missing version: '1.0.0' field, no safe empty-state return when file missing
[FALLBACK] Missing deterministic fallback when LLM/network/config unavailable
[DEPENDENCY] New npm packages where a zero-dependency alternative exists
[COMPLETENESS] Sprint steps without explicit prerequisites, ambiguous "implement X and Y" where Y depends on X
[HONESTY] Tasks described as "simple" that require significant architectural changes, performance claims without benchmarks`,
};

/**
 * Build the critique prompt for a specific persona.
 */
export function buildCritiquePrompt(
  persona: CritiquePersona,
  planContent: string,
  sourceFiles: string,
  lessonsContent: string,
  stakes: string,
  diffContent?: string,
): string {
  const categories = PERSONA_CATEGORIES[persona];
  const instructions = PERSONA_INSTRUCTIONS[persona];

  const stakeNote = stakes === 'low'
    ? 'LOW STAKES: Only report blocking issues.'
    : stakes === 'high' || stakes === 'critical'
    ? 'HIGH STAKES: Report all issues including medium severity.'
    : 'Report blocking and high severity issues.';

  const diffSection = diffContent
    ? `\nDIFF TO REVIEW (check built code matches the plan):\n${diffContent.slice(0, 3000)}\n`
    : '';

  const sourceSection = sourceFiles.trim()
    ? `\nRELEVANT SOURCE FILES:\n${sourceFiles.slice(0, 4000)}\n`
    : '';

  const lessonsSection = lessonsContent.trim()
    ? `\nLESSONS FROM PRIOR FAILURES (avoid repeating these):\n${lessonsContent.slice(0, 1500)}\n`
    : '';

  return `You are a ${persona.toUpperCase()} critic performing ADVERSARIAL review of a build plan.
Critique prompt version: ${CRITIQUE_PROMPT_VERSION}
Stakes: ${stakeNote}

Your job is to BREAK the plan — find gaps before they become bugs.
You are NOT validating. You are attacking specific claims.
${instructions}
${sourceSection}${lessonsSection}${diffSection}
PLAN TO CRITIQUE:
${planContent.slice(0, 5000)}

For every gap found, output a JSON object. If no gaps, return empty array.
Be specific: name the exact file, line, or function where the fix must go.

Respond with ONLY valid JSON array (no markdown, no explanation):
[
  {
    "category": "${categories[0]}",
    "severity": "blocking|high|medium",
    "description": "one sentence describing the exact problem",
    "specificFix": "exact instruction with file path and function name",
    "relatedFiles": ["optional/file/paths"]
  }
]`;
}

// ── Response parsing ──────────────────────────────────────────────────────────

/**
 * Parse LLM critique response into CritiqueGap array.
 * Returns empty array on malformed JSON — never throws.
 */
export function parseCritiqueResponse(llmOutput: string): CritiqueGap[] {
  try {
    // Strip markdown code fences if present
    const cleaned = llmOutput
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```$/m, '')
      .trim();

    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item): CritiqueGap[] => {
      if (typeof item !== 'object' || item === null) return [];
      const g = item as Record<string, unknown>;
      if (typeof g['category'] !== 'string' || typeof g['description'] !== 'string') return [];

      const validCategories: CritiqueCategory[] = [
        'reality', 'interaction', 'ordering', 'platform', 'schema', 'security',
        'terminology', 'test-discipline', 'fallback', 'dependency', 'completeness', 'honesty',
      ];
      const validSeverities = ['blocking', 'high', 'medium'] as const;

      const category = validCategories.includes(g['category'] as CritiqueCategory)
        ? (g['category'] as CritiqueCategory)
        : 'honesty';
      const severity = validSeverities.includes(g['severity'] as typeof validSeverities[number])
        ? (g['severity'] as typeof validSeverities[number])
        : 'medium';

      return [{
        category,
        severity,
        description: String(g['description']),
        specificFix: typeof g['specificFix'] === 'string' ? g['specificFix'] : 'See description.',
        relatedFiles: Array.isArray(g['relatedFiles'])
          ? (g['relatedFiles'] as unknown[]).filter(f => typeof f === 'string') as string[]
          : undefined,
      }];
    });
  } catch {
    return [];
  }
}

// ── Pre-mortem ────────────────────────────────────────────────────────────────

function buildPremortemPrompt(planContent: string): string {
  return `You are analyzing a build plan to identify failure modes BEFORE the build starts.

PLAN:
${planContent.slice(0, 3000)}

If this plan fails during implementation, what are the top 3 most likely reasons?
Consider: underestimated complexity, missing prerequisites, conflicting assumptions, platform issues.

Respond with ONLY a JSON array of 3 strings, ranked by likelihood (most likely first):
["reason 1", "reason 2", "reason 3"]`;
}

async function runPremortem(
  planContent: string,
  llm: (p: string) => Promise<string>,
): Promise<string[]> {
  try {
    const response = await llm(buildPremortemPrompt(planContent));
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    return Array.isArray(parsed)
      ? parsed.filter(s => typeof s === 'string') as string[]
      : [];
  } catch {
    return [];
  }
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function deduplicateGaps(gaps: CritiqueGap[]): CritiqueGap[] {
  const seen = new Set<string>();
  return gaps.filter(g => {
    const key = `${g.category}:${g.description.slice(0, 60)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Stakes → active personas ──────────────────────────────────────────────────

function activePersonas(stakes: CritiqueStakes, requested?: CritiquePersona[]): CritiquePersona[] {
  if (requested && requested.length > 0) return requested;
  if (stakes === 'low') return ['general'];
  if (stakes === 'medium') return ['platform', 'test-discipline', 'general'];
  return ['platform', 'test-discipline', 'security', 'general']; // high + critical
}

// ── Source file loader ────────────────────────────────────────────────────────

async function loadSourceFiles(
  files: string[],
  readFile: (p: string) => Promise<string>,
): Promise<string> {
  const parts: string[] = [];
  for (const filePath of files.slice(0, 5)) {
    try {
      const content = await readFile(filePath);
      parts.push(`=== ${filePath} ===\n${content.slice(0, 1500)}`);
    } catch { /* skip unreadable files */ }
  }
  return parts.join('\n\n');
}

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Run adversarial critique of a plan. Combines deterministic regex checks
 * with optional multi-persona LLM analysis.
 */
export async function critiquePlan(opts: PlanCriticOptions): Promise<CritiqueReport> {
  const start = Date.now();
  const stakes = opts.stakes ?? 'medium';
  const cwd = opts.cwd ?? process.cwd();

  const readFile = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

  const llmAvailable = opts._isLLMAvailable
    ? await opts._isLLMAvailable()
    : false;

  const llm = opts._llmCaller ?? (llmAvailable ? (await import('./llm.js')).callLLM : null);

  // Load source files for context
  const sourceFiles = opts.sourceFilesToRead && opts.sourceFilesToRead.length > 0
    ? await loadSourceFiles(opts.sourceFilesToRead, readFile)
    : '';

  // Load lessons for context (or use provided)
  let lessonsContent = opts.lessonsContent ?? '';
  if (!lessonsContent && llmAvailable) {
    try {
      const lessonsPath = path.join(cwd, '.danteforge', 'lessons.md');
      lessonsContent = await readFile(lessonsPath);
    } catch { /* no lessons yet */ }
  }

  // 1. Always run deterministic checks
  const deterministicGaps = runDeterministicChecks(opts.planContent, sourceFiles);

  // 2. LLM persona critiques (parallel, best-effort)
  const llmGaps: CritiqueGap[] = [];
  if (llm) {
    const personas = activePersonas(stakes, opts.personas);
    const personaResults = await Promise.allSettled(
      personas.map(async (persona) => {
        const prompt = buildCritiquePrompt(
          persona,
          opts.planContent,
          sourceFiles,
          lessonsContent,
          stakes,
          opts.diffContent,
        );
        const response = await llm(prompt);
        return parseCritiqueResponse(response);
      }),
    );
    for (const result of personaResults) {
      if (result.status === 'fulfilled') {
        llmGaps.push(...result.value);
      }
    }
  }

  // 3. Pre-mortem (separate LLM call)
  const premortemHypotheses: string[] = [];
  const enablePremortem = opts.enablePremortem !== false;
  if (llm && enablePremortem) {
    const hypotheses = await runPremortem(opts.planContent, llm);
    premortemHypotheses.push(...hypotheses);
  }

  // Merge and deduplicate
  const allGaps = deduplicateGaps([...deterministicGaps, ...llmGaps]);
  const blockingCount = allGaps.filter(g => g.severity === 'blocking').length;
  const highCount = allGaps.filter(g => g.severity === 'high').length;

  return {
    planFile: opts.cwd ? path.join(opts.cwd, 'PLAN.md') : 'PLAN.md',
    gapsFound: allGaps,
    blockingCount,
    highCount,
    approved: blockingCount === 0,
    premortemHypotheses,
    critiquePromptVersion: CRITIQUE_PROMPT_VERSION,
    stakes,
    durationMs: Date.now() - start,
  };
}

// ── Report printer ────────────────────────────────────────────────────────────

/**
 * Print a CritiqueReport to the logger in human-readable format.
 */
export function printCritiqueReport(report: CritiqueReport): void {
  const statusIcon = report.approved ? '✓' : '✗';
  const statusLabel = report.approved ? 'APPROVED' : 'BLOCKED';

  logger.info(`\n${'─'.repeat(60)}`);
  logger.info(`  PLAN CRITIQUE REPORT  [${statusIcon} ${statusLabel}]`);
  logger.info(`  Stakes: ${report.stakes} | Version: ${report.critiquePromptVersion} | ${report.durationMs}ms`);
  logger.info(`${'─'.repeat(60)}`);

  if (report.gapsFound.length === 0) {
    logger.info('  No gaps found. Plan approved.');
  } else {
    logger.info(`  ${report.blockingCount} blocking | ${report.highCount} high | ${report.gapsFound.length - report.blockingCount - report.highCount} medium\n`);

    for (const gap of report.gapsFound) {
      const icon = gap.severity === 'blocking' ? '✗' : gap.severity === 'high' ? '!' : '·';
      logger.info(`  [${icon}] [${gap.category}] ${gap.description}`);
      logger.info(`      Fix: ${gap.specificFix}`);
      if (gap.relatedFiles && gap.relatedFiles.length > 0) {
        logger.info(`      Files: ${gap.relatedFiles.join(', ')}`);
      }
    }
  }

  if (report.premortemHypotheses.length > 0) {
    logger.info(`\n  PRE-MORTEM — Top failure modes:`);
    report.premortemHypotheses.forEach((h, i) => logger.info(`  ${i + 1}. ${h}`));
  }

  logger.info(`${'─'.repeat(60)}\n`);
}

// ── Critique misses persistence ───────────────────────────────────────────────

const MISSES_FILENAME = 'critique-misses.json';
const MISS_ALERT_THRESHOLD = 3;

function getMissesPath(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge', MISSES_FILENAME);
}

async function loadMissLog(cwd?: string): Promise<CritiqueMissLog> {
  try {
    const raw = await fs.readFile(getMissesPath(cwd), 'utf8');
    const parsed = JSON.parse(raw) as CritiqueMissLog;
    return { ...parsed, categoryMissCounts: parsed.categoryMissCounts ?? {} };
  } catch {
    return {
      version: '1.0.0',
      misses: [],
      categoryMissCounts: {},
      lastUpdatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Record a critique miss — a gap that critique should have caught but didn't,
 * revealed by a subsequent build failure.
 */
export async function recordCritiqueMiss(miss: CritiqueMiss, cwd?: string): Promise<void> {
  try {
    const log = await loadMissLog(cwd);
    log.misses.push(miss);
    log.categoryMissCounts[miss.category] = (log.categoryMissCounts[miss.category] ?? 0) + 1;
    log.lastUpdatedAt = new Date().toISOString();

    const count = log.categoryMissCounts[miss.category] ?? 0;
    if (count >= MISS_ALERT_THRESHOLD) {
      logger.warn(
        `[plan-critic] Category '${miss.category}' has ${count} misses. ` +
        `Consider deepening checks for this category.`,
      );
    }

    const dir = path.join(cwd ?? process.cwd(), '.danteforge');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(getMissesPath(cwd), JSON.stringify(log, null, 2), 'utf8');
  } catch (err) {
    logger.warn(`[plan-critic] Failed to record critique miss: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Load all critique misses log.
 */
export async function loadCritiqueMisses(cwd?: string): Promise<CritiqueMiss[]> {
  const log = await loadMissLog(cwd);
  return log.misses;
}
