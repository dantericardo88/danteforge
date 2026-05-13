// Phase 9 — Verification Court + No-stub scanner tests
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reviewBranch } from '../../src/matrix/courts/verification-court.js';
import { scanContent, scanForStubs } from '../../src/matrix/courts/no-stub-scanner.js';
import { linkEvidence, appendEvidenceLink, loadEvidenceGraph } from '../../src/matrix/engines/evidence-graph.js';
import type { AgentLease, OwnershipMap, WorkPacket, AgentRunResult } from '../../src/matrix/types/index.js';

const tmpDirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'matrix-vc-'));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function lease(worktree: string, overrides: Partial<AgentLease> = {}): AgentLease {
  return {
    id: 'lease.test', workPacketId: 'work.test',
    provider: 'fake', agentRole: 'dimension-engineer',
    branch: 'b', worktreePath: worktree,
    allowedWritePaths: ['src/owned/**'],
    allowedReadPaths: [], forbiddenPaths: ['src/forbidden/**'],
    requiredCommands: [], budget: { maxTokens: 1, maxRuntimeMinutes: 1, maxIterations: 1 },
    status: 'active',
    ...overrides,
  };
}

function packet(overrides: Partial<WorkPacket> = {}): WorkPacket {
  return {
    id: 'work.test', title: 't', objective: 'o',
    dimensionId: 'dim.test',
    paths: { ownedPaths: ['src/owned/**'], readOnlyPaths: [], forbiddenPaths: ['src/forbidden/**'] },
    dependsOn: [], mayConflictWith: [],
    acceptanceCriteria: ['a'], proof: { proofRequired: ['p'] },
    tasteGateRequired: false, redTeamRequired: false,
    rollbackPlan: 'r', riskLevel: 'low', createdAt: '',
    ...overrides,
  };
}

function ownership(frozen: string[] = []): OwnershipMap {
  return { version: 1, generatedAt: '', globalAllowed: [], workstreams: {}, frozenFiles: frozen };
}

function runResult(filesChanged: string[]): AgentRunResult {
  return {
    runId: 'run.1', leaseId: 'lease.test', status: 'completed',
    filesChanged, commandsExecuted: [],
    startedAt: '', completedAt: '',
  };
}

// ── No-stub scanner ─────────────────────────────────────────────────────────

describe('scanContent', () => {
  it('catches throw new Error("not implemented")', () => {
    const findings = scanContent('src/x.ts', `function x() {\n  throw new Error("not implemented");\n}`);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.kind, 'not-implemented');
  });

  it('catches stub TODO with closing brace', () => {
    const findings = scanContent('src/x.ts', `function x() {\n  // TODO: implement\n}`);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.kind, 'todo-comment');
  });

  it('catches empty function body', () => {
    const findings = scanContent('src/x.ts', `export function x() {}`);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.kind, 'empty-body');
  });

  it('catches fake test assert.ok(true)', () => {
    const findings = scanContent('src/x.test.ts', `it('passes', () => { assert.ok(true); });`);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.kind, 'fake-test');
  });

  it('does NOT flag clean implementations', () => {
    const findings = scanContent('src/x.ts', `export function add(a: number, b: number): number {\n  return a + b;\n}`);
    assert.equal(findings.length, 0);
  });

  it('flags "Placeholder content" comment (caught from live-LLM ollama run)', () => {
    const findings = scanContent('src/x.ts', `// Placeholder content to demonstrate file change\nexport function x() {\n  return 'stub';\n}`);
    assert.ok(findings.length > 0, 'should detect placeholder marker in comment');
  });

  it('flags "dummy" marker in comments', () => {
    const findings = scanContent('src/x.ts', `// dummy impl\nexport const x = 1;`);
    assert.ok(findings.length > 0);
  });

  it('flags "coming soon" marker in comments', () => {
    const findings = scanContent('src/x.ts', `/* feature coming soon */\nexport const x = 1;`);
    assert.ok(findings.length > 0);
  });
});

describe('scanForStubs', () => {
  it('scans files via fs, returns ok:false on findings', async () => {
    const cwd = await tmp();
    await fs.writeFile(path.join(cwd, 'stub.ts'), `function x() { throw new Error('not implemented'); }`);
    const result = await scanForStubs({ files: ['stub.ts'], worktreeRoot: cwd });
    assert.equal(result.ok, false);
    assert.equal(result.findings.length, 1);
  });

  it('returns ok:true when no findings', async () => {
    const cwd = await tmp();
    await fs.writeFile(path.join(cwd, 'clean.ts'), `export const ok = true;`);
    const result = await scanForStubs({ files: ['clean.ts'], worktreeRoot: cwd });
    assert.equal(result.ok, true);
  });
});

