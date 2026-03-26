import { runDanteParty, DEFAULT_AGENTS } from '../../harvested/dante-agents/party-mode.js';
import { logger } from '../../core/logger.js';

export async function party(options: { worktree?: boolean; figma?: boolean; skipUx?: boolean; design?: boolean; isolation?: boolean } = {}) {
  if (options.figma && !options.skipUx) {
    logger.error('Automatic Figma apply is not available in party mode. Run "danteforge ux-refine --prompt" or "danteforge ux-refine --openpencil" separately before party mode.');
    process.exitCode = 1;
    return;
  }

  let agents: string[] | undefined;
  if (options.design === false) {
    agents = DEFAULT_AGENTS.filter(agent => agent !== 'design');
    logger.info('Design Agent excluded (--no-design)');
  } else if (options.design === true) {
    agents = undefined;
    logger.info('Design Agent activated (--design)');
  }

  const result = await runDanteParty(agents, options.worktree, options.isolation);
  if (!result.success) process.exitCode = 1;

  // Post-party detective audit: check git diff for protected path mutations (best-effort)
  if (result.success) {
    try {
      const { getChangedFiles } = await import('../../utils/git.js');
      const { auditPostForgeProtectedMutations } = await import('../../core/safe-self-edit.js');
      const { loadState } = await import('../../core/state.js');
      const state = await loadState();
      const changed = await getChangedFiles(process.cwd());
      const policy = state.selfEditPolicy ?? 'deny';
      const { violations } = await auditPostForgeProtectedMutations(changed, policy);
      if (violations.length > 0 && policy !== 'allow-with-audit') {
        process.exitCode = 1;
      }
    } catch { /* best-effort: git or state unavailable */ }
  }
}
