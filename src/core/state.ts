// Core state management — YAML-based project state tracking
import fs from 'fs/promises';
import { execFile } from 'node:child_process';
import os from 'os';
import path from 'path';
import { promisify } from 'node:util';
import yaml from 'yaml';
import { logger } from './logger.js';
import type { CompletionTracker, ProjectType } from './completion-tracker.js';

const STATE_DIR = '.danteforge';
const STATE_FILE = path.join(STATE_DIR, 'STATE.yaml');
const LEGACY_DEFAULT_PROJECT = 'legacy-project';
const execFileAsync = promisify(execFile);

export type WorkflowStage =
  | 'initialized'
  | 'review'
  | 'constitution'
  | 'specify'
  | 'clarify'
  | 'plan'
  | 'tasks'
  | 'design'
  | 'forge'
  | 'ux-refine'
  | 'verify'
  | 'synthesize';

const WORKFLOW_STAGE_ORDER: WorkflowStage[] = [
  'initialized',
  'review',
  'constitution',
  'specify',
  'clarify',
  'plan',
  'tasks',
  'design',
  'forge',
  'ux-refine',
  'verify',
  'synthesize',
];

const LEGACY_WORKFLOW_STAGE_ALIASES: Record<string, WorkflowStage> = {
  reviewed: 'review',
  specified: 'specify',
  clarified: 'clarify',
  planned: 'plan',
  tasked: 'tasks',
  designed: 'design',
  forged: 'forge',
  refined: 'ux-refine',
  verified: 'verify',
  synthesized: 'synthesize',
};

function resolveStatePaths(cwd = process.cwd()) {
  const stateDir = path.join(cwd, STATE_DIR);
  return {
    stateDir,
    stateFile: path.join(stateDir, 'STATE.yaml'),
  };
}

export interface DanteState {
  project: string;
  constitution?: string;
  lastHandoff: string;
  workflowStage: WorkflowStage;
  currentPhase: number;
  tasks: Record<number, { name: string; files?: string[]; verify?: string }[]>;
  auditLog: string[];
  profile: string;
  lastVerifiedAt?: string;
  // Extended state fields
  tddEnabled?: boolean;
  lightMode?: boolean;
  activeWorktrees?: string[];
  // UX refinement / Figma sync
  uxRefineEnabled?: boolean;
  figmaUrl?: string;
  designTokensPath?: string;
  mcpHost?: string;
  // Design-as-Code pipeline (v0.6.0)
  designEnabled?: boolean;
  designFilePath?: string;
  designPreviewPath?: string;
  designTokensSyncedAt?: string;
  designBackend?: 'figma' | 'openpencil' | 'both';
  designFormatVersion?: string;
  // v0.6.0 — Memory, Workflow Enforcement, AutoForge
  memoryEnabled?: boolean;
  enforcementMode?: 'strict' | 'advisory';
  autoforgeEnabled?: boolean;
  autoforgeFailedAttempts?: number;
  autoforgeLastRunAt?: string;
  // v0.8.0 — PDSE, Completion Tracking, QA, Retro
  projectType?: ProjectType;
  qaHealthScore?: number;
  qaBaseline?: string;
  qaLastRun?: string;
  lastVerifyStatus?: 'pass' | 'warn' | 'fail' | 'unknown';
  lastVerifyReceiptPath?: string;
  verifyEvidence?: VerifyEvidence;
  retroDelta?: number;
  retroLastRun?: string;
  completionTracker?: CompletionTracker;
  // v0.10.0 — Self-Assessment & Onboarding
  competitors?: string[];       // user-defined competitor list for `danteforge assess`
  preferredLevel?: string;      // preferred magic level set during init wizard (e.g., 'magic', 'inferno')
  completionTarget?: {        // persisted completion target (mode + minScore + coverage)
    mode: 'feature-universe' | 'dimension-based' | 'custom';
    minScore: number;
    featureCoverage?: number;
    definedAt: string;
  };
  featureUniversePath?: string; // path to cached feature-universe.json
  // v0.9.0 — Reflection Engine + Premium
  reflectionEnabled?: boolean;
  reflectionAttempts?: number;
  reflectionLastVerdict?: string;
  reflectionScore?: number;
  premiumTier?: 'free' | 'pro' | 'enterprise';
  premiumLicenseKey?: string;
  auditTrailEnabled?: boolean;
  // v0.10.0 — Workspace / multi-user
  userId?: string;
  workspaceId?: string;
  // Self-edit policy
  selfEditPolicy?: import('./safe-self-edit.js').SelfEditPolicy;
  // v0.16.0 — Token Economy & Cost Visibility
  totalTokensUsed?: number;           // accumulated across all LLM calls in this project
  maxBudgetUsd?: number;              // per-session budget ceiling (default: 10.0)
  routingAggressiveness?: 'conservative' | 'balanced' | 'aggressive';
  lastComplexityPreset?: string;      // last preset used by the complexity classifier
  // v0.16.0 — Session progress tracking
  sessionBaselineScore?: number;      // harsh score captured at session or baseline start
  sessionBaselineTimestamp?: string;  // ISO timestamp when baseline was set
  // v0.17.0 — Score history for proof arcs
  scoreHistory?: ScoreHistoryEntry[]; // rolling append, max 90 entries
  // v0.34.0 — Ecosystem MCP signals (written by score bootstrap)
  skillCount?: number;         // count of skill dirs with SKILL.md under src/harvested/dante-agents/skills/
  hasPluginManifest?: boolean; // true when .claude-plugin/plugin.json exists
}

