// Atomic Git commits — safe, focused commit operations
import { simpleGit } from 'simple-git';
import { logger } from '../core/logger.js';

const git = simpleGit();

export async function atomicCommit(message: string) {
  await git.add('.');
  await git.commit(`[DanteForge] ${message}`);
  logger.success(`Atomic commit: ${message}`);
}
