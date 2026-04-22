/**
 * Structured Audit Logging for Enterprise SIEM Integration
 *
 * Provides JSONL-formatted audit logs with correlation IDs for distributed tracing.
 * Enables integration with Splunk, ELK, Datadog, and other enterprise logging platforms.
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Audit event types for categorization
 */
export type AuditEventType =
  | 'command_start'
  | 'command_end'
  | 'llm_call'
  | 'llm_response'
  | 'file_write'
  | 'file_read'
  | 'git_operation'
  | 'mcp_call'
  | 'gate_check'
  | 'error'
  | 'warning';

/**
 * Event status
 */
export type AuditStatus = 'success' | 'failure' | 'warning';

/**
 * Structured audit event following enterprise logging standards
 */
export interface AuditEvent {
  /** ISO 8601 timestamp */
  timestamp: string;

  /** Unique correlation ID for tracing multi-step workflows */
  correlationId: string;

  /** Session ID for grouping events from single CLI invocation */
  sessionId: string;

  /** Event type for filtering and categorization */
  eventType: AuditEventType;

  /** User identifier from git config */
  userId?: string;

  /** Command that triggered this event */
  command?: string;

  /** LLM provider (ollama, claude, openai, grok, gemini) */
  provider?: string;

  /** LLM model name */
  model?: string;

  /** Tokens consumed in this call */
  tokensUsed?: number;

  /** Estimated cost in USD */
  costUsd?: number;

  /** Duration in milliseconds */
  duration?: number;

  /** Event status */
  status: AuditStatus;

  /** Error code (from error-catalog.ts) */
  errorCode?: string;

  /** Error message */
  errorMessage?: string;

  /** Stack trace (only for errors) */
  stackTrace?: string;

  /** File path (for file operations) */
  filePath?: string;

  /** Git operation (clone, commit, push, etc.) */
  gitOperation?: string;

  /** MCP server name */
  mcpServer?: string;

  /** MCP tool name */
  mcpTool?: string;

  /** Gate type (constitution, spec, plan, tests, design) */
  gateType?: string;

  /** Additional structured metadata */
  metadata: Record<string, unknown>;
}

/**
 * Global session ID for current CLI invocation
 */
let currentSessionId: string = randomUUID();

/**
 * Get current session ID
 */
export function getSessionId(): string {
  return currentSessionId;
}

/**
 * Reset session ID (for testing)
 */
export function resetSessionId(): void {
  currentSessionId = randomUUID();
}

/**
 * Generate new correlation ID for operation
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Get user ID from git config or environment
 */
export function getUserId(): string | undefined {
  try {
    // Try git config first
    const { execSync } = require('node:child_process');
    const email = execSync('git config user.email', { encoding: 'utf8' }).trim();
    if (email) return email;
  } catch {
    // Fallback to environment
  }

  // Fallback to system user
  return process.env.USER || process.env.USERNAME || 'unknown';
}

/**
 * Write audit event to JSONL log file
 *
 * @param event - Audit event to log
 * @param cwd - Working directory (default: process.cwd())
 */
export function logAuditEvent(event: AuditEvent, cwd: string = process.cwd()): void {
  try {
    const auditDir = join(cwd, '.danteforge', 'audit');

    // Ensure audit directory exists
    if (!existsSync(auditDir)) {
      mkdirSync(auditDir, { recursive: true });
    }

    const logFile = join(auditDir, 'detailed.jsonl');

    // Ensure timestamp is ISO 8601
    if (!event.timestamp) {
      event.timestamp = new Date().toISOString();
    }

    // Ensure session ID is set
    if (!event.sessionId) {
      event.sessionId = currentSessionId;
    }

    // Write as single-line JSON
    const logLine = JSON.stringify(event) + '\n';
    appendFileSync(logFile, logLine, 'utf8');
  } catch (err) {
    // Best-effort logging - don't crash if audit fails
    console.error('[Audit] Failed to write audit event:', err);
  }
}

/**
 * Create audit event builder for fluent API
 */
export class AuditEventBuilder {
  private event: Partial<AuditEvent>;

  constructor(eventType: AuditEventType) {
    this.event = {
      timestamp: new Date().toISOString(),
      eventType,
      sessionId: currentSessionId,
      correlationId: generateCorrelationId(),
      status: 'success',
      metadata: {},
    };
  }

  correlationId(id: string): this {
    this.event.correlationId = id;
    return this;
  }

  userId(id: string | undefined): this {
    this.event.userId = id;
    return this;
  }

  command(cmd: string): this {
    this.event.command = cmd;
    return this;
  }

  provider(provider: string): this {
    this.event.provider = provider;
    return this;
  }

  model(model: string): this {
    this.event.model = model;
    return this;
  }

  tokens(count: number, costUsd?: number): this {
    this.event.tokensUsed = count;
    if (costUsd !== undefined) {
      this.event.costUsd = costUsd;
    }
    return this;
  }

