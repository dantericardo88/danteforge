// Execution telemetry — captures tool calls, commands, and file mutations during agent execution
// Harvested from Reflection-3.ts (OpenCode plugin) — adapted for DanteForge's wave executor

export interface ToolCallEntry {
  name: string;
  timestamp: number;
  isWrite: boolean;
}

export interface ExecutionTelemetry {
  toolCalls: ToolCallEntry[];
  bashCommands: string[];
  filesModified: string[];
  duration: number;
  tokenEstimate: number;
}

const WRITE_TOOL_PATTERNS = /^(edit|write|apply_patch|create|delete|mv|cp|rename)/i;
const WRITE_BASH_PATTERNS = /\b(git\s+(commit|push|merge|rebase|cherry-pick)|npm\s+(publish|run\s+build)|tsc|tsup|rm\s|mv\s|cp\s)\b/;

export function createTelemetry(): ExecutionTelemetry {
  return {
    toolCalls: [],
    bashCommands: [],
    filesModified: [],
    duration: 0,
    tokenEstimate: 0,
  };
}

export function recordToolCall(t: ExecutionTelemetry, name: string, isWrite?: boolean): void {
  const classified = isWrite ?? WRITE_TOOL_PATTERNS.test(name);
  t.toolCalls.push({ name, timestamp: Date.now(), isWrite: classified });
}

export function recordBashCommand(t: ExecutionTelemetry, cmd: string): void {
  t.bashCommands.push(cmd);
  if (WRITE_BASH_PATTERNS.test(cmd)) {
    t.toolCalls.push({ name: `bash:${cmd.slice(0, 40)}`, timestamp: Date.now(), isWrite: true });
  }
}

export function recordFileModified(t: ExecutionTelemetry, filePath: string): void {
  if (!t.filesModified.includes(filePath)) {
    t.filesModified.push(filePath);
  }
}

export function summarizeTelemetry(t: ExecutionTelemetry): string {
  const reads = t.toolCalls.filter(tc => !tc.isWrite).length;
  const writes = t.toolCalls.filter(tc => tc.isWrite).length;
  const lines: string[] = [
    `Duration: ${(t.duration / 1000).toFixed(1)}s`,
    `Tool calls: ${t.toolCalls.length} (${reads} reads, ${writes} writes)`,
    `Bash commands: ${t.bashCommands.length}`,
    `Files modified: ${t.filesModified.length}`,
  ];
  if (t.tokenEstimate > 0) {
    lines.push(`Token estimate: ~${t.tokenEstimate.toLocaleString()}`);
  }
  return lines.join('\n');
}
