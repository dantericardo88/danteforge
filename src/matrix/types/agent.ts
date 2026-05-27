// Matrix Kernel — Agent types: runs + mailbox (PRD §14, §15, §18)

export type AgentRunStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'awaiting_input'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export interface AgentRunHandle {
  runId: string;
  leaseId: string;
  provider: string;
  pid?: number;                  // process ID for shell-style adapters
  startedAt: string;
}

export type AgentRunEventKind =
  | 'started'
  | 'progress'
  | 'tool_invocation'
  | 'message_emitted'
  | 'file_changed'
  | 'command_executed'
  | 'awaiting_input'
  | 'completed'
  | 'failed';

export interface AgentRunEvent {
  eventId: string;
  runId: string;
  ts: string;
  kind: AgentRunEventKind;
  payload?: Record<string, unknown>;
}

export interface AgentRunResult {
  runId: string;
  leaseId: string;
  status: AgentRunStatus;
  filesChanged: string[];
  commandsExecuted: { command: string; exitCode: number; durationMs: number }[];
  tokensConsumed?: number;
  finalMessage?: string;
  errorReason?: string;
  startedAt: string;
  completedAt: string;
  /** Path to the branch's commit SHA after the run, if available. */
  branchSha?: string;
  /** Provider id for the dispatched adapter (e.g. 'ollama', 'claude'). */
  provider?: string;
  /** Events streamed by the adapter, captured for persistence. */
  events?: AgentRunEvent[];
  /** Raw text output from the agent run (for research/ask phases). */
  output?: string;
}

// ── Structured Mailbox (PRD §15) ────────────────────────────────────────────

export type MailboxMessageType =
  | 'dependency_notice'
  | 'interface_changed'
  | 'blocked_by_dependency'
  | 'request_read_context'
  | 'request_write_scope_expansion'
  | 'conflict_detected'
  | 'repair_needed'
  | 'merge_ready'
  | 'regression_detected'
  | 'human_decision_required'
  | 'taste_gate_required'
  | 'red_team_failed';

export interface AgentMailboxMessage {
  messageId: string;
  type: MailboxMessageType;
  fromLease: string;             // lease ID; may be 'system' or 'human'
  toLease: string;               // lease ID; may be 'system' or 'broadcast'
  summary: string;
  impact?: 'informational' | 'consumer_update_required' | 'blocking';
  requiresAck: boolean;
  status: 'pending_ack' | 'acked' | 'rejected' | 'expired';
  createdAt: string;
  ackedAt?: string;
  metadata?: Record<string, unknown>;
}

// ── Validation ──────────────────────────────────────────────────────────────

const STATUSES: readonly AgentRunStatus[] = [
  'pending', 'starting', 'running', 'awaiting_input',
  'completed', 'failed', 'timed_out', 'cancelled',
];

export function isAgentRunStatus(v: unknown): v is AgentRunStatus {
  return typeof v === 'string' && STATUSES.includes(v as AgentRunStatus);
}

export function isAgentRunResult(value: unknown): value is AgentRunResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.runId === 'string'
    && typeof v.leaseId === 'string'
    && isAgentRunStatus(v.status)
    && Array.isArray(v.filesChanged);
}

export function isMailboxMessage(value: unknown): value is AgentMailboxMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.messageId === 'string'
    && typeof v.type === 'string'
    && typeof v.fromLease === 'string'
    && typeof v.toLease === 'string'
    && typeof v.summary === 'string'
    && typeof v.requiresAck === 'boolean';
}
