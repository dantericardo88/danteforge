// PRD Reader — Phase 1.1 of PRD-MATRIX-ORCHESTRATION-V1.
//
// Reads a markdown PRD, extracts a structured ProjectIntent.
// Three modes: --prompt (emit prompt, no LLM call), llm (call LLM API),
// local (heuristic regex extraction). Schema-validated; throws when
// confidence falls below minConfidence.

import fs from 'node:fs/promises';
import path from 'node:path';
import { callLLM, isLLMAvailable } from '../core/llm.js';
import { saveOrch, appendAudit, ensureOrchDir } from './state-io.js';
import type {
  ProjectIntent,
  ProjectType,
  TargetUser,
  ConstraintEmphasis,
  FrontierTarget,
} from './types.js';

// ── Public API ──────────────────────────────────────────────────────────────

export class PrdExtractionError extends Error {
  constructor(message: string, public readonly confidence?: number) {
    super(message);
    this.name = 'PrdExtractionError';
  }
}

export interface PrdReaderOptions {
  cwd?: string;
  mode?: 'llm' | 'prompt' | 'local';
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  _readFile?: (p: string) => Promise<string>;
  _now?: () => string;
  /** Below this, extractProjectIntent throws PrdExtractionError. Default 0.6. */
  minConfidence?: number;
  /** When mode === 'prompt', the rendered prompt is returned (and emitted to stdout). */
  _stdoutWrite?: (s: string) => void;
  /** Runtime context tag (the orchestrator passes its runId). */
  runId?: string;
}

const VALID_PROJECT_TYPES: ProjectType[] = [
  'cli_tool', 'ide_extension', 'agent_runtime', 'saas',
  'internal_tool', 'library', 'web_app', 'mobile_app', 'other',
];

const VALID_TARGET_USERS: TargetUser[] = [
  'developer', 'non_technical', 'both', 'enterprise', 'researcher', 'specific_role',
];

const VALID_CONSTRAINTS: ConstraintEmphasis[] = [
  'security_critical', 'performance_critical', 'ux_critical',
  'integration_critical', 'cost_critical', 'compliance_critical',
];

const VALID_TARGETS: FrontierTarget[] = [
  'oss_frontier', 'closed_source_frontier', 'category_definer',
];

// ── Markdown sectioning (tiny regex — no parser) ───────────────────────────

interface MarkdownSection {
  heading: string;
  level: number;
  body: string;
}

export function parseMarkdownSections(md: string): MarkdownSection[] {
  // Strip code fences first so headings inside them are not parsed.
  const stripped = md.replace(/```[\s\S]*?```/g, '');
  const lines = stripped.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current) sections.push(current);
      current = { heading: match[2]!.trim(), level: match[1]!.length, body: '' };
    } else if (current) {
      current.body += line + '\n';
    } else {
      // Preamble before any heading attaches to a synthetic root.
      if (sections.length === 0) {
        current = { heading: '__preamble__', level: 0, body: line + '\n' };
      }
    }
  }
  if (current) sections.push(current);
  return sections;
}

// ── Prompt builder ─────────────────────────────────────────────────────────

function buildExtractionPrompt(prdText: string, sectionHeadings: string[]): string {
  return [
    'You extract structured project intent from a product requirements document (PRD).',
    'Reply with ONLY a single JSON object, no prose, no markdown fences.',
    '',
    'Required JSON shape:',
    '{',
    '  "projectName": string,',
    '  "goal": string (one sentence),',
    `  "projectType": one of [${VALID_PROJECT_TYPES.map(t => `"${t}"`).join(', ')}],`,
    `  "targetUser": one of [${VALID_TARGET_USERS.map(t => `"${t}"`).join(', ')}],`,
    '  "targetRoleDetail"?: string (only if targetUser === "specific_role"),',
    '  "keyFeatures": string[] (3-12 items),',
    `  "constraintEmphasis": Array of [${VALID_CONSTRAINTS.map(t => `"${t}"`).join(', ')}],`,
    '  "nonGoals": string[],',
    '  "competitiveCategoryBoundary": { "direct": string[], "adjacent": string[], "research": string[] },',
    '  "frontierFraming": {',
    `    "target": one of [${VALID_TARGETS.map(t => `"${t}"`).join(', ')}],`,
    '    "matchLeaderOn": string[], "exceedLeaderOn": string[], "defineNewCategoryOn": string[]',
    '  },',
    '  "confidence": number 0..1',
    '}',
    '',
    `Detected sections in PRD: ${sectionHeadings.join(' | ')}`,
    '',
    '— BEGIN PRD —',
    prdText,
    '— END PRD —',
  ].join('\n');
}

// ── Schema validator ───────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  intent?: Omit<ProjectIntent, 'sourcePath' | 'extractedAt'>;
  errors: string[];
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

function getRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function validateProjectIntent(input: unknown): ValidationResult {
  const errors: string[] = [];
  const rec = getRecord(input);
  if (!rec) return { ok: false, errors: ['input is not a JSON object'] };

  const projectName = rec.projectName;
  if (typeof projectName !== 'string' || projectName.trim().length === 0) {
    errors.push('projectName must be a non-empty string');
  }
  const goal = rec.goal;
  if (typeof goal !== 'string' || goal.trim().length === 0) {
    errors.push('goal must be a non-empty string');
  }
  const projectType = rec.projectType;
  if (typeof projectType !== 'string' || !VALID_PROJECT_TYPES.includes(projectType as ProjectType)) {
    errors.push(`projectType must be one of ${VALID_PROJECT_TYPES.join(',')}`);
  }
  const targetUser = rec.targetUser;
  if (typeof targetUser !== 'string' || !VALID_TARGET_USERS.includes(targetUser as TargetUser)) {
    errors.push(`targetUser must be one of ${VALID_TARGET_USERS.join(',')}`);
  }
  const keyFeatures = rec.keyFeatures;
  if (!isStringArray(keyFeatures) || keyFeatures.length === 0) {
    errors.push('keyFeatures must be a non-empty string[]');
  }
  const constraintEmphasis = rec.constraintEmphasis;
  if (!Array.isArray(constraintEmphasis) ||
      !constraintEmphasis.every(c => typeof c === 'string' && VALID_CONSTRAINTS.includes(c as ConstraintEmphasis))) {
    errors.push('constraintEmphasis must be ConstraintEmphasis[]');
  }
  const nonGoals = rec.nonGoals;
  if (!isStringArray(nonGoals)) errors.push('nonGoals must be string[]');

  const boundary = getRecord(rec.competitiveCategoryBoundary);
  if (!boundary || !isStringArray(boundary.direct) || !isStringArray(boundary.adjacent) || !isStringArray(boundary.research)) {
    errors.push('competitiveCategoryBoundary must have {direct, adjacent, research} as string[]');
  }
  const framing = getRecord(rec.frontierFraming);
  if (!framing) errors.push('frontierFraming must be an object');
  else {
    if (typeof framing.target !== 'string' || !VALID_TARGETS.includes(framing.target as FrontierTarget)) {
      errors.push(`frontierFraming.target must be one of ${VALID_TARGETS.join(',')}`);
    }
    if (!isStringArray(framing.matchLeaderOn) || !isStringArray(framing.exceedLeaderOn) || !isStringArray(framing.defineNewCategoryOn)) {
      errors.push('frontierFraming arrays must all be string[]');
    }
  }
  const confidence = rec.confidence;
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1 || Number.isNaN(confidence)) {
    errors.push('confidence must be a number in [0,1]');
  }
  if (errors.length > 0) return { ok: false, errors };

  const intent: Omit<ProjectIntent, 'sourcePath' | 'extractedAt'> = {
    projectName: (projectName as string).trim(),
    goal: (goal as string).trim(),
    projectType: projectType as ProjectType,
    targetUser: targetUser as TargetUser,
    keyFeatures: keyFeatures as string[],
    constraintEmphasis: constraintEmphasis as ConstraintEmphasis[],
    nonGoals: nonGoals as string[],
    competitiveCategoryBoundary: {
      direct: (boundary!.direct as string[]),
      adjacent: (boundary!.adjacent as string[]),
      research: (boundary!.research as string[]),
    },
    frontierFraming: {
      target: framing!.target as FrontierTarget,
      matchLeaderOn: framing!.matchLeaderOn as string[],
      exceedLeaderOn: framing!.exceedLeaderOn as string[],
      defineNewCategoryOn: framing!.defineNewCategoryOn as string[],
    },
    confidence: confidence as number,
  };
  if (typeof rec.targetRoleDetail === 'string') intent.targetRoleDetail = rec.targetRoleDetail;
  return { ok: true, intent, errors: [] };
}

// ── Local heuristic extraction (no LLM) ────────────────────────────────────

