// Loop Detector — detects planning loops and action loops in agent execution
// Harvested from: Reflection-3.ts (OpenCode plugin) — planning loop + action loop detection

import type { ExecutionTelemetry } from './execution-telemetry.js';

// --- Constants (from Reflection-3.ts) ----------------------------------------

const PLANNING_LOOP_MIN_TOOL_CALLS = 8;
const PLANNING_LOOP_WRITE_RATIO_THRESHOLD = 0.1;
const ACTION_LOOP_MIN_COMMANDS = 4;
const ACTION_LOOP_REPETITION_THRESHOLD = 0.6;
const ACTION_LOOP_MIN_REPEATS = 3;

// --- Types -------------------------------------------------------------------

export type LoopType = 'planning' | 'action' | 'none';
export type LoopSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface LoopDetectionResult {
  detected: boolean;
  type: LoopType;
  evidence: string;
  severity: LoopSeverity;
}

const NO_LOOP: LoopDetectionResult = {
  detected: false,
  type: 'none',
  evidence: '',
  severity: 'LOW',
};

// --- Planning Loop Detection -------------------------------------------------
// From Reflection-3.ts: Agent is stuck in read-only mode (many tool calls, few writes)
// Triggers when: totalTools >= 8 AND writeCount/totalTools < 0.1

export function detectPlanningLoop(telemetry: ExecutionTelemetry): LoopDetectionResult {
  const total = telemetry.toolCalls.length;
  if (total < PLANNING_LOOP_MIN_TOOL_CALLS) return NO_LOOP;

  const writes = telemetry.toolCalls.filter(tc => tc.isWrite).length;
  const writeRatio = total > 0 ? writes / total : 0;

  if (writes === 0 || writeRatio < PLANNING_LOOP_WRITE_RATIO_THRESHOLD) {
    const severity: LoopSeverity = writes === 0 ? 'HIGH' : 'MEDIUM';
    return {
      detected: true,
      type: 'planning',
      evidence: `${total} tool calls but only ${writes} writes (ratio: ${writeRatio.toFixed(2)}). Agent is reading without acting.`,
      severity,
    };
  }

  return NO_LOOP;
}

// --- Action Loop Detection ---------------------------------------------------
// From Reflection-3.ts: Agent is repeating the same failing commands
// Triggers when: any command repeated >=3x AND repeated >=60% of total

function normalizeCommand(cmd: string): string {
  return cmd
    .replace(/\s+/g, ' ')
    .replace(/\d{10,}/g, '<timestamp>')
    .replace(/\/tmp\/[^\s]+/g, '<tmpfile>')
    .trim()
    .toLowerCase();
}

export function detectActionLoop(telemetry: ExecutionTelemetry): LoopDetectionResult {
  const commands = telemetry.bashCommands;
  if (commands.length < ACTION_LOOP_MIN_COMMANDS) return NO_LOOP;

  const normalized = commands.map(normalizeCommand);
  const counts = new Map<string, number>();

  for (const cmd of normalized) {
    counts.set(cmd, (counts.get(cmd) ?? 0) + 1);
  }

  let totalRepeated = 0;
  let mostRepeated = '';
  let mostRepeatedCount = 0;

  for (const [cmd, count] of counts) {
    if (count >= ACTION_LOOP_MIN_REPEATS) {
      totalRepeated += count;
      if (count > mostRepeatedCount) {
        mostRepeated = cmd;
        mostRepeatedCount = count;
      }
    }
  }

  const repetitionRatio = commands.length > 0 ? totalRepeated / commands.length : 0;

  if (mostRepeatedCount >= ACTION_LOOP_MIN_REPEATS && repetitionRatio >= ACTION_LOOP_REPETITION_THRESHOLD) {
    return {
      detected: true,
      type: 'action',
      evidence: `Command "${mostRepeated}" repeated ${mostRepeatedCount}x out of ${commands.length} total (${(repetitionRatio * 100).toFixed(0)}% repetition).`,
      severity: repetitionRatio > 0.8 ? 'HIGH' : 'MEDIUM',
    };
  }

  return NO_LOOP;
}

// --- Combined Detector -------------------------------------------------------

export function detectLoop(telemetry: ExecutionTelemetry): LoopDetectionResult {
  const planning = detectPlanningLoop(telemetry);
  const action = detectActionLoop(telemetry);

  // Return the more severe result
  if (!planning.detected && !action.detected) return NO_LOOP;
  if (!planning.detected) return action;
  if (!action.detected) return planning;

  const severityOrder: Record<LoopSeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  return severityOrder[action.severity] >= severityOrder[planning.severity] ? action : planning;
}
