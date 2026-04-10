// Core state management — YAML-based project state tracking
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { logger } from './logger.js';
import { StateError } from './errors.js';
import { withStateLock } from './state-lock.js';
import { logFileWrite, generateCorrelationId } from './structured-audit.js';

export const AUDIT_LOG_MAX_ENTRIES = 500;
export const CURRENT_SCHEMA_VERSION = 1;
export const MAX_STATE_FILE_SIZE_BYTES = 1_048_576; // 1 MB — reject YAML bombs
import type { CompletionTracker, ProjectType } from './completion-tracker.js';

const STATE_DIR = '.danteforge';
const STATE_FILE = path.join(STATE_DIR, 'STATE.yaml');
const LEGACY_DEFAULT_PROJECT = 'legacy-project';

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

/** Known workflow stages — used for schema validation. */
export const VALID_WORKFLOW_STAGES = new Set<WorkflowStage>([
  'initialized', 'review', 'constitution', 'specify', 'clarify',
  'plan', 'tasks', 'design', 'forge', 'ux-refine', 'verify', 'synthesize',
]);

/** Maximum auditLog entries loaded from disk (prevent memory exhaustion from unbounded arrays). */
export const MAX_AUDIT_LOG_ON_LOAD = 1000;

/**
 * Validate and auto-repair a parsed DanteState object after schema migration.
 * Logs warnings for suspicious values and auto-corrects where possible.
 * Never throws — always returns a safe object.
 */
export function validateStateSchema(parsed: Partial<DanteState>): Partial<DanteState> {
  let result = { ...parsed };

  if (result.workflowStage !== undefined && !VALID_WORKFLOW_STAGES.has(result.workflowStage)) {
    logger.warn(`[state] Unknown workflowStage "${result.workflowStage}" in STATE.yaml — resetting to "initialized"`);
    result = { ...result, workflowStage: 'initialized' };
  }

  if (result.currentPhase !== undefined &&
      (typeof result.currentPhase !== 'number' || !Number.isInteger(result.currentPhase) || result.currentPhase < 0)) {
    logger.warn(`[state] Invalid currentPhase "${result.currentPhase}" — resetting to 0`);
    result = { ...result, currentPhase: 0 };
  }

  if (result.auditLog !== undefined) {
    if (!Array.isArray(result.auditLog)) {
      logger.warn('[state] auditLog is not an array — resetting to empty');
      result = { ...result, auditLog: [] };
    } else if (result.auditLog.length > MAX_AUDIT_LOG_ON_LOAD) {
      logger.warn(`[state] auditLog has ${result.auditLog.length} entries — truncating to newest ${MAX_AUDIT_LOG_ON_LOAD}`);
      result = { ...result, auditLog: result.auditLog.slice(-MAX_AUDIT_LOG_ON_LOAD) };
    }
  }

  if (result.tasks !== undefined && (typeof result.tasks !== 'object' || Array.isArray(result.tasks))) {
    logger.warn('[state] tasks field is not an object — resetting to empty');
    result = { ...result, tasks: {} };
  }

  return result;
}

/**
 * Migrate parsed state from an older schema version to CURRENT_SCHEMA_VERSION.
 * Each migration step is idempotent — running twice produces the same result.
 */
function migrateState(parsed: Partial<DanteState>): Partial<DanteState> {
  const v = parsed._schemaVersion ?? 0;
  if (v >= CURRENT_SCHEMA_VERSION) return parsed;
  // v0 → v1: establish baseline; all fields already have defaults in loadState
  return { ...parsed, _schemaVersion: CURRENT_SCHEMA_VERSION };
}

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
  // v0.11.0 — Self-edit policy
  selfEditPolicy?: import('./safe-self-edit.js').SelfEditPolicy;
  // v0.19.0 — Schema versioning (migration chain)
  _schemaVersion?: number;
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

async function inferWorkflowStage(cwd: string, parsed?: Partial<DanteState>): Promise<WorkflowStage> {
  const stateDir = path.join(cwd, STATE_DIR);
  const has = (filename: string) => fileExists(path.join(stateDir, filename));

  if (parsed?.workflowStage) return parsed.workflowStage;
  if (await has('UPR.md')) return 'synthesize';
  if (parsed?.lastVerifiedAt) return 'verify';
  if ((await has('UX_REFINE.md')) || (await has('design-tokens.css'))) return 'ux-refine';
  if (await has('DESIGN.op')) return 'design';
  if (await has('TASKS.md')) return 'tasks';
  if (await has('PLAN.md')) return 'plan';
  if (await has('CLARIFY.md')) return 'clarify';
  if (await has('SPEC.md')) return 'specify';
  if ((await has('CONSTITUTION.md')) || parsed?.constitution) return 'constitution';
  if (await has('CURRENT_STATE.md')) return 'review';
  return 'initialized';
}

