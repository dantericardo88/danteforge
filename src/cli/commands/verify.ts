import fs from 'fs/promises';
import path from 'path';
import { exec, execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { writeVerifyReceipt, computeReceiptStatus } from '../../core/verify-receipts.js';
import { loadState, recordWorkflowStage, saveState, type WorkflowStage } from '../../core/state.js';
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

async function runCommandCheck(command: string, cwd: string): Promise<boolean> {
  try {
    await execAsync(command, { cwd, env: process.env });
    return true;
  } catch {
    return false;
  }
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

export async function verify(options: {
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
} = {}) {
  return withErrorBoundary('verify', async () => {
  const cwd = options.cwd ?? process.cwd();
  const stateDir = path.join(cwd, '.danteforge');

  // In JSON mode, redirect all logger output to stderr so stdout is clean JSON
  if (options.json) {
    logger.setStderr(true);
  }

  logger.info('Running verification checks...');

  const result: VerifyResult = { passed: [], warnings: [], failures: [] };
  const timestamp = new Date().toISOString();

  if (await fileExists(stateDir)) {
    result.passed.push('.danteforge/ directory exists');
  } else {
    result.failures.push('.danteforge/ directory missing - run "danteforge review" first');
  }

  let state;
  try {
    state = await loadState({ cwd });
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

  if (!state.constitution) {
    result.failures.push('Constitution is not defined');
  }

  await assertArtifact(result, 'CURRENT_STATE.md', 'Repo review', stateDir);
  await validateCurrentStateFreshness(result, stateDir, cwd);
  await assertArtifact(result, 'CONSTITUTION.md', 'Constitution', stateDir);
  await assertArtifact(result, 'SPEC.md', 'Specification', stateDir);
  await assertArtifact(result, 'CLARIFY.md', 'Clarification', stateDir);
  await assertArtifact(result, 'PLAN.md', 'Execution plan', stateDir);
  await assertArtifact(result, 'TASKS.md', 'Task breakdown', stateDir);

  if (state.designEnabled) {
    await assertArtifact(result, 'DESIGN.op', 'Design-as-Code', stateDir);
  }

  if (options.light) {
    // Light mode: for CLI tools whose "execution" is their test suite, substitute
    // the pipeline execution checks (forge waves, workflow stage, task phases) with
    // direct quality gates — npm test and npm run build.
    const runTests = options._runTests ?? ((dir: string) => runCommandCheck('npm test', dir));
    const runBuild = options._runBuild ?? ((dir: string) => runCommandCheck('npm run build', dir));

    if (await runTests(cwd)) {
      result.passed.push('Light mode: test suite passes (substitutes forge wave check)');
    } else {
      result.failures.push('Light mode: test suite failed — fix failing tests before verifying');
    }

    if (await runBuild(cwd)) {
      result.passed.push('Light mode: build succeeds (substitutes task phase check)');
    } else {
      result.failures.push('Light mode: build failed — fix build errors before verifying');
    }
  } else {
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
  }

  if (state.workflowStage === 'ux-refine') {
    const uxArtifacts = ['UX_REFINE.md', 'design-tokens.css', 'design-preview.html'];
    const foundArtifacts: string[] = [];
    for (const artifact of uxArtifacts) {
      if (await fileExists(path.join(stateDir, artifact))) {
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

  // AI drift detection on source files
  try {
    const srcDir = path.join(cwd, 'src');
    if (await fileExists(srcDir)) {
      const { execSync } = await import('node:child_process');
      let modifiedFiles: string[] = [];
      try {
        const gitOutput = execSync('git diff --name-only HEAD~1 -- src/', {
          cwd,
          encoding: 'utf8',
          timeout: 10000,
        }).trim();
        modifiedFiles = gitOutput ? gitOutput.split('\n').filter(Boolean) : [];
      } catch {
        // Git not available or no commits — skip drift check
      }

      if (modifiedFiles.length > 0) {
        const driftViolations = await detectAIDrift(modifiedFiles);
        const blockers = driftViolations.filter(v => v.severity === 'BLOCKER');
        const warnings = driftViolations.filter(v => v.severity !== 'BLOCKER');

        if (blockers.length > 0) {
          for (const v of blockers) {
            result.failures.push(`Drift: ${v.message}${v.file ? ` (${v.file})` : ''}`);
          }
        }
        if (warnings.length > 0) {
          for (const v of warnings) {
            result.warnings.push(`Drift: ${v.message}${v.file ? ` (${v.file})` : ''}`);
          }
        }
        if (driftViolations.length === 0) {
          result.passed.push(`AI drift scan clean (${modifiedFiles.length} file${modifiedFiles.length === 1 ? '' : 's'} checked)`);
        }
      }
    }
  } catch {
    // Drift detection should not block verification
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
        const evidenceDir = path.join(stateDir, 'evidence');
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

  state.lastVerifyStatus = computeVerifyStatus(result);
  state.auditLog.push(`${timestamp} | verify: ${result.passed.length} passed, ${result.warnings.length} warnings, ${result.failures.length} failures`);
  await saveState(state, { cwd });

  // Write receipt file and persist path for scoring
  try {
    let gitSha: string | null = null;
    try { gitSha = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8', timeout: 5000 }).trim(); } catch { /* no git */ }
    const pkgVersion = await readWorkspacePackageVersion(cwd) ?? 'unknown';
    const receiptPath = await writeVerifyReceipt({
      status: computeReceiptStatus(result.passed, result.warnings, result.failures),
      timestamp,
      project: 'danteforge',
      version: pkgVersion,
      gitSha,
      platform: process.platform,
      nodeVersion: process.version,
      cwd,
      projectType: state.projectType ?? 'unknown',
      workflowStage: state.workflowStage,
      commandMode: { release: options.release ?? false, live: options.live ?? false, recompute: options.recompute ?? false },
      passed: result.passed,
      warnings: result.warnings,
      failures: result.failures,
      counts: { passed: result.passed.length, warnings: result.warnings.length, failures: result.failures.length },
      releaseCheckPassed: options.release ? result.failures.every(f => !f.includes('Release')) : null,
      liveCheckPassed: options.live ? result.failures.every(f => !f.includes('Live')) : null,
      currentStateFresh: result.failures.every(f => !f.includes('stale')),
      selfEditPolicyEnforced: !!state.selfEditPolicy,
    }, cwd);
    state.lastVerifyReceiptPath = receiptPath;
    await saveState(state, { cwd });
  } catch {
    // Receipt write should not block verification
  }

  if (result.failures.length > 0 || result.warnings.length > 0) {
    try {
      const { captureVerifyLessons } = await import('./lessons.js');
      await captureVerifyLessons(result.failures, result.warnings);
    } catch {
      // Lessons capture should not block verification.
    }
  }

  // On pass or warn: fire-and-forget success pattern capture (OpenSpace CAPTURED mode).
  // Extracts 2-3 reusable patterns from the git diff → lessons.md → feeds next forge.
  if (result.failures.length === 0) {
    const verifyStatus = result.warnings.length > 0 ? 'warn' : 'pass';
    import('../../core/auto-lessons.js').then(({ captureSuccessLessons }) => {
      const receipt = {
        status: verifyStatus as 'pass' | 'warn',
        passed: result.passed,
        warnings: result.warnings,
        failures: [],
        // Minimal receipt — captureSuccessLessons only needs status, passed, warnings
        project: '', version: '', gitSha: null, platform: '', nodeVersion: '',
        cwd, projectType: '', workflowStage: '',
        timestamp: new Date().toISOString(),
        commandMode: { release: false, live: false, recompute: false },
        counts: { passed: result.passed.length, warnings: result.warnings.length, failures: 0 },
        releaseCheckPassed: null, liveCheckPassed: null,
        currentStateFresh: true, selfEditPolicyEnforced: false,
      };
      captureSuccessLessons(receipt, cwd).catch(() => {});
    }).catch(() => {});
  }

  if (options.json) {
    const status = result.failures.length > 0 ? 'fail'
      : result.warnings.length > 0 ? 'warn'
      : 'pass';
    const output = {
      status,
      counts: {
        passed: result.passed.length,
        warnings: result.warnings.length,
        failures: result.failures.length,
      },
      passed: result.passed,
      warnings: result.warnings,
      failures: result.failures,
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    // Reset stderr redirect after JSON output
    logger.setStderr(false);
    return;
  }

  reportResults(result);
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
