// Policy command — get or set the self-edit policy for this project
import { loadState, saveState } from '../../core/state.js';
import { logger } from '../../core/logger.js';
import type { SelfEditPolicy } from '../../core/safe-self-edit.js';

const VALID_POLICIES: SelfEditPolicy[] = ['deny', 'confirm', 'allow-with-audit'];

export async function policy(
  action?: string,
  value?: string,
  options: { cwd?: string } = {},
): Promise<void> {
  if (!action || action === 'get') {
    const state = await loadState({ cwd: options.cwd });
    const current = state.selfEditPolicy ?? 'deny (default)';
    logger.info(`Self-edit policy: ${current}`);
    logger.info('Options: deny | confirm | allow-with-audit');
    return;
  }

  if (action === 'set') {
    if (!value || !(VALID_POLICIES as string[]).includes(value)) {
      logger.error(`Invalid policy: "${value ?? ''}". Use: deny | confirm | allow-with-audit`);
      process.exitCode = 1;
      return;
    }
    const state = await loadState({ cwd: options.cwd });
    state.selfEditPolicy = value as SelfEditPolicy;
    state.auditLog.push(
      `${new Date().toISOString()} | policy: selfEditPolicy set to ${value}`,
    );
    await saveState(state, { cwd: options.cwd });
    logger.success(`Self-edit policy set to: ${value}`);
    return;
  }

  logger.error(`Unknown policy action: "${action}". Use: get | set <deny|confirm|allow-with-audit>`);
  process.exitCode = 1;
}
