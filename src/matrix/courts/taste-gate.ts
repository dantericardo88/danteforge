// Matrix Kernel — Taste Gate (Phase 10 of PRD §21)
//
// Marks branches that change product-sensitive surfaces (CLI wording, error
// messages, naming, docs, VS Code UX) as requires_human_approval. Read-only
// detection — the actual approval comes via CLI (`matrix taste-gate approve`).
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentLease } from '../types/lease.js';
import type { WorkPacket } from '../types/work-graph.js';
import type { AgentRunResult } from '../types/agent.js';
import type {
  TasteGateRequest,
  TasteGateStatus,
} from '../types/gate.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

export interface CheckTasteGateOptions {
  lease: AgentLease;
  workPacket: WorkPacket;
  agentRunResult: AgentRunResult;
  _now?: () => string;
}

export function checkTasteGate(options: CheckTasteGateOptions): TasteGateRequest {
  const { lease, workPacket, agentRunResult } = options;
  const now = options._now ?? (() => new Date().toISOString());
  const affectedSurfaces = detectAffectedSurfaces(agentRunResult.filesChanged);

  const required = workPacket.tasteGateRequired || affectedSurfaces.length > 0;

  return {
    id: `taste.${lease.id}.${stamp(now())}`,
    leaseId: lease.id,
    workPacketId: workPacket.id,
    status: required ? 'requires_human_approval' : 'not_required',
    reason: required
      ? `${affectedSurfaces.length} product-sensitive surface(s) affected: ${affectedSurfaces.slice(0, 3).join(', ')}`
      : 'No product-sensitive surfaces affected',
    affectedSurfaces,
    requestedAt: now(),
  };
}

export function detectAffectedSurfaces(changedFiles: string[]): string[] {
  const triggers = [
    /src\/cli\/commands\//,
    /src\/cli\/.*help/,
    /^docs\//,
    /\.md$/,
    /^README\.md$/,
    /^CLAUDE\.md$/,
    /vscode-extension\/.*\.(ts|json)$/,
    /^\.claude-plugin\//,
  ];
  const affected = new Set<string>();
  for (const file of changedFiles) {
    const norm = file.replace(/\\/g, '/');
    for (const trigger of triggers) {
      if (trigger.test(norm)) { affected.add(norm); break; }
    }
  }
  return Array.from(affected);
}

// ── Approval lifecycle ──────────────────────────────────────────────────────

export function approveTasteGate(request: TasteGateRequest, by: string, notes?: string): TasteGateRequest {
  return {
    ...request,
    status: 'approved',
    resolvedAt: new Date().toISOString(),
    resolvedBy: by,
    decisionNotes: notes,
  };
}

export function rejectTasteGate(request: TasteGateRequest, by: string, notes?: string): TasteGateRequest {
  return {
    ...request,
    status: 'rejected',
    resolvedAt: new Date().toISOString(),
    resolvedBy: by,
    decisionNotes: notes,
  };
}

export function requireRevision(request: TasteGateRequest, by: string, notes?: string): TasteGateRequest {
  return {
    ...request,
    status: 'needs_revision',
    resolvedAt: new Date().toISOString(),
    resolvedBy: by,
    decisionNotes: notes,
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

export async function writeTasteGates(
  requests: TasteGateRequest[],
  cwd?: string,
): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.tasteGates);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), requests }, null, 2), 'utf8');
  return outPath;
}

export function isBlockingStatus(status: TasteGateStatus): boolean {
  return status === 'requires_human_approval' || status === 'rejected' || status === 'needs_revision';
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, '-').slice(0, 19);
}