// ── Verification Court ─────────────────────────────────────────────────────

describe('reviewBranch', () => {
  it('rejects forbidden-path edits', async () => {
    const cwd = await tmp();
    await fs.mkdir(path.join(cwd, 'src/forbidden'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'src/forbidden/danger.ts'), `export const x = 1;`);
    const report = await reviewBranch({
      lease: lease(cwd),
      workPacket: packet(),
      ownershipMap: ownership(),
      agentRunResult: runResult(['src/forbidden/danger.ts']),
      skipRequiredCommands: true,
    });
    assert.equal(report.status, 'failed');
    const forbidden = report.checks.find(c => c.name === 'forbidden_paths');
    assert.equal(forbidden!.status, 'failed');
  });

  it('rejects frozen-path edits', async () => {
    const cwd = await tmp();
    await fs.mkdir(path.join(cwd, 'src/owned'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'src/owned/x.ts'), `export const x = 1;`);
    const report = await reviewBranch({
      lease: lease(cwd),
      workPacket: packet(),
      ownershipMap: ownership(['src/owned/x.ts']),
      agentRunResult: runResult(['src/owned/x.ts']),
      skipRequiredCommands: true,
    });
    assert.equal(report.status, 'failed');
    const protectedCheck = report.checks.find(c => c.name === 'protected_paths');
    assert.equal(protectedCheck!.status, 'failed');
  });

  it('rejects stub commits via no_stub_scan', async () => {
    const cwd = await tmp();
    await fs.mkdir(path.join(cwd, 'src/owned'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'src/owned/x.ts'), `export function stub(): never { throw new Error('not implemented'); }`);
    const report = await reviewBranch({
      lease: lease(cwd),
      workPacket: packet(),
      ownershipMap: ownership(),
      agentRunResult: runResult(['src/owned/x.ts']),
      skipRequiredCommands: true,
    });
    assert.equal(report.status, 'failed');
    const stub = report.checks.find(c => c.name === 'no_stub_scan');
    assert.equal(stub!.status, 'failed');
  });

  it('passes a clean branch', async () => {
    const cwd = await tmp();
    await fs.mkdir(path.join(cwd, 'src/owned'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'src/owned/x.ts'), `export function add(a: number, b: number): number { return a + b; }`);
    const report = await reviewBranch({
      lease: lease(cwd),
      workPacket: packet(),
      ownershipMap: ownership(),
      agentRunResult: runResult(['src/owned/x.ts']),
      skipRequiredCommands: true,
    });
    assert.equal(report.status, 'passed');
  });

  it('honors required_commands when not skipped', async () => {
    const cwd = await tmp();
    await fs.mkdir(path.join(cwd, 'src/owned'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'src/owned/x.ts'), `export const ok = true;`);
    const report = await reviewBranch({
      lease: lease(cwd, { requiredCommands: ['echo hi', 'false'] }),
      workPacket: packet(),
      ownershipMap: ownership(),
      agentRunResult: runResult(['src/owned/x.ts']),
      _runCommand: async (cmd) => ({
        exitCode: cmd === 'echo hi' ? 0 : 1,
        stdout: '', stderr: '',
      }),
    });
    const echoCheck = report.checks.find(c => c.name === 'required_command:echo hi');
    const falseCheck = report.checks.find(c => c.name === 'required_command:false');
    assert.equal(echoCheck!.status, 'passed');
    assert.equal(falseCheck!.status, 'failed');
    assert.equal(report.status, 'failed');
  });
});

// ── Evidence Graph ─────────────────────────────────────────────────────────

describe('Evidence Graph', () => {
  it('linkEvidence + appendEvidenceLink persists to canonical path', async () => {
    const cwd = await tmp();
    const link = linkEvidence({
      workPacketId: 'w', leaseId: 'l', agentRunId: 'r',
      gateReportId: 'g', scoreDelta: { dimensionId: 'd', before: 1, after: 2 },
    });
    await appendEvidenceLink(link, cwd);
    const graph = await loadEvidenceGraph(cwd);
    assert.equal(graph.links.length, 1);
    assert.equal(graph.links[0]!.leaseId, 'l');
  });
});
