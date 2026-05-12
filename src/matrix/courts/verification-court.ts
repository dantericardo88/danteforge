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

// ── Public API ──────────────────────────────────────────────────────────────

export interface ReviewBranchOptions {
  lease: AgentLease;
  workPacket: WorkPacket;
  ownershipMap: OwnershipMap;
  agentRunResult: AgentRunResult;
  /** Skip running requiredCommands (used in tests). */
  skipRequiredCommands?: boolean;
  /** Injection seam: replaces command runner for tests. */
  _runCommand?: (cmd: string, cwd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  _now?: () => string;
}

export async function reviewBranch(options: ReviewBranchOptions): Promise<GateReport> {
  const now = options._now ?? (() => new Date().toISOString());
  const { lease, workPacket, ownershipMap, agentRunResult } = options;
  const checks: GateCheckResult[] = [];

  // Check 1: forbidden_paths
  checks.push(checkForbiddenPaths(lease, agentRunResult.filesChanged));

  // Check 2: protected_paths
  checks.push(checkProtectedPaths(ownershipMap, agentRunResult.filesChanged));

  // Check 3: lease_compliance
  checks.push(checkLeaseCompliance(lease, ownershipMap, agentRunResult.filesChanged));

  // Check 4: required_commands
  if (!options.skipRequiredCommands && lease.requiredCommands.length > 0) {
    for (const cmd of lease.requiredCommands) {
      const result = await runCommand(cmd, lease.worktreePath, options._runCommand);
      checks.push({
        name: `required_command:${cmd}`,
        status: result.exitCode === 0 ? 'passed' : 'failed',
        details: result.exitCode === 0 ? 'exit 0' : `exit ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
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

  // Check 6: dimension_score (placeholder — Merge Court computes the real delta)
  checks.push({
    name: 'dimension_score',
    status: 'passed',
    details: `pending merge-court arbitration for ${workPacket.dimensionId}`,
  });

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

// ── Command runner ──────────────────────────────────────────────────────────

async function runCommand(
  cmd: string,
  cwd: string,
  injected?: (cmd: string, cwd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (injected) return injected(cmd, cwd);
  return new Promise((resolve) => {
    const parts = cmd.split(/\s+/);
    const child = spawn(parts[0]!, parts.slice(1), { cwd, shell: true });
    let stdout = '', stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => { stdout += c; });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (c: string) => { stderr += c; });
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    child.on('error', () => resolve({ exitCode: 1, stdout, stderr }));
  });
}

// ── Glob matching (shared with engines) ─────────────────────────────────────

function matchesGlob(filePath: string, glob: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const normalizedGlob = glob.replace(/\\/g, '/');
  const escaped = normalizedGlob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*');
  return new RegExp(`^${escaped}$`).test(normalized);
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, '-').slice(0, 19);
}
