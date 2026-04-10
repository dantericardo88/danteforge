// Workspace management — multi-user foundation for DanteForge
// v0.10.0: identity is os.userInfo().username (not cryptographically verified)
// v0.11.0 will add OAuth / signed tokens

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { LLMProvider } from './config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkspaceRole = 'owner' | 'editor' | 'reviewer';

export interface WorkspaceMember {
  id: string;          // os.userInfo().username or DANTEFORGE_USER env var
  role: WorkspaceRole;
  addedAt: string;     // ISO timestamp
}

export interface WorkspaceConfig {
  id: string;          // URL-safe slug, e.g. "myteam"
  name: string;        // display name
  members: WorkspaceMember[];
  defaultProvider?: LLMProvider;
  providers?: Partial<Record<string, { apiKey?: string }>>;
  createdAt: string;
  signingKeySalt?: string;  // 32 hex chars, generated at workspace creation
  revokedTokens?: string[]; // nonces of revoked tokens — checked by verifyWorkspaceToken
}

// ── Injection seams (for testing) ─────────────────────────────────────────────

export interface WorkspaceOps {
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _mkdir?: (p: string, opts?: { recursive: boolean }) => Promise<void>;
  _homedir?: () => string;
  _randomBytes?: (n: number) => Buffer;
  _now?: () => number;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getCurrentUserId(): string {
  return process.env['DANTEFORGE_USER'] ?? os.userInfo().username ?? 'unknown';
}

export function getWorkspaceDir(workspaceId: string, ops?: WorkspaceOps): string {
  const home = ops?._homedir?.() ?? os.homedir();
  return path.join(home, '.danteforge', 'workspaces', workspaceId);
}

export function getWorkspaceConfigPath(workspaceId: string, ops?: WorkspaceOps): string {
  return path.join(getWorkspaceDir(workspaceId, ops), 'config.yaml');
}

export async function loadWorkspace(workspaceId: string, ops?: WorkspaceOps): Promise<WorkspaceConfig | null> {
  const configPath = getWorkspaceConfigPath(workspaceId, ops);
  try {
    const content = ops?._readFile
      ? await ops._readFile(configPath)
      : await fs.readFile(configPath, 'utf-8');
    return yaml.parse(content) as WorkspaceConfig;
  } catch {
    return null;
  }
}

export async function saveWorkspace(ws: WorkspaceConfig, ops?: WorkspaceOps): Promise<void> {
  const configPath = getWorkspaceConfigPath(ws.id, ops);
  const dir = path.dirname(configPath);
  if (ops?._mkdir) {
    await ops._mkdir(dir, { recursive: true });
  } else {
    await fs.mkdir(dir, { recursive: true });
  }
  const content = yaml.stringify(ws);
  if (ops?._writeFile) {
    await ops._writeFile(configPath, content);
  } else {
    await fs.writeFile(configPath, content, { encoding: 'utf-8', mode: 0o600 });
  }
}

export async function createWorkspace(name: string, ops?: WorkspaceOps): Promise<WorkspaceConfig> {
  const id = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  const saltFn = ops?._randomBytes ?? randomBytes;
  const signingKeySalt = saltFn(16).toString('hex');
  const ws: WorkspaceConfig = {
    id,
    name,
    members: [{ id: getCurrentUserId(), role: 'owner', addedAt: new Date().toISOString() }],
    createdAt: new Date().toISOString(),
    signingKeySalt,
  };
  await saveWorkspace(ws, ops);
  return ws;
}

export function hasRole(ws: WorkspaceConfig, userId: string, minRole: WorkspaceRole): boolean {
  const roleOrder: Record<WorkspaceRole, number> = { reviewer: 0, editor: 1, owner: 2 };
  const member = ws.members.find((m) => m.id === userId);
  if (!member) return false;
  return roleOrder[member.role] >= roleOrder[minRole];
}

export async function addMember(
  workspaceId: string,
  member: WorkspaceMember,
  ops?: WorkspaceOps,
): Promise<WorkspaceConfig> {
  const ws = await loadWorkspace(workspaceId, ops);
  if (!ws) throw new Error(`Workspace '${workspaceId}' not found`);
  // Replace if already exists, add if new
  const idx = ws.members.findIndex((m) => m.id === member.id);
  if (idx >= 0) {
    ws.members[idx] = member;
  } else {
    ws.members.push(member);
  }
  await saveWorkspace(ws, ops);
  return ws;
}

export async function getActiveWorkspaceId(): Promise<string | null> {
  return process.env['DANTEFORGE_WORKSPACE'] ?? null;
}

// ── Signed Workspace Tokens ───────────────────────────────────────────────────

export interface WorkspaceTokenPayload {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

function deriveSigningKey(ws: WorkspaceConfig): string {
  return `${ws.id}:${ws.createdAt}:${ws.signingKeySalt ?? ''}`;
}

export function issueWorkspaceToken(
  ws: WorkspaceConfig,
  userId: string,
  role: WorkspaceRole,
  ops?: WorkspaceOps,
): string {
  const now = ops?._now?.() ?? Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const saltFn = ops?._randomBytes ?? randomBytes;
  const nonce = saltFn(16).toString('hex');
  const payload: WorkspaceTokenPayload = {
    userId,
    workspaceId: ws.id,
    role,
    issuedAt: now,
    expiresAt: now + sevenDaysMs,
    nonce,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingKey = deriveSigningKey(ws);
  const hmac = createHmac('sha256', signingKey).update(payloadB64).digest('hex');
  return `${payloadB64}.${hmac}`;
}

export function verifyWorkspaceToken(
  token: string,
  ws: WorkspaceConfig,
  expectedUserId: string,
  ops?: WorkspaceOps,
): WorkspaceTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, providedHmac] = parts;

