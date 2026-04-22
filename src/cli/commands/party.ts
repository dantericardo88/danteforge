import { runDanteParty, DEFAULT_AGENTS } from '../../harvested/dante-agents/party-mode.js';
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

export async function party(options: {
  worktree?: boolean;
  figma?: boolean;
  skipUx?: boolean;
  design?: boolean;
  isolation?: boolean;
  _runParty?: typeof runDanteParty;
} = {}) {
  const runPartyFn = options._runParty ?? runDanteParty;

  return withErrorBoundary('party', async () => {
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

    const result = await runPartyFn(agents, options.worktree, options.isolation);
    if (result && !result.success) {
      process.exitCode = 1;
    }
  });
}
