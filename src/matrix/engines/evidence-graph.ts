// Matrix Kernel — Evidence Graph (Phase 9 of PRD §9.6)
//
// Thin index over Time Machine commits + DecisionNode store. Links each
// merge/gate/agent run back to its work packet and lease.
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  EvidenceLink,
  EvidenceGraph,
} from '../types/evidence.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

export interface LinkEvidenceOptions {
  workPacketId: string;
  leaseId: string;
  agentRunId: string;
  gateReportId?: string;
  redTeamReportId?: string;
  tasteGateRequestId?: string;
  mergeDecisionId?: string;
  timeMachineEventId?: string;
  decisionNodeId?: string;
  bundlePath?: string;
  bundleSha256?: string;
  scoreDelta?: EvidenceLink['scoreDelta'];
  _now?: () => string;
}

export function linkEvidence(options: LinkEvidenceOptions): EvidenceLink {
  const now = options._now ?? (() => new Date().toISOString());
  return {
    evidenceId: `evidence.${options.leaseId}.${stamp(now())}`,
    workPacketId: options.workPacketId,
    leaseId: options.leaseId,
    agentRunId: options.agentRunId,
    gateReportId: options.gateReportId,
    redTeamReportId: options.redTeamReportId,
    tasteGateRequestId: options.tasteGateRequestId,
    mergeDecisionId: options.mergeDecisionId,
    timeMachineEventId: options.timeMachineEventId,
    decisionNodeId: options.decisionNodeId,
    bundlePath: options.bundlePath,
    bundleSha256: options.bundleSha256,
    scoreDelta: options.scoreDelta,
    createdAt: now(),
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

export async function appendEvidenceLink(
  link: EvidenceLink,
  cwd?: string,
): Promise<EvidenceGraph> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.evidenceGraph);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });

  let graph: EvidenceGraph;
  try {
    const raw = await fs.readFile(outPath, 'utf8');
    graph = JSON.parse(raw) as EvidenceGraph;
  } catch {
    graph = { generatedAt: new Date().toISOString(), links: [] };
  }

  graph.links.push(link);
  graph.generatedAt = new Date().toISOString();

  await fs.writeFile(outPath, JSON.stringify(graph, null, 2), 'utf8');
  return graph;
}

export async function loadEvidenceGraph(cwd?: string): Promise<EvidenceGraph> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.evidenceGraph);
  try {
    const raw = await fs.readFile(outPath, 'utf8');
    return JSON.parse(raw) as EvidenceGraph;
  } catch {
    return { generatedAt: new Date().toISOString(), links: [] };
  }
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, '-').slice(0, 19);
}
