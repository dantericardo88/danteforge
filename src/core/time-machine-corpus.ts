import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { DecisionNode } from './decision-node.js';
import type { CausalClassification } from './time-machine-causal-attribution.js';

export interface TimeMachineCorpusBuildOptions {
  storePath: string;
  outDir: string;
  minSessions?: number;
  minLabels?: number;
  now?: () => string;
}

export interface TimeMachineCorpusSession {
  sessionId: string;
  timelineId: string;
  nodeCount: number;
  branchPointIds: string[];
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

export interface TimeMachineLabelCandidate {
  branchPointId: string;
  nodeId: string;
  sessionId: string;
  originalTimelineId: string;
  alternateTimelineId: string;
  suggested: CausalClassification;
  reason: string;
}

export interface TimeMachineCorpusBuildResult {
  schemaVersion: 'danteforge.time-machine.corpus.v1';
  createdAt: string;
  storePath: string;
  outDir: string;
  minSessions: number;
  minLabels: number;
  replayedSessionCount: number;
  labelCandidateCount: number;
  readyForHumanAdjudication: boolean;
  readyForEvaluation: boolean;
  artifacts: {
    sessionsJsonl: string;
    labelCandidatesJson: string;
    labelsJson: string;
    manifestJson: string;
  };
  limitations: string[];
}

interface BranchGroup {
  branchPoint: DecisionNode;
  alternateTimelineId: string;
  candidates: TimeMachineLabelCandidate[];
}

export async function buildTimeMachineCorpusBundle(
  options: TimeMachineCorpusBuildOptions,
): Promise<TimeMachineCorpusBuildResult> {
  const minSessions = Math.max(1, options.minSessions ?? 30);
  const minLabels = Math.max(1, options.minLabels ?? 100);
  const createdAt = options.now?.() ?? new Date().toISOString();
  const storePath = path.resolve(options.storePath);
  const outDir = path.resolve(options.outDir);
  const nodes = await readDecisionNodesJsonl(storePath);
  const sessions = collectReplaySessions(nodes);
  const branchGroups = collectLabelCandidates(nodes);
  const labelCandidates = branchGroups.flatMap(group => group.candidates);

  await fs.mkdir(outDir, { recursive: true });
  const sessionsJsonl = path.join(outDir, 'sessions.jsonl');
  const labelCandidatesJson = path.join(outDir, 'label-candidates.json');
  const labelsJson = path.join(outDir, 'labels.json');
  const manifestJson = path.join(outDir, 'manifest.json');

  await fs.writeFile(
    sessionsJsonl,
    sessions.map(session => JSON.stringify(session)).join('\n') + (sessions.length > 0 ? '\n' : ''),
    'utf8',
  );
  await fs.writeFile(
    labelCandidatesJson,
    JSON.stringify({
      schemaVersion: 'danteforge.time-machine.label-candidates.v1',
      createdAt,
      storePath,
      candidateCount: labelCandidates.length,
      candidates: labelCandidates,
    }, null, 2) + '\n',
    'utf8',
  );

  const primaryGroup = branchGroups.find(group => group.candidates.length > 0);
  await fs.writeFile(
    labelsJson,
    JSON.stringify({
      schemaVersion: 'danteforge.time-machine.labels.v1',
      createdAt,
      humanAdjudicated: false,
      instructions: 'Review each suggested label and set humanAdjudicated=true only after final human adjudication.',
      branchPointId: primaryGroup?.branchPoint.id ?? '',
      sessionId: primaryGroup?.branchPoint.sessionId ?? '',
      originalTimelineId: primaryGroup?.branchPoint.timelineId ?? '',
      alternateTimelineId: primaryGroup?.alternateTimelineId ?? '',
      labels: (primaryGroup?.candidates ?? []).map(candidate => ({
        nodeId: candidate.nodeId,
        expected: candidate.suggested,
      })),
    }, null, 2) + '\n',
    'utf8',
  );

  const result: TimeMachineCorpusBuildResult = {
    schemaVersion: 'danteforge.time-machine.corpus.v1',
    createdAt,
    storePath,
    outDir,
    minSessions,
    minLabels,
    replayedSessionCount: sessions.length,
    labelCandidateCount: labelCandidates.length,
    readyForHumanAdjudication: sessions.length >= minSessions && labelCandidates.length >= minLabels,
    readyForEvaluation: false,
    artifacts: {
      sessionsJsonl,
      labelCandidatesJson,
      labelsJson,
      manifestJson,
    },
    limitations: [
      'Label candidates are drafts; precision/recall claims require labels.json to be human-adjudicated before eval-attribution is run.',
      sessions.length >= minSessions
        ? `Replay-session threshold met: ${sessions.length}/${minSessions}.`
        : `Replay-session threshold not met: ${sessions.length}/${minSessions}.`,
      labelCandidates.length >= minLabels
        ? `Label-candidate threshold met: ${labelCandidates.length}/${minLabels}.`
        : `Label-candidate threshold not met: ${labelCandidates.length}/${minLabels}.`,
    ],
  };
  await fs.writeFile(manifestJson, JSON.stringify(result, null, 2) + '\n', 'utf8');
  return result;
}

async function readDecisionNodesJsonl(storePath: string): Promise<DecisionNode[]> {
  if (!existsSync(storePath)) return [];
  const raw = await fs.readFile(storePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as DecisionNode);
}

function collectReplaySessions(nodes: DecisionNode[]): TimeMachineCorpusSession[] {
  const grouped = new Map<string, DecisionNode[]>();
  for (const node of nodes) {
    if (node.timelineId === 'main') continue;
    const key = `${node.sessionId}\u0000${node.timelineId}`;
    const group = grouped.get(key) ?? [];
    group.push(node);
    grouped.set(key, group);
  }
  return [...grouped.entries()]
    .map(([key, group]) => {
      const [sessionId, timelineId] = key.split('\u0000') as [string, string];
      const sorted = group.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const branchPointIds = [...new Set(sorted.map(node => node.causal?.counterfactualOf).filter((id): id is string => Boolean(id)))];
      return {
        sessionId,
        timelineId,
        nodeCount: sorted.length,
        branchPointIds,
        firstTimestamp: sorted[0]?.timestamp ?? null,
        lastTimestamp: sorted.at(-1)?.timestamp ?? null,
      };
    })
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.timelineId.localeCompare(b.timelineId));
}

