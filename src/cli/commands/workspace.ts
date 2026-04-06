// workspace command — manage DanteForge workspaces for multi-user projects
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import {
  createWorkspace,
  loadWorkspace,
  addMember,
  getCurrentUserId,
  type WorkspaceMember,
} from '../../core/workspace.js';

export async function workspace(
  subcommand: string,
  args: string[],
  options: {
    role?: string;
    _createWorkspace?: typeof createWorkspace;
    _loadWorkspace?: typeof loadWorkspace;
  } = {},
): Promise<void> {
  return withErrorBoundary('workspace', async () => {
    const createFn = options._createWorkspace ?? createWorkspace;
    const loadFn = options._loadWorkspace ?? loadWorkspace;

    switch (subcommand) {
      case 'create': {
        const name = args[0];
        if (!name) {
          logger.error('Usage: danteforge workspace create <name>');
          process.exitCode = 1;
          return;
        }
        const ws = await createFn(name);
        logger.success(`Workspace '${ws.name}' created (id: ${ws.id})`);
        logger.info(`  Set active: export DANTEFORGE_WORKSPACE=${ws.id}`);
        break;
      }
      case 'status': {
        const wsId = process.env['DANTEFORGE_WORKSPACE'];
        if (!wsId) {
          logger.info('No active workspace (single-user mode)');
          logger.info('  Create one: danteforge workspace create <name>');
          return;
        }
        const ws = await loadFn(wsId);
        if (!ws) {
          logger.error(`Workspace '${wsId}' not found`);
          process.exitCode = 1;
          return;
        }
        logger.info(`Workspace: ${ws.name} (${ws.id})`);
        logger.info(`Members:`);
        for (const m of ws.members) {
          const isSelf = m.id === getCurrentUserId() ? ' <- you' : '';
          logger.info(`  ${m.role.padEnd(10)} ${m.id}${isSelf}`);
        }
        break;
      }
      case 'invite': {
        const wsId = process.env['DANTEFORGE_WORKSPACE'];
        if (!wsId) {
          logger.error('No active workspace. Set DANTEFORGE_WORKSPACE first.');
          process.exitCode = 1;
          return;
        }
        const userId = args[0];
        if (!userId) {
          logger.error('Usage: danteforge workspace invite <user> [--role editor|reviewer]');
          process.exitCode = 1;
          return;
        }
        const role = (options.role ?? 'editor') as WorkspaceMember['role'];
        if (!['owner', 'editor', 'reviewer'].includes(role)) {
          logger.error('Invalid role. Use: owner, editor, or reviewer');
          process.exitCode = 1;
          return;
        }
        const member: WorkspaceMember = { id: userId, role, addedAt: new Date().toISOString() };
        await addMember(wsId, member);
        logger.success(`${userId} added to workspace '${wsId}' as ${role}`);
        break;
      }
      case 'list': {
        logger.info('Set DANTEFORGE_WORKSPACE=<id> to activate a workspace.');
        logger.info('Workspaces are stored in ~/.danteforge/workspaces/');
        break;
      }
      default:
        logger.error(
          `Unknown subcommand: ${subcommand}. Available: create, status, invite, list`,
        );
        process.exitCode = 1;
    }
  });
}
