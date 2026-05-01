import fs from 'fs/promises';
import path from 'path';
import { exec, execFile, execSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { writeVerifyReceipt, computeReceiptStatus, type VerifyReceipt } from '../../core/verify-receipts.js';
import {
  inspectCommandCheckReceiptFreshness,
  type CommandCheckFreshnessReason,
  type CommandCheckId,
} from '../../core/command-check-receipts.js';
import { loadState, recordWorkflowStage, saveState, type DanteState, type WorkflowStage } from '../../core/state.js';
import { detectProjectType, type ProjectType } from '../../core/completion-tracker.js';
import { logger } from '../../core/logger.js';
import { detectAIDrift } from '../../core/drift-detector.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const STATE_DIR = '.danteforge';
const RELEASE_CHECK_MAX_BUFFER = 10 * 1024 * 1024;

interface VerifyResult {
  passed: string[];
  warnings: string[];
  failures: string[];
}

interface CurrentStateMetadata {
  version?: string;
  projectType?: ProjectType;
}

function traceVerifyStage(
  stage: string,
  trace?: (stage: string) => void,
): void {
  if (trace) {
    trace(stage);
    return;
  }

  if (process.env.DANTEFORGE_VERIFY_TRACE === '1') {
    process.stderr.write(`[verify-trace] ${stage}\n`);
  }
}

function traceActiveVerifyHandles(): void {
  if (process.env.DANTEFORGE_VERIFY_TRACE !== '1') {
    return;
  }

  const getActiveHandles = (process as NodeJS.Process & {
    _getActiveHandles?: () => unknown[];
  })._getActiveHandles;
  const handles = getActiveHandles ? getActiveHandles.call(process) : [];
  const summary = handles.map((handle) => {
    if (!handle || typeof handle !== 'object') {
      return String(handle);
    }

    const name = (handle as { constructor?: { name?: string } }).constructor?.name ?? 'UnknownHandle';
    if ('pid' in handle && typeof (handle as { pid?: unknown }).pid === 'number') {
      return `${name}(pid=${String((handle as { pid: number }).pid)})`;
    }
    if ('fd' in handle && typeof (handle as { fd?: unknown }).fd === 'number') {
      return `${name}(fd=${String((handle as { fd: number }).fd)})`;
    }
    return name;
  });
  process.stderr.write(`[verify-handles] ${summary.join(', ')}\n`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function stageRequiresExecution(stage: WorkflowStage): boolean {
  return stage === 'forge' || stage === 'ux-refine' || stage === 'verify' || stage === 'synthesize';
}

export function computeVerifyStatus(
  result: { failures: string[]; warnings: string[] },
): 'pass' | 'warn' | 'fail' {
  if (result.failures.length > 0) return 'fail';
  if (result.warnings.length > 0) return 'warn';
  return 'pass';
}

async function assertArtifact(result: VerifyResult, filename: string, label: string, stateDir: string): Promise<void> {
  const artifactPath = path.join(stateDir, filename);
  if (await fileExists(artifactPath)) {
    result.passed.push(`${label} (${filename}) present`);
    return;
  }
  result.failures.push(`${label} (${filename}) missing`);
}

export function resolveCommandCheckLaunch(
  command: string,
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    nodeExecPath?: string;
  } = {},
): { executable: string; args: string[]; shell: boolean } {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const nodeExecPath = options.nodeExecPath ?? process.execPath;
  const npmExecPath = env.npm_execpath?.trim();
  const isNpmCommand = /^npm(?:\s|$)/.test(command);
  const args = isNpmCommand ? command.split(/\s+/).slice(1) : command.split(/\s+/);

  if (isNpmCommand) {
    if (platform === 'win32') {
      const powershell = env.SystemRoot
        ? path.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe';
      return {
        executable: powershell,
        args: [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `$ProgressPreference='SilentlyContinue'; & ${command} *> $null; exit $LASTEXITCODE`,
        ],
        shell: false,
      };
    }

    if (npmExecPath) {
      return {
        executable: nodeExecPath,
        args: [npmExecPath, ...args],
        shell: false,
      };
    }

    return {
      executable: 'npm',
      args,
      shell: false,
    };
  }

  return {
    executable: platform === 'win32' ? `${args[0]}.cmd` : args[0]!,
    args: args.slice(1),
    shell: false,
  };
}

async function runCommandCheck(command: string, cwd: string): Promise<boolean> {
  const launch = resolveCommandCheckLaunch(command);

  try {
    const result = spawnSync(launch.executable, launch.args, {
      cwd,
      env: process.env,
      stdio: 'ignore',
      shell: launch.shell,
    });
    return (result.status ?? 1) === 0;
  } catch {
    return false;
  }
}

async function runObjectiveExecutionGate(
  id: CommandCheckId,
  receiptCommand: string,
  cwd: string,
  runner?: (cwd: string) => Promise<boolean>,
  executionCommand = receiptCommand,
  onFallbackToExecution?: (reason: CommandCheckFreshnessReason) => void,
): Promise<{
  passed: boolean;
  reusedReceipt: boolean;
  receiptStatus?: 'pass' | 'fail';
  freshnessReason?: CommandCheckFreshnessReason | null;
}> {
  if (runner) {
    return {
      passed: await runner(cwd),
      reusedReceipt: false,
      freshnessReason: null,
    };
  }

  const freshness = await inspectCommandCheckReceiptFreshness(id, receiptCommand, cwd);
  if (freshness.freshReceipt) {
    return {
      passed: freshness.freshReceipt.status === 'pass',
      reusedReceipt: true,
      receiptStatus: freshness.freshReceipt.status,
      freshnessReason: null,
    };
  }

  const freshnessReason = freshness.reason ?? 'missing_receipt';
  onFallbackToExecution?.(freshnessReason);
  return {
    passed: await runCommandCheck(executionCommand, cwd),
    reusedReceipt: false,
    freshnessReason,
  };
}

function describeCommandCheckFallback(reason: CommandCheckFreshnessReason): string {
  switch (reason) {
    case 'missing_receipt':
      return 'no proof receipt exists yet';
    case 'command_mismatch':
      return 'the saved proof was created by a different command';
    case 'git_unavailable':
      return 'git fingerprinting was unavailable';
    case 'git_sha_mismatch':
      return 'the git SHA changed since the last proof';
    case 'worktree_mismatch':
      return 'the worktree changed since the last proof';
    default:
      return 'the saved proof is not reusable';
  }
}

async function resolveBuildProofCommand(cwd: string): Promise<string> {
  try {
    const pkgPath = path.join(cwd, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts?.['build:receipt'] ? 'npm run build:receipt' : 'npm run build';
  } catch {
    return 'npm run build';
  }
}

export async function listDriftScanFiles(
  cwd: string,
  gitDiff?: (cwd: string, args: string[]) => Promise<string>,
): Promise<string[]> {
  try {
    const args = ['diff', '--name-only', 'HEAD', '--', 'src/'];
    const stdout = gitDiff
      ? await gitDiff(cwd, args)
      : (await execFileAsync('git', args, {
          cwd,
          timeout: 5000,
          maxBuffer: 1024 * 1024,
        })).stdout;

    return stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function hasRecordedPhaseOneTasks(state: Pick<DanteState, 'tasks'>): boolean {
  return (state.tasks[1] ?? []).length > 0;
}

function getForgeWaveCount(state: Pick<DanteState, 'auditLog'>): number {
  return state.auditLog.filter(entry => entry.includes('| forge: wave ')).length;
}

function hasReceiptBackedExecutionEvidence(
  state: Pick<DanteState, 'verifyEvidence' | 'lastVerifyReceiptPath' | 'lastVerifiedAt'>,
): boolean {
  return Boolean(state.verifyEvidence || state.lastVerifyReceiptPath || state.lastVerifiedAt);
}

function shouldUseObjectiveExecutionGates(
  state: Pick<DanteState, 'verifyEvidence' | 'lastVerifyReceiptPath' | 'lastVerifiedAt' | 'workflowStage' | 'auditLog' | 'tasks'>,
): boolean {
  const hasBookkeepingGap = !hasRecordedPhaseOneTasks(state)
    || !stageRequiresExecution(state.workflowStage)
    || getForgeWaveCount(state) === 0;
  return hasBookkeepingGap && hasReceiptBackedExecutionEvidence(state);
}

async function runReleaseVerification(result: VerifyResult): Promise<void> {
  try {
    const npmExecPath = process.env.npm_execpath?.trim();
    if (npmExecPath) {
      await execFileAsync(process.execPath, [npmExecPath, 'run', 'release:check'], {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: RELEASE_CHECK_MAX_BUFFER,
      });
    } else if (process.platform === 'win32') {
      await execAsync('npm run release:check', {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: RELEASE_CHECK_MAX_BUFFER,
      });
    } else {
      await execFileAsync('npm', ['run', 'release:check'], {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: RELEASE_CHECK_MAX_BUFFER,
      });
    }
    result.passed.push('Release verification succeeded');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.failures.push(`Release verification failed: ${message}`);
  }
}

export function normalizeMarkdownValue(value: string | undefined): string | undefined {
  return value?.replace(/`/g, '').trim();
}

export function parseCurrentStateMetadata(content: string): CurrentStateMetadata {
  const capture = (patterns: RegExp[]): string | undefined => {
    for (const pattern of patterns) {
      const match = pattern.exec(content);
      const value = normalizeMarkdownValue(match?.[1]);
      if (value) return value;
    }
    return undefined;
  };

  const version = capture([
    /^\|\s*Version\s*\|\s*([^|\n]+?)\s*\|$/im,
    /^\s*-\s*\*\*Version\*\*:\s*(.+?)\s*$/im,
  ]);

  const rawProjectType = capture([
    /^\|\s*(?:Detected project type|Project type)\s*\|\s*([^|\n]+?)\s*\|$/im,
    /^\s*-\s*\*\*(?:Detected project type|Project type)\*\*:\s*(.+?)\s*$/im,
  ]);

  const projectType = rawProjectType && ['web', 'cli', 'library', 'unknown'].includes(rawProjectType.toLowerCase())
    ? rawProjectType.toLowerCase() as ProjectType
    : undefined;

  return { version, projectType };
}

export async function readWorkspacePackageVersion(cwd?: string): Promise<string | undefined> {
  try {
    const pkgPath = cwd ? path.join(cwd, 'package.json') : 'package.json';
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' && pkg.version.trim().length > 0
      ? pkg.version.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

async function validateCurrentStateFreshness(result: VerifyResult, stateDir: string, cwd: string): Promise<void> {
  const artifactPath = path.join(stateDir, 'CURRENT_STATE.md');
  if (!(await fileExists(artifactPath))) return;

  const content = await fs.readFile(artifactPath, 'utf8');
  const metadata = parseCurrentStateMetadata(content);
  const packageVersion = await readWorkspacePackageVersion(cwd);
  const actualProjectType = await detectProjectType(cwd);

  if (packageVersion && metadata.version) {
    if (metadata.version === packageVersion) {
      result.passed.push(`CURRENT_STATE.md version matches package.json (${packageVersion})`);
    } else {
      result.failures.push(`CURRENT_STATE.md version is stale (${metadata.version}); expected ${packageVersion} from package.json`);
    }
  }

  if (metadata.projectType) {
    if (metadata.projectType === actualProjectType) {
      result.passed.push(`CURRENT_STATE.md project type matches detected repo type (${actualProjectType})`);
    } else {
      result.failures.push(`CURRENT_STATE.md project type is stale (${metadata.projectType}); expected ${actualProjectType}`);
    }
  }
}

export interface VerifyOptions {
  release?: boolean;
  live?: boolean;
  url?: string;
  recompute?: boolean;
  json?: boolean;
  light?: boolean;
  cwd?: string;
  /** Injection seam: override test runner for light-mode (returns true = passed) */
  _runTests?: (cwd: string) => Promise<boolean>;
  /** Injection seam: override build runner for light-mode (returns true = passed) */
  _runBuild?: (cwd: string) => Promise<boolean>;
  /** Injection seam: override failure-lesson capture for deterministic tests */
  _captureVerifyLessons?: (failures: string[], warnings: string[]) => Promise<unknown>;
  /** Injection seam: override success-pattern capture for deterministic tests */
  _captureSuccessLessons?: (receipt: VerifyReceipt, cwd: string) => Promise<unknown>;
  /** Injection seam: stage trace hook for root-cause debugging */
  _trace?: (stage: string) => void;
}

async function runExecutionGateChecks(result: VerifyResult, state: DanteState, options: VerifyOptions, cwd: string): Promise<void> {
  const recordedPhaseOneTasks = hasRecordedPhaseOneTasks(state);
  const forgeWaveCount = getForgeWaveCount(state);
  const receiptBackedExecution = shouldUseObjectiveExecutionGates(state);

  if (options.light || receiptBackedExecution) {
    const modeLabel = options.light ? 'Light mode' : 'Receipt-backed mode';
    traceVerifyStage('before-run-tests', options._trace);
    const testGate = await runObjectiveExecutionGate('test', 'npm test', cwd, options._runTests, 'npm test',
      (reason) => { logger.info(`${modeLabel}: fresh test proof unavailable (${describeCommandCheckFallback(reason)}); running npm test...`); });
    if (testGate.passed) {
      result.passed.push(testGate.reusedReceipt
        ? `${modeLabel}: reused fresh test proof for the current worktree`
        : `${modeLabel}: test suite passes (substitutes execution bookkeeping gates)`);
    } else {
      result.failures.push(`${modeLabel}: test suite failed — fix failing tests before verifying`);
    }
    traceVerifyStage('after-run-tests', options._trace);
    traceVerifyStage('before-run-build', options._trace);
    const buildProofCommand = await resolveBuildProofCommand(cwd);
    const buildGate = await runObjectiveExecutionGate('build', 'npm run build', cwd, options._runBuild, buildProofCommand,
      (reason) => { logger.info(`${modeLabel}: fresh build proof unavailable (${describeCommandCheckFallback(reason)}); running ${buildProofCommand}...`); });
    if (buildGate.passed) {
      result.passed.push(buildGate.reusedReceipt
        ? `${modeLabel}: reused fresh build proof for the current worktree`
        : `${modeLabel}: build succeeds (substitutes execution bookkeeping gates)`);
    } else {
      result.failures.push(`${modeLabel}: build failed — fix build errors before verifying`);
    }
    traceVerifyStage('after-run-build', options._trace);
    if (!options.light) {
      if (!recordedPhaseOneTasks) result.passed.push('TASKS.md is authoritative; missing phase-task bookkeeping did not block receipt-backed verification');
      if (forgeWaveCount === 0) result.passed.push('Verify receipts are authoritative for execution progress when forge-wave audit entries are missing');
    }
  } else {
    if (recordedPhaseOneTasks) {
      result.passed.push(`Phase 1 has ${state.tasks[1]!.length} task(s) defined`);
    } else {
      result.failures.push('No phase 1 tasks are recorded in STATE.yaml');
    }
    if (!stageRequiresExecution(state.workflowStage)) {
      result.failures.push(`Workflow stage "${state.workflowStage}" is not execution-complete. Run "danteforge forge 1" before verify.`);
    } else {
      if (forgeWaveCount > 0) {
        result.passed.push(`${forgeWaveCount} forge wave completion entr${forgeWaveCount === 1 ? 'y' : 'ies'} recorded`);
      } else {
        result.failures.push('No successful forge wave was recorded');
      }
    }
  }

  if (state.workflowStage === 'ux-refine') {
    const stateDir = path.join(cwd, STATE_DIR);
    const uxArtifacts = ['UX_REFINE.md', 'design-tokens.css', 'design-preview.html'];
    const foundArtifacts: string[] = [];
    for (const artifact of uxArtifacts) {
      if (await fileExists(path.join(stateDir, artifact))) foundArtifacts.push(artifact);
    }
    if (foundArtifacts.length === 0) {
      result.failures.push('UX refinement stage recorded but no UX refinement artifacts were found');
    } else {
      result.passed.push(`UX refinement artifacts present: ${foundArtifacts.join(', ')}`);
    }
  }
}

async function runDriftAndAuditChecks(result: VerifyResult, state: DanteState, cwd: string, trace?: (s: string) => void): Promise<void> {
  if (state.auditLog.length > 0) {
    result.passed.push(`Audit log has ${state.auditLog.length} entries`);
  } else {
    result.failures.push('Audit log is empty - no actions recorded yet');
  }
  if (result.failures.length === 0) {
    try {
      traceVerifyStage('before-drift-detect', trace);
      const srcDir = path.join(cwd, 'src');
      if (await fileExists(srcDir)) {
        const modifiedFiles = await listDriftScanFiles(cwd);
        if (modifiedFiles.length > 0) {
          const driftViolations = await detectAIDrift(modifiedFiles);
          const blockers = driftViolations.filter(v => v.severity === 'BLOCKER');
          const warnings = driftViolations.filter(v => v.severity !== 'BLOCKER');
          if (blockers.length > 0) { for (const v of blockers) result.failures.push(`Drift: ${v.message}${v.file ? ` (${v.file})` : ''}`); }
          if (warnings.length > 0) { for (const v of warnings) result.warnings.push(`Drift: ${v.message}${v.file ? ` (${v.file})` : ''}`); }
          if (driftViolations.length === 0) result.passed.push(`AI drift scan clean (${modifiedFiles.length} file${modifiedFiles.length === 1 ? '' : 's'} checked)`);
        }
      }
      traceVerifyStage('after-drift-detect', trace);
    } catch { /* Drift detection should not block verification */ }
  }
}

async function runLiveBrowserVerification(result: VerifyResult, state: DanteState, options: VerifyOptions, stateDir: string, cwd: string, timestamp: string): Promise<void> {
  if (!options.live || !options.url) return;
  try {
    const { detectBrowseBinary, invokeBrowse, getBrowsePort } = await import('../../core/browse-adapter.js');
    const binaryPath = await detectBrowseBinary();
    if (!binaryPath) {
      result.failures.push('Browse binary not found — cannot run live verification. Install with: danteforge browse --install');
    } else {
      const port = getBrowsePort();
      const evidenceDir = path.join(stateDir, 'evidence');
      const browseConfig = { binaryPath, port, evidenceDir };
      const gotoResult = await invokeBrowse('goto', [options.url!], browseConfig);
      if (gotoResult.success) {
        result.passed.push(`Live navigation to ${options.url} succeeded`);
      } else {
        result.failures.push(`Live navigation to ${options.url} failed: ${gotoResult.errorMessage ?? 'unknown'}`);
      }
      const snapshotResult = await invokeBrowse('snapshot', ['--diff'], browseConfig);
      if (snapshotResult.success) {
        result.passed.push('Accessibility snapshot captured');
      } else {
        result.warnings.push('Could not capture accessibility snapshot');
      }
      const screenshotResult = await invokeBrowse('screenshot', [], { ...browseConfig, evidenceDir });
      if (screenshotResult.success && screenshotResult.evidencePath) {
        result.passed.push(`Screenshot saved: ${screenshotResult.evidencePath}`);
        state.auditLog.push(`${timestamp} | verify-live: screenshot → ${screenshotResult.evidencePath}`);
      }
    }
  } catch (err) {
    result.warnings.push(`Live verification error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function saveVerifyStateAndReceipt(state: DanteState, result: VerifyResult, options: VerifyOptions, cwd: string, timestamp: string): Promise<void> {
  if (result.failures.length === 0 && result.warnings.length === 0) {
    state.lastVerifiedAt = timestamp;
    recordWorkflowStage(state, 'verify', timestamp);
  }
  state.lastVerifyStatus = computeVerifyStatus(result);
  state.auditLog.push(`${timestamp} | verify: ${result.passed.length} passed, ${result.warnings.length} warnings, ${result.failures.length} failures`);
  traceVerifyStage('before-save-state', options._trace);
  await saveState(state, { cwd });
  traceVerifyStage('after-save-state', options._trace);
  try {
    traceVerifyStage('before-write-receipt', options._trace);
    let gitSha: string | null = null;
    try { gitSha = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8', timeout: 5000 }).trim(); } catch { /* no git */ }
    const pkgVersion = await readWorkspacePackageVersion(cwd) ?? 'unknown';
    const receiptPath = await writeVerifyReceipt({
      status: computeReceiptStatus(result.passed, result.warnings, result.failures),
      timestamp, project: 'danteforge', version: pkgVersion, gitSha,
      platform: process.platform, nodeVersion: process.version, cwd,
      projectType: state.projectType ?? 'unknown', workflowStage: state.workflowStage,
      commandMode: { release: options.release ?? false, live: options.live ?? false, recompute: options.recompute ?? false },
      passed: result.passed, warnings: result.warnings, failures: result.failures,
      counts: { passed: result.passed.length, warnings: result.warnings.length, failures: result.failures.length },
      releaseCheckPassed: options.release ? result.failures.every(f => !f.includes('Release')) : null,
      liveCheckPassed: options.live ? result.failures.every(f => !f.includes('Live')) : null,
      currentStateFresh: result.failures.every(f => !f.includes('stale')),
      selfEditPolicyEnforced: !!state.selfEditPolicy,
    }, cwd);
    state.lastVerifyReceiptPath = receiptPath;
    await saveState(state, { cwd });
    traceVerifyStage('after-write-receipt', options._trace);
  } catch { /* Receipt write should not block verification */ }
}

async function captureAllVerifyLessons(result: VerifyResult, options: VerifyOptions, cwd: string): Promise<void> {
  if (!options.json && (result.failures.length > 0 || result.warnings.length > 0)) {
    try {
      traceVerifyStage('before-capture-verify-lessons', options._trace);
      const captureVerifyLessons = options._captureVerifyLessons ?? (async (failures: string[], warnings: string[]) => {
        const { captureVerifyLessons: defaultCaptureVerifyLessons } = await import('./lessons.js');
        await defaultCaptureVerifyLessons(failures, warnings);
      });
      await captureVerifyLessons(result.failures, result.warnings);
      traceVerifyStage('after-capture-verify-lessons', options._trace);
    } catch { /* Lessons capture should not block verification. */ }
  }
  if (result.failures.length === 0 && !options.json) {
    const verifyStatus = result.warnings.length > 0 ? 'warn' : 'pass';
    const receipt: VerifyReceipt = {
      status: verifyStatus as 'pass' | 'warn',
      passed: result.passed, warnings: result.warnings, failures: [],
      project: '', version: '', gitSha: null, platform: '', nodeVersion: '',
      cwd, projectType: '', workflowStage: '', timestamp: new Date().toISOString(),
      commandMode: { release: false, live: false, recompute: false },
      counts: { passed: result.passed.length, warnings: result.warnings.length, failures: 0 },
      releaseCheckPassed: null, liveCheckPassed: null, currentStateFresh: true, selfEditPolicyEnforced: false,
    };
    try {
      traceVerifyStage('before-capture-success-lessons', options._trace);
      const captureSuccessLessons = options._captureSuccessLessons ?? (async (verifyReceipt: VerifyReceipt, verifyCwd: string) => {
        const { captureSuccessLessons: defaultCaptureSuccessLessons } = await import('../../core/auto-lessons.js');
        await defaultCaptureSuccessLessons(verifyReceipt, verifyCwd, { _isLLMAvailable: async () => false });
      });
      await captureSuccessLessons(receipt, cwd);
      traceVerifyStage('after-capture-success-lessons', options._trace);
    } catch { /* Success-pattern capture should not block verification. */ }
  }
}

async function outputVerifyResults(result: VerifyResult, options: VerifyOptions): Promise<void> {
  if (options.json) {
    traceVerifyStage('before-json-output', options._trace);
    traceActiveVerifyHandles();
    const status = result.failures.length > 0 ? 'fail' : result.warnings.length > 0 ? 'warn' : 'pass';
    process.stdout.write(JSON.stringify({
      status,
      counts: { passed: result.passed.length, warnings: result.warnings.length, failures: result.failures.length },
      passed: result.passed, warnings: result.warnings, failures: result.failures,
    }) + '\n');
    logger.setStderr(false);
    traceVerifyStage('after-json-output', options._trace);
    return;
  }
  traceVerifyStage('before-report-results', options._trace);
  reportResults(result);
}

export async function verify(options: VerifyOptions = {}) {
  return withErrorBoundary('verify', async () => {
    const cwd = options.cwd ?? process.cwd();
    const stateDir = path.join(cwd, STATE_DIR);
    if (options.json) logger.setStderr(true);
    logger.info('Running verification checks...');
    traceVerifyStage('start', options._trace);
    const result: VerifyResult = { passed: [], warnings: [], failures: [] };
    const timestamp = new Date().toISOString();

    if (await fileExists(stateDir)) {
      result.passed.push('.danteforge/ directory exists');
    } else {
      result.failures.push('.danteforge/ directory missing - run "danteforge review" first');
    }

    let state;
    try {
      traceVerifyStage('before-load-state', options._trace);
      state = await loadState({ cwd });
      traceVerifyStage('after-load-state', options._trace);
      result.passed.push('STATE.yaml is valid and loadable');
    } catch {
      result.failures.push('STATE.yaml is corrupt or unreadable');
      reportResults(result);
      return;
    }

    if (options.recompute) {
      state.projectType = await detectProjectType(cwd);
      logger.info(`Project type re-detected: ${state.projectType}`);
    }

    result.passed.push(`Workflow stage recorded: ${state.workflowStage}`);

    const hasConstitutionArtifact = await fileExists(path.join(stateDir, 'CONSTITUTION.md'));
    if (!state.constitution && hasConstitutionArtifact) {
      state.constitution = 'CONSTITUTION.md';
      result.passed.push('CONSTITUTION.md is authoritative; repaired the missing constitution pointer in STATE.yaml');
    } else if (!state.constitution) {
      result.failures.push('Constitution is not defined');
    }

    await assertArtifact(result, 'CURRENT_STATE.md', 'Repo review', stateDir);
    await validateCurrentStateFreshness(result, stateDir, cwd);
    await assertArtifact(result, 'CONSTITUTION.md', 'Constitution', stateDir);
    await assertArtifact(result, 'SPEC.md', 'Specification', stateDir);
    await assertArtifact(result, 'CLARIFY.md', 'Clarification', stateDir);
    await assertArtifact(result, 'PLAN.md', 'Execution plan', stateDir);
    await assertArtifact(result, 'TASKS.md', 'Task breakdown', stateDir);
    traceVerifyStage('after-artifact-checks', options._trace);
    if (state.designEnabled) await assertArtifact(result, 'DESIGN.op', 'Design-as-Code', stateDir);

    await runExecutionGateChecks(result, state, options, cwd);
    await runDriftAndAuditChecks(result, state, cwd, options._trace);
    await runLiveBrowserVerification(result, state, options, stateDir, cwd, timestamp);
    if (options.release) await runReleaseVerification(result);
    await saveVerifyStateAndReceipt(state, result, options, cwd, timestamp);
    await captureAllVerifyLessons(result, options, cwd);
    await outputVerifyResults(result, options);

    // --- Decision-node: record verify completion (best-effort) ---
    try {
      const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
      const _dnSession = getSession(cwd);
      const verifyStatus = computeVerifyStatus(result);
      await recordDecision({
        session: _dnSession,
        actorType: 'agent',
        prompt: `verify: ${state.project || cwd}`,
        context: { stage: state.workflowStage, failures: result.failures.length, warnings: result.warnings.length, passed: result.passed.length },
        result: verifyStatus,
        success: verifyStatus === 'pass',
        qualityScore: result.failures.length === 0 ? (result.warnings.length === 0 ? 100 : 75) : 0,
      });
    } catch { /* never block verify on recording errors */ }
  });
}

function reportResults(result: VerifyResult) {
  logger.success('\n=== Verification Report ===');

  if (result.passed.length > 0) {
    logger.success(`\nPassed (${result.passed.length}):`);
    for (const message of result.passed) {
      logger.success(`  + ${message}`);
    }
  }

  if (result.warnings.length > 0) {
    logger.warn(`\nWarnings (${result.warnings.length}):`);
    for (const message of result.warnings) {
      logger.warn(`  ! ${message}`);
    }
  }

  if (result.failures.length > 0) {
    logger.error(`\nFailures (${result.failures.length}):`);
    for (const message of result.failures) {
      logger.error(`  x ${message}`);
    }
  }

  const total = result.passed.length + result.warnings.length + result.failures.length;
  if (result.failures.length === 0 && result.warnings.length === 0) {
    logger.success(`\nResult: ${result.passed.length}/${total} checks passed, ${result.warnings.length} warnings`);
    return;
  }

  process.exitCode = 1;
  if (result.failures.length > 0) {
    logger.error(`\nResult: ${result.failures.length} failure(s) - fix before proceeding`);
  } else {
    logger.error(`\nResult: verification incomplete - resolve ${result.warnings.length} warning(s) before proceeding`);
  }
}
