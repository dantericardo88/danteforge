// Matrix Kernel — Mailbox CLI handlers (post / poll / list)
//
// Thin wrappers around `src/matrix/engines/mailbox.ts` that surface the
// inter-agent coordination bus to the command line. Used by host AIs in
// embedded mode and by parallel agents running across multiple terminals.

import { logger } from '../../core/logger.js';
import type { AgentMailboxMessage, MailboxMessageType } from '../../matrix/types/agent.js';

const VALID_TYPES: readonly MailboxMessageType[] = [
  'dependency_notice',
  'interface_changed',
  'blocked_by_dependency',
  'request_read_context',
  'request_write_scope_expansion',
  'conflict_detected',
  'repair_needed',
  'merge_ready',
  'regression_detected',
  'human_decision_required',
  'taste_gate_required',
  'red_team_failed',
];

const VALID_IMPACTS: readonly AgentMailboxMessage['impact'][] = [
  'informational',
  'consumer_update_required',
  'blocking',
];

export interface MailboxPostOptions {
  cwd?: string;
  from: string;
  to: string;
  type: string;
  summary: string;
  impact?: string;
  requiresAck?: boolean;
}

export async function mailboxPost(opts: MailboxPostOptions): Promise<AgentMailboxMessage> {
  const { appendMessage, writeMailboxIndex } = await import('../../matrix/engines/mailbox.js');
  if (!isValidType(opts.type)) {
    throw new Error(`Invalid --type "${opts.type}". Valid: ${VALID_TYPES.join(', ')}`);
  }
  if (opts.impact && !isValidImpact(opts.impact)) {
    throw new Error(`Invalid --impact "${opts.impact}". Valid: ${VALID_IMPACTS.join(', ')}`);
  }
  const cwd = opts.cwd ?? process.cwd();
  const msg = await appendMessage({
    cwd,
    type: opts.type,
    fromLease: opts.from,
    toLease: opts.to,
    summary: opts.summary,
    impact: (opts.impact ?? 'informational') as AgentMailboxMessage['impact'],
    requiresAck: !!opts.requiresAck,
  });
  await writeMailboxIndex(cwd);
  logger.success(`[mailbox] Posted ${msg.messageId} (${msg.type}, ${msg.impact ?? 'informational'})`);
  return msg;
}

export interface MailboxPollOptions {
  cwd?: string;
  lease?: string;
  timeoutMs?: number;
  types?: string;
  _sleep?: (ms: number) => Promise<void>;
}

export async function mailboxPoll(opts: MailboxPollOptions): Promise<AgentMailboxMessage[]> {
  const { getPending } = await import('../../matrix/engines/mailbox.js');
  const cwd = opts.cwd ?? process.cwd();
  const timeoutMs = opts.timeoutMs ?? 5000;
  const sleep = opts._sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  const typeFilter = opts.types ? new Set(opts.types.split(',').map(s => s.trim())) : null;

  const deadline = Date.now() + timeoutMs;
  while (true) {
    const all = await getPending(cwd, opts.lease);
    const filtered = typeFilter ? all.filter(m => typeFilter.has(m.type)) : all;
    if (filtered.length > 0 || Date.now() >= deadline) {
      logger.info(`[mailbox] ${filtered.length} pending message(s)${opts.lease ? ` for lease ${opts.lease}` : ''}`);
      for (const m of filtered) {
        logger.info(`  ${m.messageId}  ${m.type}  ${m.fromLease} → ${m.toLease}  ${m.summary}`);
      }
      return filtered;
    }
    // Sleep before the next poll — short enough to feel responsive, long
    // enough to avoid hammering the filesystem.
    await sleep(Math.min(300, Math.max(50, deadline - Date.now())));
  }
}

export interface MailboxListOptions {
  cwd?: string;
  status?: string;
}

export async function mailboxList(opts: MailboxListOptions): Promise<AgentMailboxMessage[]> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const cwd = opts.cwd ?? process.cwd();
  const dir = path.join(cwd, '.danteforge', 'matrix', 'mailbox');
  let names: string[];
  try { names = await fs.readdir(dir); } catch { names = []; }
  const messages: AgentMailboxMessage[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), 'utf8');
      const msg = JSON.parse(raw) as AgentMailboxMessage;
      if (opts.status && msg.status !== opts.status) continue;
      messages.push(msg);
    } catch { /* skip unreadable */ }
  }
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  logger.info(`[mailbox] ${messages.length} message(s)${opts.status ? ` with status=${opts.status}` : ''}`);
  for (const m of messages) {
    const ackBadge = m.requiresAck ? ' [ack-required]' : '';
    logger.info(`  ${m.createdAt}  ${m.status}  ${m.type}  ${m.fromLease} → ${m.toLease}${ackBadge}`);
    logger.info(`    ${m.summary}`);
  }
  return messages;
}

function isValidType(t: string): t is MailboxMessageType {
  return (VALID_TYPES as readonly string[]).includes(t);
}

function isValidImpact(i: string): i is NonNullable<AgentMailboxMessage['impact']> {
  return (VALID_IMPACTS as readonly (string | undefined)[]).includes(i);
}
