// Workspace RBAC gate — enforces role-based access in workspace mode
// No-ops when no workspace is active (single-user mode is always permitted)

import { DanteError } from './errors.js';
import { loadWorkspace, getCurrentUserId, getActiveWorkspaceId, hasRole, type WorkspaceRole } from './workspace.js';
import { recordWorkspaceAudit, type WorkspaceAuditOps } from './workspace-audit.js';

export class WorkspacePermissionError extends DanteError {
  constructor(message: string, remedy: string) {
    super(message, 'WORKSPACE_PERMISSION_DENIED', remedy);
    this.name = 'WorkspacePermissionError';
  }
}

export interface RequireWorkspaceRoleOpts {
  _getWorkspaceId?: () => Promise<string | null>;
  _loadWorkspace?: typeof loadWorkspace;
  _recordAudit?: typeof recordWorkspaceAudit;
  _auditOps?: WorkspaceAuditOps;
}

export async function requireWorkspaceRole(
  minRole: WorkspaceRole,
  opts?: RequireWorkspaceRoleOpts,
): Promise<void> {
  const getWsId = opts?._getWorkspaceId ?? getActiveWorkspaceId;
  const loadWs = opts?._loadWorkspace ?? loadWorkspace;
  const audit = opts?._recordAudit ?? recordWorkspaceAudit;

  const workspaceId = await getWsId();
  if (!workspaceId) return; // single-user mode — no restriction

  const ws = await loadWs(workspaceId);
  if (!ws) return; // workspace config missing — no restriction (best-effort)

  const userId = getCurrentUserId();
  if (!hasRole(ws, userId, minRole)) {
    // Record denied access attempt — best-effort, never blocks the throw
    try {
      const member = ws.members.find((m) => m.id === userId);
      await audit(
        {
          workspaceId,
          userId,
          role: member?.role,
          action: 'access_denied',
          result: 'denied',
          detail: `required ${minRole}, had ${member?.role ?? 'no membership'}`,
        },
        opts?._auditOps,
      );
    } catch {
      // audit must never prevent the gate from firing
    }
    throw new WorkspacePermissionError(
      `'${userId}' does not have ${minRole} access to workspace '${ws.name}'`,
      `Ask the workspace owner to update your role: danteforge workspace invite ${userId} --role ${minRole}`,
    );
  }

  // Record successful access — best-effort
  try {
    const member = ws.members.find((m) => m.id === userId);
    await audit(
      {
        workspaceId,
        userId,
        role: member?.role,
        action: 'access_granted',
        result: 'success',
        detail: `required ${minRole}`,
      },
      opts?._auditOps,
    );
  } catch {
    // audit must never block the gate
  }
}
