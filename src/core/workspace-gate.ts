// Workspace RBAC gate — enforces role-based access in workspace mode
// No-ops when no workspace is active (single-user mode is always permitted)

import { DanteError } from './errors.js';
import { loadWorkspace, getCurrentUserId, getActiveWorkspaceId, hasRole, type WorkspaceRole } from './workspace.js';

export class WorkspacePermissionError extends DanteError {
  constructor(message: string, remedy: string) {
    super(message, 'WORKSPACE_PERMISSION_DENIED', remedy);
    this.name = 'WorkspacePermissionError';
  }
}

export async function requireWorkspaceRole(
  minRole: WorkspaceRole,
  opts?: { _getWorkspaceId?: () => Promise<string | null>; _loadWorkspace?: typeof loadWorkspace },
): Promise<void> {
  const getWsId = opts?._getWorkspaceId ?? getActiveWorkspaceId;
  const loadWs = opts?._loadWorkspace ?? loadWorkspace;

  const workspaceId = await getWsId();
  if (!workspaceId) return; // single-user mode — no restriction

  const ws = await loadWs(workspaceId);
  if (!ws) return; // workspace config missing — no restriction (best-effort)

  const userId = getCurrentUserId();
  if (!hasRole(ws, userId, minRole)) {
    throw new WorkspacePermissionError(
      `'${userId}' does not have ${minRole} access to workspace '${ws.name}'`,
      `Ask the workspace owner to update your role: danteforge workspace invite ${userId} --role ${minRole}`,
    );
  }
}