  duration(ms: number): this {
    this.event.duration = ms;
    return this;
  }

  success(): this {
    this.event.status = 'success';
    return this;
  }

  failure(errorCode?: string, errorMessage?: string, stackTrace?: string): this {
    this.event.status = 'failure';
    if (errorCode) this.event.errorCode = errorCode;
    if (errorMessage) this.event.errorMessage = errorMessage;
    if (stackTrace) this.event.stackTrace = stackTrace;
    return this;
  }

  warning(): this {
    this.event.status = 'warning';
    return this;
  }

  filePath(path: string): this {
    this.event.filePath = path;
    return this;
  }

  gitOperation(op: string): this {
    this.event.gitOperation = op;
    return this;
  }

  mcpServer(server: string): this {
    this.event.mcpServer = server;
    return this;
  }

  mcpTool(tool: string): this {
    this.event.mcpTool = tool;
    return this;
  }

  gateType(gate: string): this {
    this.event.gateType = gate;
    return this;
  }

  metadata(key: string, value: unknown): this {
    if (!this.event.metadata) this.event.metadata = {};
    this.event.metadata[key] = value;
    return this;
  }

  metadataAll(data: Record<string, unknown>): this {
    this.event.metadata = { ...this.event.metadata, ...data };
    return this;
  }

  build(): AuditEvent {
    return this.event as AuditEvent;
  }

  log(cwd?: string): void {
    logAuditEvent(this.build(), cwd);
  }
}

/**
 * Create audit event builder
 */
export function auditEvent(eventType: AuditEventType): AuditEventBuilder {
  return new AuditEventBuilder(eventType);
}

/**
 * Log command start event
 */
export function logCommandStart(command: string, correlationId?: string, cwd?: string): string {
  const corrId = correlationId || generateCorrelationId();
  auditEvent('command_start')
    .correlationId(corrId)
    .command(command)
    .userId(getUserId())
    .log(cwd);
  return corrId;
}

/**
 * Log command end event
 */
export function logCommandEnd(
  command: string,
  correlationId: string,
  status: AuditStatus,
  duration: number,
  cwd?: string,
): void {
  const builder = auditEvent('command_end')
    .correlationId(correlationId)
    .command(command)
    .duration(duration);

  if (status === 'success') builder.success();
  else if (status === 'failure') builder.failure();
  else builder.warning();

  builder.log(cwd);
}

/**
 * Log LLM call event
 */
export function logLLMCall(
  provider: string,
  model: string,
  correlationId: string,
  tokensUsed?: number,
  costUsd?: number,
  duration?: number,
  cwd?: string,
): void {
  const builder = auditEvent('llm_call')
    .correlationId(correlationId)
    .provider(provider)
    .model(model);

  if (tokensUsed !== undefined) builder.tokens(tokensUsed, costUsd);
  if (duration !== undefined) builder.duration(duration);

  builder.log(cwd);
}

/**
 * Log file write event
 */
export function logFileWrite(
  filePath: string,
  correlationId: string,
  status: AuditStatus = 'success',
  cwd?: string,
): void {
  const builder = auditEvent('file_write')
    .correlationId(correlationId)
    .filePath(filePath);

  if (status === 'success') builder.success();
  else if (status === 'failure') builder.failure();
  else builder.warning();

  builder.log(cwd);
}

/**
 * Log git operation event
 */
export function logGitOperation(
  operation: string,
  correlationId: string,
  status: AuditStatus = 'success',
  cwd?: string,
): void {
  const builder = auditEvent('git_operation')
    .correlationId(correlationId)
    .gitOperation(operation);

  if (status === 'success') builder.success();
  else if (status === 'failure') builder.failure();
  else builder.warning();

  builder.log(cwd);
}

/**
 * Log MCP call event
 */
export function logMCPCall(
  server: string,
  tool: string,
  correlationId: string,
  duration?: number,
  status: AuditStatus = 'success',
  cwd?: string,
): void {
  const builder = auditEvent('mcp_call')
    .correlationId(correlationId)
    .mcpServer(server)
    .mcpTool(tool);

  if (duration !== undefined) builder.duration(duration);
  if (status === 'success') builder.success();
  else if (status === 'failure') builder.failure();
  else builder.warning();

  builder.log(cwd);
}

/**
 * Log gate check event
 */
export function logGateCheck(
  gateType: string,
  correlationId: string,
  passed: boolean,
  cwd?: string,
): void {
  const builder = auditEvent('gate_check')
    .correlationId(correlationId)
    .gateType(gateType);

  if (passed) builder.success();
  else builder.failure();

  builder.log(cwd);
}

/**
 * Log error event
 */
export function logError(
  errorCode: string,
  errorMessage: string,
  correlationId: string,
  stackTrace?: string,
  cwd?: string,
): void {
  auditEvent('error')
    .correlationId(correlationId)
    .failure(errorCode, errorMessage, stackTrace)
    .log(cwd);
}
