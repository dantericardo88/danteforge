// Matrix Kernel — Verification Court (Phase 9 of PRD §19)
//
// Sequential checks against a branch:
//   1. forbidden_paths   — diff vs lease.forbiddenPaths
//   2. protected_paths   — diff vs frozen files
//   3. lease_compliance  — every changed file inside allowedWritePaths
//   4. required_commands — npm test / typecheck etc. exit 0
//   5. no_stub_scan      — AST + regex scan for TODO/not-implemented
//   6. dimension_score   — optional re-score check
//
// Produces a GateReport (PRD §19) and an EvidenceLink (PRD §9.6).
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AgentLease } from '../types/lease.js';
import type { WorkPacket } from '../types/work-graph.js';
import type { OwnershipMap } from '../types/ownership.js';
import type { AgentRunResult } from '../types/agent.js';
import type {
  GateCheckResult,
  GateReport,
} from '../types/gate.js';
import { validateChangedFiles } from '../engines/lease-manager.js';
import { isPathFrozen } from '../engines/ownership-map.js';
import { scanForStubs } from './no-stub-scanner.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';
import { matchesGlob } from '../util/glob.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface ReviewBranchOptions {
  lease: AgentLease;
  workPacket: WorkPacket;
  ownershipMap: OwnershipMap;
  agentRunResult: AgentRunResult;
  /** Skip running requiredCommands (used in tests). */
  skipRequiredCommands?: boolean;
  /** Project root used to load `.danteforge/test-config.json`. Defaults to process.cwd(). */
  cwd?: string;
  /** Injection seam: replaces command runner for tests. */
  _runCommand?: (cmd: string, cwd: string, env?: Record<string, string>) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** Injection seam: override loaded test config (skips file read). */
  _testConfig?: import('./verify-test-config.js').VerifyTestConfig;
  _now?: () => string;
}

export async function reviewBranch(options: ReviewBranchOptions): Promise<GateReport> {
  const now = options._now ?? (() => new Date().toISOString());
  const { lease, workPacket, ownershipMap, agentRunResult } = options;
  const checks: GateCheckResult[] = [];

  // Load test-config (knownFlaky skips, alwaysRun overrides) once. Missing
  // file is non-fatal — defaults apply. The host project's repo root drives
  // the lookup, not the lease worktree, because the config is project-wide.
  const { loadVerifyTestConfig, buildSkipPatternEnv } = await import('./verify-test-config.js');
  const testConfig = options._testConfig ?? await loadVerifyTestConfig({ cwd: options.cwd });
  const skipPattern = buildSkipPatternEnv(testConfig);

  // Check 1: forbidden_paths
  checks.push(checkForbiddenPaths(lease, agentRunResult.filesChanged));

  // Check 2: protected_paths
  checks.push(checkProtectedPaths(ownershipMap, agentRunResult.filesChanged));

  // Check 3: lease_compliance
  checks.push(checkLeaseCompliance(lease, ownershipMap, agentRunResult.filesChanged));

  // Check 4: required_commands
  if (!options.skipRequiredCommands && lease.requiredCommands.length > 0) {
    // If scopeToDiff is enabled, replace `npm test` with a focused
    // `npx tsx --test <files>` invocation. The file selection uses the
    // lease's filesChanged plus the always-run patterns from test-config.
    let scopedTestCmd: string | null = null;
    if (testConfig.scopeToDiff) {
      const { selectTestsForDiff } = await import('./diff-scoped-tests.js');
      const selected = await selectTestsForDiff({
        changedFiles: agentRunResult.filesChanged,
        cwd: options.cwd,
        alwaysRun: testConfig.alwaysRun,
      });
      if (selected.length > 0) {
        scopedTestCmd = `npx tsx --test ${selected.join(' ')}`;
      } else {
        // Empty selection on a non-empty diff = nothing to test; we still
        // mark it as a passed check to record the decision.
        scopedTestCmd = '';
      }
    }

    for (const cmd of lease.requiredCommands) {
      const isTestCmd = cmd.includes('npm test') || cmd.includes('npm run test') || cmd.includes('pnpm test') || cmd.includes('pnpm run test');

      // If we have a scoped replacement, sub it in. Empty replacement means
      // "no tests to run for this diff" — skip the spawn and report passed.
      if (isTestCmd && scopedTestCmd !== null) {
        if (scopedTestCmd === '') {
          checks.push({
            name: `required_command:${cmd}`,
            status: 'passed',
            details: 'skipped: diff-scoping selected 0 tests for this lease',
          });
          continue;
        }
        const extraEnv = skipPattern ? { TEST_SKIP_PATTERNS: skipPattern } : undefined;
        const result = await runCommand(scopedTestCmd, lease.worktreePath, options._runCommand, extraEnv);
        checks.push({
          name: `required_command:${cmd}`,
          status: result.exitCode === 0 ? 'passed' : 'failed',
          details: result.exitCode === 0
            ? `exit 0 (diff-scoped: ${scopedTestCmd.split(' ').length - 3} test file(s))`
            : `exit ${result.exitCode} (diff-scoped): ${result.stderr.slice(0, 200)}`,
        });
        continue;
      }

      // Default path: full-suite test invocation, with TEST_SKIP_PATTERNS env
      // if knownFlaky cases are configured.
      const extraEnv = isTestCmd && skipPattern
        ? { TEST_SKIP_PATTERNS: skipPattern }
        : undefined;
      const result = await runCommand(cmd, lease.worktreePath, options._runCommand, extraEnv);
      const skippedNote = extraEnv ? ` (skip-patterns: ${skipPattern})` : '';
      checks.push({
        name: `required_command:${cmd}`,
        status: result.exitCode === 0 ? 'passed' : 'failed',
        details: result.exitCode === 0 ? `exit 0${skippedNote}` : `exit ${result.exitCode}${skippedNote}: ${result.stderr.slice(0, 200)}`,
      });
    }
  }

  // Check 5: no_stub_scan
  const stubResult = await scanForStubs({
    files: agentRunResult.filesChanged,
    worktreeRoot: lease.worktreePath,
  });
  checks.push({
    name: 'no_stub_scan',
    status: stubResult.ok ? 'passed' : 'failed',
    details: stubResult.ok
      ? 'no stubs detected'
      : `${stubResult.findings.length} stub(s) detected: ${stubResult.findings.slice(0, 3).map(f => `${f.filePath}:${f.line} (${f.kind})`).join('; ')}`,
  });

  // Check 6: dimension_score — validates score against capability_test ceiling
  checks.push(await checkDimensionScore(workPacket, options.cwd));

  const status: GateReport['status'] = checks.some(c => c.status === 'failed')
    ? 'failed'
    : checks.some(c => c.status === 'warning')
      ? 'warning'
      : 'passed';

  return {
    id: `gate.${lease.id}.${stamp(now())}`,
    leaseId: lease.id,
    workPacketId: workPacket.id,
    status,
    checks,
    generatedAt: now(),
  };
}

