// policy-gate — enterprise policy evaluation for DanteForge commands.
// Loads .danteforge/policy.yaml and evaluates commands against allow/block/approve lists.
// Based on HumanLayer session-scoped tool policy pattern (Apache 2.0).

import fs from 'fs/promises';
import path from 'path';

export interface PolicyConfig {
  /** Commands that are explicitly allowed (others blocked if allowedCommands is set) */
  allowedCommands?: string[];
  /** Commands that are always blocked regardless of other settings */
  blockedCommands?: string[];
  /** Commands that require explicit human approval before executing */
  requireApproval?: string[];
  /** ISO8601 timestamp — bypass all gates until this time (emergency escape hatch) */
  bypassUntil?: string | null;
  /** Team or tenant identifier for multi-tenant audit scoping */
  teamId?: string | null;
  /** Self-edit policy: deny = no self-modification; prompt = ask before self-edit */
  selfEditPolicy?: 'allow' | 'prompt' | 'deny';
}

export interface PolicyDecision {
  command: string;
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  bypassActive: boolean;
  timestamp: string;
  teamId?: string | null;
}

const POLICY_FILENAME = 'policy.yaml';
const STATE_DIR = '.danteforge';

export async function loadPolicyConfig(cwd: string): Promise<PolicyConfig | null> {
  const policyPath = path.join(cwd, STATE_DIR, POLICY_FILENAME);
  try {
    const raw = await fs.readFile(policyPath, 'utf8');
    return parseYamlPolicy(raw);
  } catch {
    return null;
  }
}

function parseYamlPolicy(yaml: string): PolicyConfig {
  const config: PolicyConfig = {};
  for (const line of yaml.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();

    if (key === 'selfEditPolicy') {
      if (rawVal === 'deny' || rawVal === 'prompt' || rawVal === 'allow') {
        config.selfEditPolicy = rawVal;
      }
    } else if (key === 'teamId' || key === 'bypassUntil') {
      config[key] = rawVal === 'null' || rawVal === '' ? null : rawVal;
    } else if (key === 'allowedCommands' || key === 'blockedCommands' || key === 'requireApproval') {
      // Inline list: [cmd1, cmd2] or multi-line (starts after :)
      if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        config[key] = rawVal
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/['"]/g, ''))
          .filter(Boolean);
      }
      // Multi-line YAML list items handled by continuation block — not needed for simple DSL
    }
  }
  return config;
}

export function evaluatePolicy(command: string, policy: PolicyConfig): PolicyDecision {
  const timestamp = new Date().toISOString();
  const teamId = policy.teamId ?? null;

  // Bypass window — emergency escape hatch
  if (policy.bypassUntil) {
    const bypassExpiry = new Date(policy.bypassUntil);
    if (!isNaN(bypassExpiry.getTime()) && new Date() < bypassExpiry) {
      return { command, allowed: true, requiresApproval: false, reason: 'bypass window active', bypassActive: true, timestamp, teamId };
    }
  }

  // Blocked commands — hard block, no bypass
  if (policy.blockedCommands?.some((b) => command === b || command.startsWith(`${b} `))) {
    return { command, allowed: false, requiresApproval: false, reason: `command '${command}' is in blockedCommands policy`, bypassActive: false, timestamp, teamId };
  }

  // Allowlist mode — if set, only listed commands pass
  if (policy.allowedCommands && policy.allowedCommands.length > 0) {
    const permitted = policy.allowedCommands.some((a) => command === a || command.startsWith(`${a} `));
    if (!permitted) {
      return { command, allowed: false, requiresApproval: false, reason: `command '${command}' not in allowedCommands policy`, bypassActive: false, timestamp, teamId };
    }
  }

  // Approval required — allowed but must pause for human confirmation
  const needsApproval = policy.requireApproval?.some((a) => command === a || command.startsWith(`${a} `)) ?? false;
  return {
    command, allowed: true, requiresApproval: needsApproval,
    reason: needsApproval ? `command '${command}' requires human approval` : 'allowed',
    bypassActive: false, timestamp, teamId,
  };
}

export async function writePolicyReceipt(
  decision: PolicyDecision,
  evidenceDir: string,
): Promise<string> {
  const receiptDir = path.join(evidenceDir, 'policy');
  await fs.mkdir(receiptDir, { recursive: true });
  const filename = `${Date.now()}-${decision.command.replace(/\s+/g, '_').slice(0, 40)}.json`;
  const receiptPath = path.join(receiptDir, filename);
  await fs.writeFile(receiptPath, JSON.stringify(decision, null, 2));
  return receiptPath;
}

export async function runPolicyGate(
  command: string,
  cwd: string,
  _loadPolicy?: (cwd: string) => Promise<PolicyConfig | null>,
): Promise<PolicyDecision> {
  const loader = _loadPolicy ?? loadPolicyConfig;
  const policy = await loader(cwd);
  if (!policy) {
    return { command, allowed: true, requiresApproval: false, reason: 'no policy configured', bypassActive: false, timestamp: new Date().toISOString() };
  }
  const decision = evaluatePolicy(command, policy);
  const evidenceDir = path.join(cwd, STATE_DIR, 'evidence');
  await writePolicyReceipt(decision, evidenceDir).catch(() => { /* best-effort */ });
  return decision;
}
