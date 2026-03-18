// Browse command — browser automation via gstack browse daemon.
// Fail-closed: exits code 1 if binary not found with install instructions.
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
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
  options: { url?: string; install?: boolean; port?: string } = {},
) {
  // Binary detection — fail-closed
  const binaryPath = await detectBrowseBinary();
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

  const result = await invokeBrowse(
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
    const state = await loadState();
    const entry = `${new Date().toISOString()} | browse: ${subcommand} ${args.join(' ')} → ${result.success ? 'ok' : 'fail'}`;
    state.auditLog.push(entry);
    if (result.evidencePath) {
      state.auditLog.push(`${new Date().toISOString()} | browse: evidence → ${result.evidencePath}`);
    }
    await saveState(state);
  } catch {
    // State save is best-effort for browse
  }
}