export interface VerifyEvidence {
  status: 'pass' | 'warn' | 'fail';
  sourcePath: string;
  gitSha: string | null;
  timestamp: string;
  fresh: boolean;
  currentHead: boolean;
  dirtyWorktree: boolean;
  currentStateFresh: boolean;
}

// v0.17.0 — Score history entry for proof arcs
export interface ScoreHistoryEntry {
  timestamp: string;     // ISO
  displayScore: number;  // 0.0-10.0
  gitSha?: string;       // best-effort from git rev-parse HEAD
}

/**
 * Prepend a score entry to state.scoreHistory, trimmed to maxEntries.
 * Pure function — returns a new state object.
 */
export function appendScoreHistory(
  state: DanteState,
  entry: ScoreHistoryEntry,
  maxEntries = 90,
): DanteState {
  const existing = state.scoreHistory ?? [];
  const updated = [entry, ...existing].slice(0, maxEntries);
  return { ...state, scoreHistory: updated };
}

/**
 * Append a user-stamped audit entry to state.auditLog.
 * Format: "ISO-timestamp | userId | entry"
 */
export function appendAuditEntry(state: DanteState, entry: string): void {
  const userId = process.env['DANTEFORGE_USER'] ?? os.userInfo().username ?? 'unknown';
  const timestamp = new Date().toISOString();
  state.auditLog = state.auditLog ?? [];
  state.auditLog.push(`${timestamp} | ${userId} | ${entry}`);
}

export function recordWorkflowStage(
  state: DanteState,
  workflowStage: WorkflowStage,
  timestamp = new Date().toISOString(),
): string {
  state.workflowStage = workflowStage;
  state.lastHandoff = `${workflowStage} -> next (${timestamp})`;
  return timestamp;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function deriveProjectName(existingProject: string | undefined, cwd: string): Promise<string> {
  const cwdName = path.basename(cwd);
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name && pkg.name.trim().length > 0) {
      if (!existingProject || existingProject === LEGACY_DEFAULT_PROJECT || existingProject === cwdName) {
        return pkg.name.trim();
      }
      return existingProject;
    }
  } catch {
    // Fall back to the workspace folder name.
  }

  if (existingProject && existingProject !== LEGACY_DEFAULT_PROJECT) {
    return existingProject;
  }

  return cwdName;
}

function workflowStageRank(stage: WorkflowStage | undefined): number {
  if (!stage) return -1;
  return WORKFLOW_STAGE_ORDER.indexOf(stage);
}

