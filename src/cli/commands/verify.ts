import fs from 'fs/promises';
import path from 'path';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadState, recordWorkflowStage, saveState, type WorkflowStage } from '../../core/state.js';
import { logger } from '../../core/logger.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const STATE_DIR = '.danteforge';
const RELEASE_CHECK_MAX_BUFFER = 10 * 1024 * 1024;

interface VerifyResult {
  passed: string[];
  warnings: string[];
  failures: string[];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stageRequiresExecution(stage: WorkflowStage): boolean {
  return stage === 'forge' || stage === 'ux-refine' || stage === 'verify' || stage === 'synthesize';
}

async function assertArtifact(result: VerifyResult, filename: string, label: string): Promise<void> {
  const artifactPath = path.join(STATE_DIR, filename);
  if (await fileExists(artifactPath)) {
    result.passed.push(`${label} (${filename}) present`);
    return;
  }
  result.failures.push(`${label} (${filename}) missing`);
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

export async function verify(options: { release?: boolean; live?: boolean; url?: string; recompute?: boolean } = {}) {
  logger.info('Running verification checks...');

  const result: VerifyResult = { passed: [], warnings: [], failures: [] };
  const timestamp = new Date().toISOString();

  if (await fileExists(STATE_DIR)) {
    result.passed.push('.danteforge/ directory exists');
  } else {
    result.failures.push('.danteforge/ directory missing - run "danteforge review" first');
  }

  let state;
  try {
    state = await loadState();
    result.passed.push('STATE.yaml is valid and loadable');
  } catch {
    result.failures.push('STATE.yaml is corrupt or unreadable');
    reportResults(result);
    return;
  }

  if (options.recompute) {
    const { detectProjectType } = await import('../../core/completion-tracker.js');
    state.projectType = await detectProjectType(process.cwd());
    logger.info(`Project type re-detected: ${state.projectType}`);
  }

  result.passed.push(`Workflow stage recorded: ${state.workflowStage}`);

  if (!state.constitution) {
    result.failures.push('Constitution is not defined');
  }

  await assertArtifact(result, 'CURRENT_STATE.md', 'Repo review');
  await assertArtifact(result, 'CONSTITUTION.md', 'Constitution');
  await assertArtifact(result, 'SPEC.md', 'Specification');
  await assertArtifact(result, 'CLARIFY.md', 'Clarification');
  await assertArtifact(result, 'PLAN.md', 'Execution plan');
  await assertArtifact(result, 'TASKS.md', 'Task breakdown');

  if (state.designEnabled) {
    await assertArtifact(result, 'DESIGN.op', 'Design-as-Code');
  }

  if ((state.tasks[1] ?? []).length > 0) {
    result.passed.push(`Phase 1 has ${state.tasks[1]!.length} task(s) defined`);
  } else {
    result.failures.push('No phase 1 tasks are recorded in STATE.yaml');
  }

  if (!stageRequiresExecution(state.workflowStage)) {
    result.failures.push(`Workflow stage "${state.workflowStage}" is not execution-complete. Run "danteforge forge 1" before verify.`);
  } else {
    const forgeEntries = state.auditLog.filter(entry => entry.includes('| forge: wave '));
    if (forgeEntries.length > 0) {
      result.passed.push(`${forgeEntries.length} forge wave completion entr${forgeEntries.length === 1 ? 'y' : 'ies'} recorded`);
    } else {
      result.failures.push('No successful forge wave was recorded');
    }
  }

  if (state.workflowStage === 'ux-refine') {
    const uxArtifacts = ['UX_REFINE.md', 'design-tokens.css', 'design-preview.html'];
    const foundArtifacts: string[] = [];
    for (const artifact of uxArtifacts) {
      if (await fileExists(path.join(STATE_DIR, artifact))) {
        foundArtifacts.push(artifact);
      }
    }
    if (foundArtifacts.length === 0) {
      result.failures.push('UX refinement stage recorded but no UX refinement artifacts were found');
    } else {
      result.passed.push(`UX refinement artifacts present: ${foundArtifacts.join(', ')}`);
    }
  }

  if (state.auditLog.length > 0) {
    result.passed.push(`Audit log has ${state.auditLog.length} entries`);
  } else {
    result.failures.push('Audit log is empty - no actions recorded yet');
  }

  // Live browser verification
  if (options.live && options.url) {
    try {
      const { detectBrowseBinary, invokeBrowse, getBrowsePort } = await import('../../core/browse-adapter.js');
      const binaryPath = await detectBrowseBinary();
      if (!binaryPath) {
        result.failures.push('Browse binary not found — cannot run live verification. Install with: danteforge browse --install');
      } else {
        const port = getBrowsePort();
        const evidenceDir = path.join(STATE_DIR, 'evidence');
        const browseConfig = { binaryPath, port, evidenceDir };

        const gotoResult = await invokeBrowse('goto', [options.url], browseConfig);
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

  if (options.release) {
    await runReleaseVerification(result);
  }

  if (result.failures.length === 0 && result.warnings.length === 0) {
    state.lastVerifiedAt = timestamp;
    recordWorkflowStage(state, 'verify', timestamp);
  }

  state.auditLog.push(`${timestamp} | verify: ${result.passed.length} passed, ${result.warnings.length} warnings, ${result.failures.length} failures`);
  await saveState(state);

  if (result.failures.length > 0 || result.warnings.length > 0) {
    try {
      const { captureVerifyLessons } = await import('./lessons.js');
      await captureVerifyLessons(result.failures, result.warnings);
    } catch {
      // Lessons capture should not block verification.
    }
  }

  reportResults(result);
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
