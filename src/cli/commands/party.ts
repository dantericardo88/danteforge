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

    // --- Decision-node: record start (best-effort) ---
    let _dnStartNodeId: string | undefined;
    const _dnT0 = Date.now();
    try {
      const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
      const _dnSess = getSession();
      const _dnStart = await recordDecision({ session: _dnSess, actorType: 'agent', prompt: 'party: multi-agent review', context: { isolation: options.isolation, worktree: options.worktree }, result: 'in-progress', success: false });
      _dnStartNodeId = _dnStart.id;
    } catch { /* never block party */ }

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

    // --- Decision-node: record completion (best-effort) ---
    try {
      const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
      const _dnSess = getSession();
      await recordDecision({ session: _dnSess, parentNodeId: _dnStartNodeId, actorType: 'agent', prompt: 'party: multi-agent review [complete]', result: 'completed', success: !result || result.success, latencyMs: Date.now() - _dnT0 });
    } catch { /* best-effort */ }
  });
}