function normalizeWorkflowStage(stage: unknown): WorkflowStage | undefined {
  if (typeof stage !== 'string') {
    return undefined;
  }

  if (WORKFLOW_STAGE_ORDER.includes(stage as WorkflowStage)) {
    return stage as WorkflowStage;
  }

  return LEGACY_WORKFLOW_STAGE_ALIASES[stage];
}

function pickMostAdvancedWorkflowStage(
  recordedStage: unknown,
  inferredStage: WorkflowStage,
): WorkflowStage {
  const normalizedRecordedStage = normalizeWorkflowStage(recordedStage);

  return workflowStageRank(normalizedRecordedStage) >= workflowStageRank(inferredStage)
    ? normalizedRecordedStage!
    : inferredStage;
}

async function getGitSignal(cwd: string): Promise<{ headSha: string | null; dirtyWorktree: boolean }> {
  try {
    const { stdout: headOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 5000 });
    const { stdout: dirtyOut } = await execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 5000 });
    return {
      headSha: headOut.trim() || null,
      dirtyWorktree: dirtyOut.trim().length > 0,
    };
  } catch {
    return { headSha: null, dirtyWorktree: false };
  }
}

async function loadVerifyEvidence(cwd: string, receiptPath?: string): Promise<VerifyEvidence | undefined> {
  const candidatePath = receiptPath
    ? path.resolve(cwd, receiptPath)
    : path.join(cwd, STATE_DIR, 'evidence', 'verify', 'latest.json');

  try {
    const raw = await fs.readFile(candidatePath, 'utf8');
    const parsed = JSON.parse(raw) as {
      status?: 'pass' | 'warn' | 'fail';
      gitSha?: string | null;
      timestamp?: string;
      currentStateFresh?: boolean;
    };

    if (!parsed.status || !parsed.timestamp) {
      return undefined;
    }

    const { headSha, dirtyWorktree } = await getGitSignal(cwd);
    const currentHead = headSha ? parsed.gitSha === headSha : true;
    const currentStateFresh = parsed.currentStateFresh !== false;
    const fresh = parsed.status === 'pass' && currentHead && !dirtyWorktree && currentStateFresh;

    return {
      status: parsed.status,
      sourcePath: candidatePath,
      gitSha: parsed.gitSha ?? null,
      timestamp: parsed.timestamp,
      fresh,
      currentHead,
      dirtyWorktree,
      currentStateFresh,
    };
  } catch {
    return undefined;
  }
}

function deriveEffectiveVerifyStatus(
  legacyStatus: DanteState['lastVerifyStatus'],
  verifyEvidence?: VerifyEvidence,
): DanteState['lastVerifyStatus'] {
  if (!verifyEvidence) {
    return legacyStatus;
  }

  if (verifyEvidence.status === 'pass' && verifyEvidence.fresh) {
    return 'pass';
  }

  if (verifyEvidence.status === 'pass' && !verifyEvidence.fresh) {
    return 'warn';
  }

  return verifyEvidence.status;
}

async function inferWorkflowStage(
  cwd: string,
  parsed?: Partial<DanteState>,
  verifyEvidence?: VerifyEvidence,
): Promise<WorkflowStage> {
  const stateDir = path.join(cwd, STATE_DIR);
  const has = (filename: string) => fileExists(path.join(stateDir, filename));

  let inferred: WorkflowStage = 'initialized';

  if (await has('UPR.md')) {
    inferred = 'synthesize';
  } else if (verifyEvidence || parsed?.lastVerifyReceiptPath || parsed?.lastVerifiedAt) {
    inferred = 'verify';
  } else if ((await has('UX_REFINE.md')) || (await has('design-tokens.css'))) {
    inferred = 'ux-refine';
  } else if (await has('DESIGN.op')) {
    inferred = 'design';
  } else if (await has('TASKS.md')) {
    inferred = 'tasks';
  } else if (await has('PLAN.md')) {
    inferred = 'plan';
  } else if (await has('CLARIFY.md')) {
    inferred = 'clarify';
  } else if (await has('SPEC.md')) {
    inferred = 'specify';
  } else if ((await has('CONSTITUTION.md')) || parsed?.constitution) {
    inferred = 'constitution';
  } else if (await has('CURRENT_STATE.md')) {
    inferred = 'review';
  }

  return pickMostAdvancedWorkflowStage(parsed?.workflowStage, inferred);
}

