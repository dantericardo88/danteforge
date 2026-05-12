// Matrix Kernel — Red Team Verifier (Phase 10 of PRD §20)
//
// Adversarial review of branches that high-risk packets produce. Calls
// callLLM with an adversarial prompt template and parses findings.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentLease } from '../types/lease.js';
import type { WorkPacket } from '../types/work-graph.js';
import type { AgentRunResult } from '../types/agent.js';
import type {
  RedTeamFinding,
  RedTeamReport,
  RedTeamRisk,
  GateReport,
} from '../types/gate.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

// ── Public API ──────────────────────────────────────────────────────────────

export type RedTeamCaller = (prompt: string) => Promise<string>;

export interface VerifyBranchOptions {
  lease: AgentLease;
  workPacket: WorkPacket;
  gateReport: GateReport;
  agentRunResult: AgentRunResult;
  /** Score increase threshold above which Red Team is forced. */
  scoreIncreaseTrigger?: number;
  /** Injection seam: replaces callLLM (REQUIRED in CI; real LLM is opt-in). */
  _redTeamCaller?: RedTeamCaller;
  _now?: () => string;
}

export async function verifyBranchAdversarial(
  options: VerifyBranchOptions,
): Promise<RedTeamReport> {
  const now = options._now ?? (() => new Date().toISOString());
  const required = options.workPacket.redTeamRequired || options.gateReport.status !== 'passed';

  if (!required) {
    return {
      id: `redteam.${options.lease.id}.${stamp(now())}`,
      leaseId: options.lease.id,
      workPacketId: options.workPacket.id,
      status: 'passed',
      riskLevel: 'low',
      recommendation: 'allow_merge',
      findings: [],
      generatedAt: now(),
    };
  }

  if (!options._redTeamCaller) {
    // Default behavior in CI when no caller is injected and live LLM is not enabled:
    // record a "needs_human_review" status so the user is alerted.
    return {
      id: `redteam.${options.lease.id}.${stamp(now())}`,
      leaseId: options.lease.id,
      workPacketId: options.workPacket.id,
      status: 'needs_human_review',
      riskLevel: 'medium',
      recommendation: 'require_human_review',
      findings: [{
        category: 'unsupported_claim',
        severity: 'medium',
        detail: 'Red Team verifier requires either an injected _redTeamCaller or a configured LLM.',
      }],
      generatedAt: now(),
    };
  }

  const prompt = buildRedTeamPrompt(options);
  let raw = '';
  try { raw = await options._redTeamCaller(prompt); }
  catch (err) {
    return {
      id: `redteam.${options.lease.id}.${stamp(now())}`,
      leaseId: options.lease.id,
      workPacketId: options.workPacket.id,
      status: 'needs_human_review',
      riskLevel: 'high',
      recommendation: 'require_human_review',
      findings: [{ category: 'unsupported_claim', severity: 'high', detail: `LLM call failed: ${String(err)}` }],
      generatedAt: now(),
    };
  }

  const findings = parseFindings(raw);
  const status = findings.length === 0 ? 'passed' : 'failed';
  const riskLevel = topRisk(findings);

  return {
    id: `redteam.${options.lease.id}.${stamp(now())}`,
    leaseId: options.lease.id,
    workPacketId: options.workPacket.id,
    status,
    riskLevel,
    recommendation: status === 'passed' ? 'allow_merge' : 'block_merge',
    findings,
    generatedAt: now(),
  };
}

export async function writeRedTeamReports(reports: RedTeamReport[], cwd?: string): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.redTeamReports);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2), 'utf8');
  return outPath;
}

// ── Prompt + parser ────────────────────────────────────────────────────────

export function buildRedTeamPrompt(options: VerifyBranchOptions): string {
  const { workPacket, gateReport, agentRunResult } = options;
  return `You are the Red Team Verifier.

Your job is to prove this branch is NOT ready. Look for:
- fake completion (TODO/throw not-implemented stubs)
- hidden regressions (silent breaking changes)
- broken contracts (API signature changes that callers depend on)
- weak tests (assertions that always pass, e.g. assert.ok(true))
- duplicate architecture (re-implementing an existing module)
- missing wiring (new code not connected to anything)
- unsafe assumptions
- claims not supported by evidence

Work Packet objective: ${workPacket.objective}
Files changed: ${agentRunResult.filesChanged.join(', ')}
Gate report status: ${gateReport.status}

Return ONLY a JSON array of findings, each with shape:
{ "category": "fake_completion" | "hidden_regression" | "broken_contract" | "weak_tests" | "duplicate_architecture" | "missing_wiring" | "unsafe_assumption" | "unsupported_claim",
  "severity": "low" | "medium" | "high" | "critical",
  "detail": "...",
  "affectedFiles": [...] }

If no problems, return an empty array: []`;
}

export function parseFindings(raw: string): RedTeamFinding[] {
  // strip markdown fences if present
  const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  let parsed: unknown;
  try { parsed = JSON.parse(stripped); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const findings: RedTeamFinding[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.category !== 'string' || typeof o.severity !== 'string' || typeof o.detail !== 'string') continue;
    findings.push({
      category: o.category as RedTeamFinding['category'],
      severity: o.severity as RedTeamRisk,
      detail: o.detail,
      affectedFiles: Array.isArray(o.affectedFiles) ? (o.affectedFiles as string[]) : undefined,
    });
  }
  return findings;
}

function topRisk(findings: RedTeamFinding[]): RedTeamRisk {
  const order: RedTeamRisk[] = ['critical', 'high', 'medium', 'low'];
  for (const r of order) {
    if (findings.some(f => f.severity === r)) return r;
  }
  return 'low';
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, '-').slice(0, 19);
}
