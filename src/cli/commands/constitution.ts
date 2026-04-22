// Constitution command — establish project principles and constraints
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { handoff } from '../../core/handoff.js';
import { writeArtifact } from '../../core/local-artifacts.js';

export async function constitution(options: {
  _writeArtifact?: (name: string, content: string) => Promise<void>;
  _handoff?: (stage: string, data: Record<string, unknown>) => Promise<void>;
} = {}) {
  const writeFn = options._writeArtifact ?? writeArtifact;
  const handoffFn = options._handoff ?? handoff;

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
    await writeFn('CONSTITUTION.md', constitutionText);
    await handoffFn('constitution', { constitution: constitutionText });
    logger.success('Constitution ready – run "danteforge specify <idea>" next');
  });
}
