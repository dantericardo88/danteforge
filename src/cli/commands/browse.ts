// Browse command — browser automation via gstack browse daemon.
// Fail-closed: exits code 1 if binary not found with install instructions.
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import {
  detectBrowseBinary,
  invokeBrowse,
  getBrowseInstallInstructions,
  getBrowsePort,
  type BrowseSubcommand,
} from '../../core/browse-adapter.js';

export async function browse(
  subcommand: string,
  args: string[],
  options: {
    url?: string;
    install?: boolean;
    port?: string;
    _detectBinary?: typeof detectBrowseBinary;
    _invokeBrowse?: typeof invokeBrowse;
    _loadState?: typeof loadState;
    _saveState?: typeof saveState;
  } = {},
) {
  const detectFn = options._detectBinary ?? detectBrowseBinary;
  const invokeFn = options._invokeBrowse ?? invokeBrowse;
  const loadFn = options._loadState ?? loadState;
  const saveFn = options._saveState ?? saveState;

  return withErrorBoundary('browse', async () => {
  // --- Decision-node: record start (best-effort) ---
  let _dnStartNodeId: string | undefined;
  const _dnT0 = Date.now();
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession();
    const _dnStart = await recordDecision({ session: _dnSess, actorType: 'agent', prompt: 'browse: browser automation', context: { subcommand }, result: 'in-progress', success: false });
    _dnStartNodeId = _dnStart.id;
  } catch { /* never block */ }

  // Binary detection — fail-closed
  const binaryPath = await detectFn();
  if (!binaryPath) {
    const instructions = getBrowseInstallInstructions(process.platform);
    logger.error(instructions);
    process.exitCode = 1;
    return;
  }

  const port = options.port ? parseInt(options.port, 10) : getBrowsePort();
  const evidenceDir = '.danteforge/evidence';

  // Handle --url shorthand for goto
  if (options.url && !subcommand) {
    subcommand = 'goto';
    args = [options.url, ...args];
  }

  if (!subcommand) {
    logger.error('Usage: danteforge browse <subcommand> [args...]');
    logger.info('Subcommands: goto, screenshot, text, html, links, accessibility, snapshot, diff, console, network, perf, ...');
    process.exitCode = 1;
    return;
  }

  const result = await invokeFn(
    subcommand as BrowseSubcommand,
    args,
    { binaryPath, port, evidenceDir },
  );

  if (result.success) {
    if (result.stdout) {
      process.stdout.write(result.stdout + '\n');
    }
    if (result.evidencePath) {
      logger.success(`Evidence saved: ${result.evidencePath}`);
    }
  } else {
    logger.error(result.errorMessage ?? `Browse command "${subcommand}" failed with exit code ${result.exitCode}`);
    process.exitCode = result.exitCode;
  }

  // Audit log
  try {
    const state = await loadFn();
    const entry = `${new Date().toISOString()} | browse: ${subcommand} ${args.join(' ')} → ${result.success ? 'ok' : 'fail'}`;
    state.auditLog.push(entry);
    if (result.evidencePath) {
      state.auditLog.push(`${new Date().toISOString()} | browse: evidence → ${result.evidencePath}`);
    }
    await saveFn(state);
  } catch {
    // State save is best-effort for browse
  }

  // --- Decision-node: record completion (best-effort) ---
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession();
    await recordDecision({ session: _dnSess, parentNodeId: _dnStartNodeId, actorType: 'agent', prompt: 'browse: browser automation [complete]', result: 'browse complete', success: true, latencyMs: Date.now() - _dnT0 });
  } catch { /* best-effort */ }
  });
}