function buildLoadedState(
  parsed: Partial<DanteState>,
  project: string,
  workflowStage: WorkflowStage,
  lastVerifyStatus: DanteState['lastVerifyStatus'],
  constitution: string | undefined,
  verifyEvidence: VerifyEvidence | undefined,
): DanteState {
  return {
    project,
    lastHandoff: parsed?.lastHandoff ?? 'initialized',
    workflowStage,
    currentPhase: parsed?.currentPhase ?? 0,
    tasks: parsed?.tasks ?? {},
    auditLog: Array.isArray(parsed?.auditLog) ? parsed.auditLog : [],
    profile: parsed?.profile ?? 'balanced',
    constitution,
    lastVerifiedAt: parsed?.lastVerifiedAt,
    tddEnabled: parsed?.tddEnabled,
    lightMode: parsed?.lightMode,
    activeWorktrees: parsed?.activeWorktrees,
    uxRefineEnabled: parsed?.uxRefineEnabled,
    figmaUrl: parsed?.figmaUrl,
    designTokensPath: parsed?.designTokensPath,
    mcpHost: parsed?.mcpHost,
    designEnabled: parsed?.designEnabled,
    designFilePath: parsed?.designFilePath,
    designPreviewPath: parsed?.designPreviewPath,
    designTokensSyncedAt: parsed?.designTokensSyncedAt,
    designBackend: parsed?.designBackend,
    designFormatVersion: parsed?.designFormatVersion,
    memoryEnabled: parsed?.memoryEnabled,
    enforcementMode: parsed?.enforcementMode,
    autoforgeEnabled: parsed?.autoforgeEnabled,
    autoforgeFailedAttempts: parsed?.autoforgeFailedAttempts,
    autoforgeLastRunAt: parsed?.autoforgeLastRunAt,
    projectType: (parsed?.projectType as ProjectType | undefined) ?? 'unknown',
    qaHealthScore: parsed?.qaHealthScore as number | undefined,
    qaBaseline: parsed?.qaBaseline as string | undefined,
    qaLastRun: parsed?.qaLastRun as string | undefined,
    retroDelta: parsed?.retroDelta as number | undefined,
    retroLastRun: parsed?.retroLastRun as string | undefined,
    completionTracker: parsed?.completionTracker as CompletionTracker | undefined,
    sessionBaselineScore: parsed?.sessionBaselineScore as number | undefined,
    sessionBaselineTimestamp: parsed?.sessionBaselineTimestamp as string | undefined,
    scoreHistory: Array.isArray(parsed?.scoreHistory) ? parsed.scoreHistory as ScoreHistoryEntry[] : undefined,
    reflectionEnabled: parsed?.reflectionEnabled,
    reflectionAttempts: parsed?.reflectionAttempts,
    reflectionLastVerdict: parsed?.reflectionLastVerdict,
    reflectionScore: parsed?.reflectionScore,
    premiumTier: parsed?.premiumTier as 'free' | 'pro' | 'enterprise' | undefined,
    premiumLicenseKey: parsed?.premiumLicenseKey,
    auditTrailEnabled: parsed?.auditTrailEnabled,
    userId: parsed?.userId,
    workspaceId: parsed?.workspaceId,
    selfEditPolicy: parsed?.selfEditPolicy ?? 'deny',
    lastVerifyStatus,
    lastVerifyReceiptPath: verifyEvidence?.sourcePath ?? parsed?.lastVerifyReceiptPath,
    verifyEvidence,
    competitors: parsed?.competitors,
    preferredLevel: parsed?.preferredLevel,
    completionTarget: parsed?.completionTarget,
    featureUniversePath: parsed?.featureUniversePath,
    totalTokensUsed: parsed?.totalTokensUsed,
    maxBudgetUsd: parsed?.maxBudgetUsd ?? 10.0,
    routingAggressiveness: parsed?.routingAggressiveness ?? 'balanced',
    lastComplexityPreset: parsed?.lastComplexityPreset,
    skillCount: parsed?.skillCount as number | undefined,
    hasPluginManifest: parsed?.hasPluginManifest as boolean | undefined,
  };
}