function heuristicExtract(prdText: string, sourcePath: string): Omit<ProjectIntent, 'sourcePath' | 'extractedAt'> {
  const sections = parseMarkdownSections(prdText);
  const h1 = sections.find(s => s.level === 1);
  const projectName = h1
    ? h1.heading.replace(/^PRD[:\s-]*/i, '').trim() || path.basename(sourcePath, '.md')
    : path.basename(sourcePath, '.md');

  // Goal: first non-empty paragraph in preamble or directly under H1.
  const goalSection = sections.find(s => s.level <= 1 && s.body.trim().length > 0);
  const goalText = goalSection
    ? goalSection.body.split(/\n\s*\n/).map(p => p.trim()).find(p => p.length > 0) ?? ''
    : '';
  const goal = goalText.split(/\.\s/)[0]?.replace(/\n+/g, ' ').trim() || 'Unspecified project goal.';

  // Features: list items under a "Features"/"Key Features"/"Functional Requirements" heading.
  const featSection = sections.find(s =>
    /feature|requirement|capabilit/i.test(s.heading));
  const featureItems: string[] = [];
  if (featSection) {
    const re = /^\s*[-*]\s+(.+?)\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(featSection.body)) !== null) {
      const line = m[1]!.trim();
      if (line.length > 0) featureItems.push(line);
    }
  }
  if (featureItems.length === 0) featureItems.push('feature inventory not detected');

  // Non-goals: list under "Non-Goals"/"Out of Scope".
  const ngSection = sections.find(s => /non-?goal|out of scope/i.test(s.heading));
  const nonGoals: string[] = [];
  if (ngSection) {
    const re = /^\s*[-*]\s+(.+?)\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ngSection.body)) !== null) nonGoals.push(m[1]!.trim());
  }

  return {
    projectName,
    goal,
    projectType: 'other',
    targetUser: 'developer',
    keyFeatures: featureItems.slice(0, 12),
    constraintEmphasis: [],
    nonGoals,
    competitiveCategoryBoundary: { direct: [], adjacent: [], research: [] },
    frontierFraming: {
      target: 'oss_frontier',
      matchLeaderOn: [],
      exceedLeaderOn: [],
      defineNewCategoryOn: [],
    },
    // Local extraction is intentionally low-confidence — caller will likely
    // refuse to proceed unless minConfidence is lowered.
    confidence: 0.4,
  };
}

// ── Top-level extractor ────────────────────────────────────────────────────

export async function extractProjectIntent(
  prdPath: string,
  options: PrdReaderOptions = {},
): Promise<ProjectIntent> {
  const cwd = options.cwd ?? process.cwd();
  const readFile = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const now = options._now ?? (() => new Date().toISOString());
  const minConfidence = options.minConfidence ?? 0.6;
  const stdoutWrite = options._stdoutWrite ?? ((s: string) => process.stdout.write(s));
  const runId = options.runId ?? 'prd-reader';

  const prdText = await readFile(prdPath);
  const sections = parseMarkdownSections(prdText);
  const headingList = sections.map(s => s.heading).filter(h => h !== '__preamble__');
  const prompt = buildExtractionPrompt(prdText, headingList);

  let mode = options.mode ?? 'llm';
  if (mode === 'llm') {
    const probe = options._isLLMAvailable ?? isLLMAvailable;
    if (!(await probe())) mode = 'local';
  }

  await ensureOrchDir(cwd);

  if (mode === 'prompt') {
    stdoutWrite(prompt + '\n');
    throw new PrdExtractionError(
      'prd-reader in prompt mode — no extraction performed; paste prompt to an LLM and rerun',
    );
  }

  let raw: Omit<ProjectIntent, 'sourcePath' | 'extractedAt'>;
  if (mode === 'llm') {
    const caller = options._llmCaller ?? ((p: string) => callLLM(p));
    const responseText = await caller(prompt);
    const parsed = safeJsonParse(responseText);
    if (parsed === null) {
      throw new PrdExtractionError('LLM response was not valid JSON');
    }
    const validation = validateProjectIntent(parsed);
    if (!validation.ok || !validation.intent) {
      throw new PrdExtractionError(`schema validation failed: ${validation.errors.join('; ')}`);
    }
    raw = validation.intent;
  } else {
    raw = heuristicExtract(prdText, prdPath);
  }

  if (raw.confidence < minConfidence) {
    throw new PrdExtractionError(
      `extraction confidence ${raw.confidence.toFixed(2)} below minConfidence ${minConfidence}; refine PRD or pass --min-confidence`,
      raw.confidence,
    );
  }

  const intent: ProjectIntent = {
    ...raw,
    sourcePath: prdPath,
    extractedAt: now(),
  };
  await saveOrch(cwd, 'projectIntent', intent);
  await appendAudit(cwd, {
    ts: now(),
    runId,
    kind: 'stage_completed',
    stage: 'reading_prd',
    payload: { sourcePath: prdPath, confidence: raw.confidence, mode },
  });
  return intent;
}

// Extract a JSON object from raw LLM text — tolerates leading/trailing prose
// and fenced code blocks.
function safeJsonParse(s: string): unknown {
  const trimmed = s.trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fence) {
    try { return JSON.parse(fence[1]!.trim()); } catch { /* fall through */ }
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(trimmed.slice(first, last + 1)); } catch { /* fall through */ }
  }
  return null;
}
