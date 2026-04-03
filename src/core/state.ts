// Core state management — YAML-based project state tracking
import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import { logger } from './logger.js';
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
  // v0.9.0 — Reflection Engine + Premium
  reflectionEnabled?: boolean;
  reflectionAttempts?: number;
  reflectionLastVerdict?: string;
  reflectionScore?: number;
  premiumTier?: 'free' | 'pro' | 'enterprise';
  premiumLicenseKey?: string;
  auditTrailEnabled?: boolean;
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

export async function loadState(options: { cwd?: string } = {}): Promise<DanteState> {
  const cwd = options.cwd ?? process.cwd();
  const { stateDir, stateFile } = resolveStatePaths(cwd);
  try {
    await fs.mkdir(stateDir, { recursive: true });
    const content = await fs.readFile(stateFile, 'utf8');
    const parsed = yaml.parse(content) as Partial<DanteState>;
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
    };
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
    };
    await saveState(defaultState, options);
    return defaultState;
  }
}

export async function saveState(state: DanteState, options: { cwd?: string } = {}) {
  const { stateDir, stateFile } = resolveStatePaths(options.cwd);
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(stateFile, yaml.stringify(state));
  logger.info('STATE.yaml updated');
}
