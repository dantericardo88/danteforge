// define-done — Interactive command to set the completion target
// Prompts the user to define what "9+" means for this project.
// Saves to .danteforge/completion-target.json (never re-prompts unless --reset).

import { logger } from '../../core/logger.js';
import {
  loadCompletionTarget,
  saveCompletionTarget,
  promptUserForCompletionTarget,
  formatCompletionTarget,
  type CompletionTarget,
  type CompletionTargetOptions,
} from '../../core/completion-target.js';

export interface DefineDoneOptions {
  reset?: boolean;
  cwd?: string;
  // Injection seams for testing
  _loadTarget?: (cwd: string) => Promise<CompletionTarget | null>;
  _saveTarget?: (target: CompletionTarget, cwd: string) => Promise<void>;
  _promptTarget?: (opts: CompletionTargetOptions) => Promise<CompletionTarget>;
  _now?: () => string;
}

export async function defineDone(options: DefineDoneOptions = {}): Promise<CompletionTarget> {
  const cwd = options.cwd ?? process.cwd();
  const now = options._now ?? (() => new Date().toISOString());

  const loadFn = options._loadTarget ?? ((dir: string) => loadCompletionTarget(dir));
  const saveFn = options._saveTarget ?? ((t: CompletionTarget, dir: string) => saveCompletionTarget(t, dir));
  const promptFn = options._promptTarget ?? ((opts: CompletionTargetOptions) => promptUserForCompletionTarget(opts));

  // Show existing target if not resetting
  const existing = await loadFn(cwd);
  if (existing && !options.reset) {
    logger.info('');
    logger.info('Completion target already defined:');
    logger.info('');
    logger.info(formatCompletionTarget(existing));
    logger.info('');
    logger.info('Run `danteforge define-done --reset` to redefine it.');
    return existing;
  }

  if (options.reset && existing) {
    logger.info('[define-done] Resetting existing completion target...');
  }

  // Prompt user
  const target = await promptFn({ cwd, _now: now });

  // Save
  await saveFn(target, cwd);

  logger.success('');
  logger.success('✓ Completion target saved:');
  logger.info('');
  logger.info(formatCompletionTarget(target));
  logger.info('');
  logger.info('Run `danteforge assess` to score the project against this target.');
  logger.info('Run `danteforge self-improve` to automatically close gaps.');

  return target;
}