export async function writeGateReports(reports: GateReport[], cwd?: string): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.gateReports);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2), 'utf8');
  return outPath;
}

// ── Check implementations ───────────────────────────────────────────────────

function checkForbiddenPaths(lease: AgentLease, changed: string[]): GateCheckResult {
  const violations: string[] = [];
  for (const f of changed) {
    for (const forbidden of lease.forbiddenPaths) {
      if (matchesGlob(f, forbidden)) violations.push(f);
    }
  }
  return {
    name: 'forbidden_paths',
    status: violations.length === 0 ? 'passed' : 'failed',
    details: violations.length === 0
      ? 'no forbidden paths edited'
      : `${violations.length} forbidden path(s) edited: ${violations.slice(0, 3).join(', ')}`,
  };
}

function checkProtectedPaths(ownership: OwnershipMap, changed: string[]): GateCheckResult {
  const violations = changed.filter(f => isPathFrozen(ownership, f));
  return {
    name: 'protected_paths',
    status: violations.length === 0 ? 'passed' : 'failed',
    details: violations.length === 0
      ? 'no frozen paths edited'
      : `${violations.length} frozen path(s) edited: ${violations.slice(0, 3).join(', ')}`,
  };
}

function checkLeaseCompliance(
  lease: AgentLease,
  ownership: OwnershipMap,
  changed: string[],
): GateCheckResult {
  const result = validateChangedFiles(lease, changed, ownership);
  return {
    name: 'lease_compliance',
    status: result.valid ? 'passed' : 'failed',
    details: result.valid
      ? 'all changes within lease scope'
      : result.violations.slice(0, 3).join('; '),
  };
}

// ── Dimension score check ────────────────────────────────────────────────────

async function checkDimensionScore(
  workPacket: WorkPacket,
  cwd?: string,
): Promise<GateCheckResult> {
  const root = cwd ?? process.cwd();
  const matrixPath = path.join(root, '.danteforge', 'compete', 'matrix.json');
  try {
    type MatrixDim = { id: string; scores?: Record<string, number>; ceiling?: number; capability_test?: string; no_capability_test?: boolean };
    const raw = JSON.parse(await fs.readFile(matrixPath, 'utf-8')) as { dimensions?: MatrixDim[] };
    const dim = (raw.dimensions ?? []).find(d => d.id === workPacket.dimensionId);
    if (!dim) {
      return { name: 'dimension_score', status: 'warning', details: 'dimension "' + workPacket.dimensionId + '" not found in matrix.json' };
    }
    const selfScore = dim.scores?.['self'] ?? 0;
    const ceiling = dim.ceiling;
    const hasCapTest = !!(dim.capability_test || dim.no_capability_test);
    const noTestCap = 7.0;
    if (!hasCapTest && selfScore > noTestCap) {
      return { name: 'dimension_score', status: 'failed', details: 'score ' + selfScore + ' exceeds ' + noTestCap + ' ceiling — no capability_test defined for "' + workPacket.dimensionId + '"' };
    }
    if (ceiling !== undefined && selfScore > ceiling) {
      return { name: 'dimension_score', status: 'failed', details: 'score ' + selfScore + ' exceeds dimension ceiling ' + ceiling + ' for "' + workPacket.dimensionId + '"' };
    }
    const ceilingNote = ceiling !== undefined ? ' / ceiling ' + ceiling : '';
    const capNote = !hasCapTest ? ' (no capability_test, cap 7.0)' : '';
    return { name: 'dimension_score', status: 'passed', details: 'score ' + selfScore + ceilingNote + capNote };
  } catch {
    return { name: 'dimension_score', status: 'passed', details: 'matrix.json not found — score check skipped' };
  }
}

// ── Command runner ──────────────────────────────────────────────────────────

async function runCommand(
  cmd: string,
  cwd: string,
  injected?: (cmd: string, cwd: string, env?: Record<string, string>) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
  extraEnv?: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (injected) return injected(cmd, cwd, extraEnv);
  return new Promise((resolve) => {
    const parts = cmd.split(/\s+/);
    const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
    const child = spawn(parts[0]!, parts.slice(1), { cwd, shell: true, env });
    let stdout = '', stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => { stdout += c; });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (c: string) => { stderr += c; });
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    child.on('error', () => resolve({ exitCode: 1, stdout, stderr }));
  });
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, '-').slice(0, 19);
}