export async function loadState(
  options: { cwd?: string; _stat?: (p: string) => Promise<{ size: number }> } = {},
): Promise<DanteState> {
  const cwd = options.cwd ?? process.cwd();
  const { stateDir, stateFile } = resolveStatePaths(cwd);
  try {
    await fs.mkdir(stateDir, { recursive: true });
    // Size guard — reject files that could cause memory exhaustion (YAML bomb, huge auditLog)
    const statFn = options._stat ?? fs.stat;
    try {
      const statResult = await statFn(stateFile);
      if (statResult.size > MAX_STATE_FILE_SIZE_BYTES) {
        throw new StateError(
          `STATE.yaml is too large (${statResult.size} bytes, limit ${MAX_STATE_FILE_SIZE_BYTES}). ` +
          `Delete to reset: rm .danteforge/STATE.yaml`,
          'STATE_CORRUPT',
        );
      }
    } catch (statErr) {
      if (statErr instanceof StateError) throw statErr;
      // ENOENT or other stat error — file doesn't exist yet, continue to readFile
    }
    const content = await fs.readFile(stateFile, 'utf8');
    let rawParsed: unknown;
    try {
      rawParsed = yaml.parse(content);
    } catch (parseErr) {
      throw new StateError(
        `STATE.yaml is corrupt and cannot be parsed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        'STATE_CORRUPT',
      );
    }
    if (rawParsed === null || typeof rawParsed !== 'object') {
      throw new StateError('STATE.yaml is corrupt: parsed value is not an object', 'STATE_CORRUPT');
    }
    const migrated = migrateState(rawParsed as Partial<DanteState>);
    const parsed = validateStateSchema(migrated);
    // Validate required fields — fill gaps with defaults
    const project = await deriveProjectName(parsed?.project, cwd);
    const workflowStage = await inferWorkflowStage(cwd, parsed);
    return {
      project,
      lastHandoff: parsed?.lastHandoff ?? 'initialized',
      workflowStage,
      currentPhase: parsed?.currentPhase ?? 0,
      tasks: parsed?.tasks ?? {},
      auditLog: Array.isArray(parsed?.auditLog) ? parsed.auditLog : [],
      profile: parsed?.profile ?? 'balanced',
      constitution: parsed?.constitution,
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
      // v0.8.0 migration defaults
      projectType: (parsed?.projectType as ProjectType | undefined) ?? 'unknown',
      qaHealthScore: parsed?.qaHealthScore as number | undefined,
      qaBaseline: parsed?.qaBaseline as string | undefined,
      qaLastRun: parsed?.qaLastRun as string | undefined,
      retroDelta: parsed?.retroDelta as number | undefined,
      retroLastRun: parsed?.retroLastRun as string | undefined,
      completionTracker: parsed?.completionTracker as CompletionTracker | undefined,
      // v0.9.0 migration defaults
      reflectionEnabled: parsed?.reflectionEnabled,
      reflectionAttempts: parsed?.reflectionAttempts,
      reflectionLastVerdict: parsed?.reflectionLastVerdict,
      reflectionScore: parsed?.reflectionScore,
      premiumTier: parsed?.premiumTier as 'free' | 'pro' | 'enterprise' | undefined,
      premiumLicenseKey: parsed?.premiumLicenseKey,
      auditTrailEnabled: parsed?.auditTrailEnabled,
      // v0.10.0 workspace fields
      userId: parsed?.userId,
      workspaceId: parsed?.workspaceId,
      // v0.11.0 self-edit policy
      selfEditPolicy: parsed?.selfEditPolicy as import('./safe-self-edit.js').SelfEditPolicy | undefined,
      // v0.19.0 schema version
      _schemaVersion: parsed?._schemaVersion,
    };
  } catch (err) {
    // Re-throw state corruption errors — they must not be silently swallowed
    if (err instanceof StateError) throw err;
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
      // v0.11.0 self-edit policy
      selfEditPolicy: undefined,
      // v0.19.0 schema version
      _schemaVersion: undefined,
    };
    await saveState(defaultState, options);
    return defaultState;
  }
}

export async function saveState(state: DanteState, options: { cwd?: string } = {}) {
  const correlationId = generateCorrelationId();
  const { stateDir, stateFile } = resolveStatePaths(options.cwd);
  await fs.mkdir(stateDir, { recursive: true });
  const lockPath = path.join(stateDir, '.state.lock');
  // Bound audit log before writing
  if (state.auditLog && state.auditLog.length > AUDIT_LOG_MAX_ENTRIES) {
    state.auditLog = state.auditLog.slice(-AUDIT_LOG_MAX_ENTRIES);
  }
  // Stamp schema version
  state._schemaVersion = CURRENT_SCHEMA_VERSION;
  await withStateLock(lockPath, async () => {
    const tmpPath = `${stateFile}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmpPath, yaml.stringify(state), 'utf8');
      await fs.rename(tmpPath, stateFile);
      logFileWrite(stateFile, correlationId, 'success', options.cwd);
      logger.info('STATE.yaml updated');
    } catch (err) {
      logFileWrite(stateFile, correlationId, 'failure', options.cwd);
      await fs.unlink(tmpPath).catch(() => {});
      throw err;
    }
  });
}