function collectLabelCandidates(nodes: DecisionNode[]): BranchGroup[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const nodesByTimeline = new Map<string, DecisionNode[]>();
  for (const node of nodes) {
    const key = `${node.sessionId}\u0000${node.timelineId}`;
    const group = nodesByTimeline.get(key) ?? [];
    group.push(node);
    nodesByTimeline.set(key, group);
  }

  const branchToAlternateTimelines = new Map<string, Set<string>>();
  for (const node of nodes) {
    const branchPointId = node.causal?.counterfactualOf;
    if (!branchPointId) continue;
    const timelines = branchToAlternateTimelines.get(branchPointId) ?? new Set<string>();
    timelines.add(node.timelineId);
    branchToAlternateTimelines.set(branchPointId, timelines);
  }

  const groups: BranchGroup[] = [];
  for (const [branchPointId, alternateTimelines] of branchToAlternateTimelines.entries()) {
    const branchPoint = byId.get(branchPointId);
    if (!branchPoint) continue;
    const originalKey = `${branchPoint.sessionId}\u0000${branchPoint.timelineId}`;
    const originalTimeline = (nodesByTimeline.get(originalKey) ?? [])
      .filter(node => node.id !== branchPoint.id)
      .filter(node => new Date(node.timestamp).getTime() >= new Date(branchPoint.timestamp).getTime())
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    for (const alternateTimelineId of alternateTimelines) {
      const candidates = originalTimeline.map(node => ({
        branchPointId,
        nodeId: node.id,
        sessionId: node.sessionId,
        originalTimelineId: node.timelineId,
        alternateTimelineId,
        suggested: node.causal?.classification ?? 'independent',
        reason: node.causal?.classification
          ? 'Existing DecisionNode causal.classification used as a draft label.'
          : 'No explicit causal classification found; draft defaults to independent pending human review.',
      }));
      groups.push({ branchPoint, alternateTimelineId, candidates });
    }
  }
  return groups;
}
