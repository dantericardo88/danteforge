// Matrix Kernel — CouncilScheduler
//
// Loads eligible dimensions from the competitive matrix and distributes them
// across available council members, prioritising highest gap.
// Uses member strength profiles (council-member-profiles.ts) to route dims to
// the builder most likely to succeed; falls back to round-robin when no profile
// matches. No LLM calls here — pure data slicing.
import path from 'node:path';
import fs from 'node:fs/promises';
import { bestMemberForDim } from './council-member-profiles.js';
import type { CouncilSlot } from './council-slot.js';

export type CouncilMemberId = 'codex' | 'gemini-cli' | 'grok-build' | 'claude-code';

export interface ScheduledDimension {
  dimensionId: string;
  label: string;
  currentScore: number;
  gapToFrontier: number;
  assignedTo: CouncilMemberId;
  /** Set when slot-aware scheduling is used (slotsPerMember > 1). */
  assignedSlot?: CouncilSlot;
}

export interface SchedulerOptions {
  /** Path to competitive matrix JSON (default: <cwd>/.danteforge/compete/matrix.json) */
  matrixPath?: string;
  /** Only include dims with gap >= this value (default: 0.3) */
  minGap?: number;
  /** Cap total dims per scheduling pass (default: unlimited) */
  maxDims?: number;
  /** Only schedule these specific dimension IDs (overrides gap ranking; still respects maxDims) */
  focusDims?: string[];
}

interface RawDimension {
  id: string;
  name?: string;
  scores?: { self?: number };
  gap_to_oss_leader?: number;
  gap_to_leader?: number;
}

interface RawMatrix {
  dimensions?: RawDimension[];
}

async function readMatrix(matrixPath: string): Promise<RawMatrix> {
  try {
    return JSON.parse(await fs.readFile(matrixPath, 'utf8')) as RawMatrix;
  } catch { return {}; }
}

export async function scheduleWork(
  memberIds: CouncilMemberId[],
  cwd: string,
  opts?: SchedulerOptions,
): Promise<ScheduledDimension[]> {
  if (memberIds.length === 0) return [];

  const matrixPath = opts?.matrixPath ?? path.join(cwd, '.danteforge', 'compete', 'matrix.json');
  const minGap = opts?.minGap ?? 0.3;

  const { dimensions = [] } = await readMatrix(matrixPath);

  let eligible = dimensions
    .filter(d => {
      if (opts?.focusDims?.length) return opts.focusDims.includes(d.id);
      const score = d.scores?.self ?? 0;
      const gap = d.gap_to_oss_leader ?? d.gap_to_leader ?? 0;
      return gap >= minGap && score < 9.5;
    })
    .map(d => ({
      dimensionId: d.id,
      label: d.name ?? d.id,
      currentScore: d.scores?.self ?? 0,
      gapToFrontier: d.gap_to_oss_leader ?? d.gap_to_leader ?? 0,
    }))
    .sort((a, b) => b.gapToFrontier - a.gapToFrontier);

  if (opts?.maxDims) {
    eligible = eligible.slice(0, opts.maxDims);
  }

  // Profile-aware assignment: prefer member whose strength keywords match the dim;
  // fall back to round-robin index when no profile has a keyword hit.
  return eligible.map((dim, i) => ({
    ...dim,
    assignedTo: bestMemberForDim(dim.dimensionId, dim.label, memberIds, i),
  }));
}

export function buildDimGoal(dim: ScheduledDimension, projectLabel: string): string {
  return [
    `Improve the "${dim.label}" capability of ${projectLabel}.`,
    `Current score: ${dim.currentScore.toFixed(1)}/10. Gap to frontier: ${dim.gapToFrontier.toFixed(1)} points.`,
    `Implement real, production-quality improvements. No stubs, no mocks, no TODOs in src/ files.`,
    `Focus on the highest-impact changes that close the gap to best-in-class tools.`,
  ].join('\n');
}

export function groupByMember(
  scheduled: ScheduledDimension[],
): Map<CouncilMemberId, ScheduledDimension[]> {
  const groups = new Map<CouncilMemberId, ScheduledDimension[]>();
  for (const dim of scheduled) {
    const list = groups.get(dim.assignedTo) ?? [];
    list.push(dim);
    groups.set(dim.assignedTo, list);
  }
  return groups;
}

/**
 * Group scheduled dims by slotId (for slot-aware scheduling with slotsPerMember > 1).
 * Falls back to `${memberId}-0` when no assignedSlot is set.
 */
export function groupBySlot(
  scheduled: ScheduledDimension[],
): Map<string, ScheduledDimension[]> {
  const groups = new Map<string, ScheduledDimension[]>();
  for (const dim of scheduled) {
    const slotId = dim.assignedSlot?.slotId ?? `${dim.assignedTo}-0`;
    const list = groups.get(slotId) ?? [];
    list.push(dim);
    groups.set(slotId, list);
  }
  return groups;
}

/**
 * Schedule dims across slots (slot-aware; wraps `scheduleWork` with round-robin slot assignment).
 */
export async function scheduleWorkForSlots(
  slots: CouncilSlot[],
  cwd: string,
  opts?: SchedulerOptions,
): Promise<ScheduledDimension[]> {
  const memberIds = [...new Set(slots.map(s => s.memberId))];
  const dims = await scheduleWork(memberIds, cwd, opts);

  // Round-robin slot assignment weighted by slot order within member
  const slotsByMember = new Map<CouncilMemberId, CouncilSlot[]>();
  for (const slot of slots) {
    const arr = slotsByMember.get(slot.memberId) ?? [];
    arr.push(slot);
    slotsByMember.set(slot.memberId, arr);
  }
  const slotCursors = new Map<CouncilMemberId, number>(memberIds.map(id => [id, 0]));

  return dims.map(dim => {
    const memberSlots = slotsByMember.get(dim.assignedTo) ?? [];
    const cursor = slotCursors.get(dim.assignedTo) ?? 0;
    const assignedSlot = memberSlots[cursor % memberSlots.length];
    slotCursors.set(dim.assignedTo, cursor + 1);
    return { ...dim, assignedSlot };
  });
}
