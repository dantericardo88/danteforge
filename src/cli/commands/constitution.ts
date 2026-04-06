// Constitution command — establish project principles and constraints
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { handoff } from '../../core/handoff.js';
import { writeArtifact } from '../../core/local-artifacts.js';

export async function constitution() {
  return withErrorBoundary('constitution', async () => {
    logger.success('Creating DanteForge project constitution...');
    const constitutionText = [
      '# DanteForge Constitution',
      '- Always prioritize zero ambiguity',
      '- Local-first & PIPEDA compliant',
      '- Atomic commits only',
      '- Always verify before commit',
      '- Scale-adaptive: solo -> party mode automatically',
    ].join('\n');
    await writeArtifact('CONSTITUTION.md', constitutionText);
    await handoff('constitution', { constitution: constitutionText });
    logger.success('Constitution ready – run "danteforge specify <idea>" next');
  });
}