  const signingKey = deriveSigningKey(ws);
  const expectedHmac = createHmac('sha256', signingKey).update(payloadB64).digest('hex');

  // Timing-safe comparison
  const expectedBuf = Buffer.from(expectedHmac, 'utf-8');
  const actualBuf = Buffer.from(providedHmac, 'utf-8');
  if (expectedBuf.length !== actualBuf.length) return null;
  try {
    if (!timingSafeEqual(expectedBuf, actualBuf)) return null;
  } catch {
    return null;
  }

  let payload: WorkspaceTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as WorkspaceTokenPayload;
  } catch {
    return null;
  }

  const now = ops?._now?.() ?? Date.now();
  if (payload.expiresAt < now) return null;
  if (payload.userId !== expectedUserId) return null;

  // Check revocation list
  if (ws.revokedTokens?.includes(payload.nonce)) return null;

  return payload;
}

/**
 * Revoke a workspace token by its nonce. Adds nonce to the workspace config's
 * revocation list and persists. Subsequent verifyWorkspaceToken calls will
 * reject the token.
 */
export async function revokeWorkspaceToken(
  workspaceId: string,
  tokenNonce: string,
  ops?: WorkspaceOps,
): Promise<void> {
  const ws = await loadWorkspace(workspaceId, ops);
  if (!ws) throw new Error(`Workspace '${workspaceId}' not found`);
  if (!ws.revokedTokens) {
    ws.revokedTokens = [];
  }
  if (!ws.revokedTokens.includes(tokenNonce)) {
    ws.revokedTokens.push(tokenNonce);
  }
  await saveWorkspace(ws, ops);
}

export async function saveWorkspaceToken(
  workspaceId: string,
  userId: string,
  token: string,
  ops?: WorkspaceOps,
): Promise<void> {
  const dir = path.join(getWorkspaceDir(workspaceId, ops), 'tokens');
  const tokenPath = path.join(dir, `${userId}.token`);
  if (ops?._mkdir) {
    await ops._mkdir(dir, { recursive: true });
  } else {
    await import('node:fs/promises').then(fsMod => fsMod.mkdir(dir, { recursive: true }));
  }
  if (ops?._writeFile) {
    await ops._writeFile(tokenPath, token);
  } else {
    await import('node:fs/promises').then(fsMod => fsMod.writeFile(tokenPath, token, { encoding: 'utf-8', mode: 0o600 }));
  }
}

export async function loadWorkspaceToken(
  workspaceId: string,
  userId: string,
  ops?: WorkspaceOps,
): Promise<string | null> {
  const tokenPath = path.join(getWorkspaceDir(workspaceId, ops), 'tokens', `${userId}.token`);
  try {
    const content = ops?._readFile
      ? await ops._readFile(tokenPath)
      : await import('node:fs/promises').then(fsMod => fsMod.readFile(tokenPath, 'utf-8'));
    return content.trim();
  } catch {
    return null;
  }
}