export async function loadState(options: { cwd?: string } = {}): Promise<DanteState> {
  const cwd = options.cwd ?? process.cwd();
  const { stateDir, stateFile } = resolveStatePaths(cwd);
  try {
    await fs.mkdir(stateDir, { recursive: true });
    const content = await fs.readFile(stateFile, 'utf8');
    const parsed = yaml.parse(content) as Partial<DanteState>;
    const project = await deriveProjectName(parsed?.project, cwd);
    const verifyEvidence = await loadVerifyEvidence(cwd, parsed?.lastVerifyReceiptPath);
    const workflowStage = await inferWorkflowStage(cwd, parsed, verifyEvidence);
    const lastVerifyStatus = deriveEffectiveVerifyStatus(parsed?.lastVerifyStatus, verifyEvidence);
    const constitution = parsed?.constitution
      ?? (await fileExists(path.join(stateDir, 'CONSTITUTION.md')) ? 'CONSTITUTION.md' : undefined);
    return buildLoadedState(parsed, project, workflowStage, lastVerifyStatus, constitution, verifyEvidence);
  } catch (err) {
    // Only log if this is NOT a "file not found" — real errors should surface
    if (err instanceof Error && !err.message.includes('ENOENT')) {
      logger.warn(`Failed to load STATE.yaml: ${err.message} — using defaults`);
    }
    const defaultState: DanteState = {
      project: await deriveProjectName(undefined, cwd),
      lastHandoff: 'initialized',
      workflowStage: 'initialized',
      currentPhase: 0,
      tasks: {},
      auditLog: [],
      profile: 'balanced',
      constitution: undefined,
      lastVerifiedAt: undefined,
      tddEnabled: undefined,
      lightMode: undefined,
      activeWorktrees: undefined,
      uxRefineEnabled: undefined,
      figmaUrl: undefined,
      designTokensPath: undefined,
      mcpHost: undefined,
      designEnabled: undefined,
      designFilePath: undefined,
      designPreviewPath: undefined,
      designTokensSyncedAt: undefined,
      designBackend: undefined,
      designFormatVersion: undefined,
      memoryEnabled: undefined,
      enforcementMode: 'strict',
      autoforgeEnabled: undefined,
      autoforgeFailedAttempts: undefined,
      autoforgeLastRunAt: undefined,
      // v0.8.0 defaults
      projectType: 'unknown',
      qaHealthScore: undefined,
      qaBaseline: undefined,
      qaLastRun: undefined,
      retroDelta: undefined,
      retroLastRun: undefined,
      completionTracker: undefined,
      // v0.9.0 defaults
      reflectionEnabled: undefined,
      reflectionAttempts: undefined,
      reflectionLastVerdict: undefined,
      reflectionScore: undefined,
      premiumTier: undefined,
      premiumLicenseKey: undefined,
      auditTrailEnabled: undefined,
      // v0.10.0 workspace fields
      userId: undefined,
      workspaceId: undefined,
      // v0.16.0 — token economy defaults
      totalTokensUsed: undefined,
      maxBudgetUsd: 10.0,
      routingAggressiveness: 'balanced',
      lastComplexityPreset: undefined,
      skillCount: undefined,
      hasPluginManifest: undefined,
    };
    await saveState(defaultState, options);
    return defaultState;
  }
}

export async function saveState(state: DanteState, options: { cwd?: string } = {}) {
  const { stateDir, stateFile } = resolveStatePaths(options.cwd);
  await fs.mkdir(stateDir, { recursive: true });
  const { verifyEvidence: _verifyEvidence, ...persistedState } = state;
  await fs.writeFile(stateFile, yaml.stringify(persistedState));
  logger.info('STATE.yaml updated');
}
