// Matrix Kernel — Structured Agent Mailbox (Phase 8 of PRD)
//
// Persistent, lease-aware message routing for parallel agents. Messages are
// stored as JSON files under .danteforge/matrix/mailbox/.
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentMailboxMessage,
  MailboxMessageType,
} from '../types/agent.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

const MAILBOX_DIR = `${MATRIX_DIR}/mailbox`;

export interface AppendMessageOptions {
  cwd?: string;
  type: MailboxMessageType;
  fromLease: string;
  toLease: string;
  summary: string;
  impact?: AgentMailboxMessage['impact'];
  requiresAck?: boolean;
  metadata?: Record<string, unknown>;
  _now?: () => string;
}

/** Persist a new mailbox message. Returns the appended message. */
export async function appendMessage(
  options: AppendMessageOptions,
): Promise<AgentMailboxMessage> {
  const cwd = options.cwd ?? process.cwd();
  const now = options._now ?? (() => new Date().toISOString());
  const messageId = `msg.${options.fromLease}.${stamp(now())}.${Math.floor(Math.random() * 9999)}`;
  const message: AgentMailboxMessage = {
    messageId,
    type: options.type,
    fromLease: options.fromLease,
    toLease: options.toLease,
    summary: options.summary,
    impact: options.impact ?? 'informational',
    requiresAck: options.requiresAck ?? false,
    status: 'pending_ack',
    createdAt: now(),
    metadata: options.metadata,
  };

  const dir = path.join(cwd, MAILBOX_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${messageId}.json`), JSON.stringify(message, null, 2), 'utf8');

  return message;
}

export async function getPending(cwd: string, leaseId?: string): Promise<AgentMailboxMessage[]> {
  const dir = path.join(cwd, MAILBOX_DIR);
  let names: string[];
  try { names = await fs.readdir(dir); } catch { return []; }
  const messages: AgentMailboxMessage[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), 'utf8');
      const msg = JSON.parse(raw) as AgentMailboxMessage;
      if (msg.status !== 'pending_ack') continue;
      if (leaseId && msg.toLease !== leaseId && msg.toLease !== 'broadcast') continue;
      messages.push(msg);
    } catch { /* skip unreadable */ }
  }
  return messages;
}

export async function ackMessage(
  cwd: string,
  messageId: string,
  status: 'acked' | 'rejected' = 'acked',
): Promise<AgentMailboxMessage | null> {
  const filePath = path.join(cwd, MAILBOX_DIR, `${messageId}.json`);
  let msg: AgentMailboxMessage;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    msg = JSON.parse(raw) as AgentMailboxMessage;
  } catch {
    return null;
  }
  msg.status = status;
  msg.ackedAt = new Date().toISOString();
  await fs.writeFile(filePath, JSON.stringify(msg, null, 2), 'utf8');
  return msg;
}

export async function writeMailboxIndex(cwd?: string): Promise<string> {
  const root = cwd ?? process.cwd();
  const dir = path.join(root, MAILBOX_DIR);
  let names: string[];
  try { names = await fs.readdir(dir); } catch { names = []; }
  const messages: AgentMailboxMessage[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), 'utf8');
      messages.push(JSON.parse(raw) as AgentMailboxMessage);
    } catch { /* skip */ }
  }
  const outPath = path.join(root, MATRIX_REPORT_PATHS.mailbox);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), messages }, null, 2), 'utf8');
  return outPath;
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, '-').slice(0, 19);
}
