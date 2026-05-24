// workspace-rbac.ts — Role-Based Access Control enforcement for DanteForge commands.
// Roles are read from .danteforge/workspace.yaml (project-local config file).
// Pure policy table + three enforcement functions. No UI, no process.exit.

import path from 'path';
import yaml from 'yaml';

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkspaceRole = 'owner' | 'editor' | 'reviewer';

export interface RbacPolicy {
  command: string;
  allowedRoles: WorkspaceRole[];
}

// ── Policy table ──────────────────────────────────────────────────────────────

/**
 * Canonical RBAC policy table.  Every entry lists the minimum set of roles
 * that may execute the named command.  Commands not listed here are
 * unrestricted (all authenticated roles may run them).
 */
export const RBAC_POLICIES: RbacPolicy[] = [
  { command: 'forge',   allowedRoles: ['owner', 'editor'] },
  { command: 'magic',   allowedRoles: ['owner', 'editor'] },
  { command: 'inferno', allowedRoles: ['owner', 'editor'] },
  { command: 'party',   allowedRoles: ['owner', 'editor'] },
  { command: 'ship',    allowedRoles: ['owner'] },
  { command: 'config',  allowedRoles: ['owner'] },
  { command: 'reset',   allowedRoles: ['owner'] },
  { command: 'compete', allowedRoles: ['owner', 'editor'] },
  { command: 'ascend',  allowedRoles: ['owner', 'editor'] },
  { command: 'verify',  allowedRoles: ['owner', 'editor', 'reviewer'] },
  { command: 'assess',  allowedRoles: ['owner', 'editor', 'reviewer'] },
  { command: 'score',   allowedRoles: ['owner', 'editor', 'reviewer'] },
];

// ── Role ordering (higher = more privileged) ──────────────────────────────────

const ROLE_ORDER: Record<WorkspaceRole, number> = {
  reviewer: 0,
  editor:   1,
  owner:    2,
};

// ── Workspace.yaml shape (minimal subset we need) ─────────────────────────────

interface WorkspaceYaml {
  role?: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read the current user's role from `.danteforge/workspace.yaml` in the given
 * project directory.  Returns null when the file is absent or has no `role:`
 * field (i.e. single-user / no workspace configured).
 *
 * @param cwd         Project root (defaults to process.cwd())
 * @param _readConfig Injection seam for tests — reads a file and returns its
 *                    contents (or null when the file does not exist).
 */
export async function getRoleForUser(
  cwd: string = process.cwd(),
  _readConfig?: (filePath: string) => Promise<string | null>,
): Promise<WorkspaceRole | null> {
  const workspaceYamlPath = path.join(cwd, '.danteforge', 'workspace.yaml');

  let raw: string | null;
  if (_readConfig) {
    raw = await _readConfig(workspaceYamlPath);
  } else {
    try {
      const { readFile } = await import('fs/promises');
      raw = await readFile(workspaceYamlPath, 'utf-8');
    } catch {
      return null;
    }
  }

  if (!raw) return null;

  let parsed: WorkspaceYaml;
  try {
    parsed = yaml.parse(raw) as WorkspaceYaml;
  } catch {
    return null;
  }

  const role = parsed?.role;
  if (role === 'owner' || role === 'editor' || role === 'reviewer') {
    return role;
  }
  return null;
}

/**
 * Check whether the given role is permitted to run `command`.
 *
 * Returns true when:
 *   - The command has no explicit policy (unrestricted).
 *   - The role appears in the command's `allowedRoles` list.
 *
 * Returns false when the command is policy-restricted and the role is not
 * in the allowed set.
 */
export function checkRbacAllowed(command: string, role: WorkspaceRole): boolean {
  const policy = RBAC_POLICIES.find(p => p.command === command);
  if (!policy) return true; // no restriction
  return policy.allowedRoles.includes(role);
}

/**
 * Assert that `role` may run `command`.  Throws a descriptive Error if the
 * check fails; returns void on success.
 *
 * Commands with no policy entry are always allowed.
 */
export function assertRbacAllowed(command: string, role: WorkspaceRole): void {
  if (checkRbacAllowed(command, role)) return;

  const policy = RBAC_POLICIES.find(p => p.command === command);
  const allowed = policy ? policy.allowedRoles.join(', ') : 'any';
  throw new Error(
    `RBAC denied: command '${command}' requires one of [${allowed}] but current role is '${role}'.`,
  );
}

/**
 * Return all commands that are restricted to at least the given minimum role.
 * Useful for generating compliance reports.
 */
export function listRestrictedCommands(minRole: WorkspaceRole): string[] {
  const minOrder = ROLE_ORDER[minRole];
  return RBAC_POLICIES
    .filter(p => {
      // "restricted to minRole+" means the policy does NOT include roles below minRole
      const lowestAllowed = Math.min(...p.allowedRoles.map(r => ROLE_ORDER[r]));
      return lowestAllowed >= minOrder;
    })
    .map(p => p.command);
}
