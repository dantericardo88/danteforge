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
    // --- Decision-node: record start (best-effort) ---
    let _dnStartNodeId: string | undefined;
    const _dnT0 = Date.now();
    try {
      const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
      const _dnSess = getSession();
      const _dnStart = await recordDecision({ session: _dnSess, actorType: 'agent', prompt: 'constitution: define project principles', context: {}, result: 'in-progress', success: false });
      _dnStartNodeId = _dnStart.id;
    } catch { /* never block */ }

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

    // --- Decision-node: record completion (best-effort) ---
    try {
      const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
      const _dnSess = getSession();
      await recordDecision({ session: _dnSess, parentNodeId: _dnStartNodeId, actorType: 'agent', prompt: 'constitution: define project principles [complete]', result: 'CONSTITUTION.md written', success: true, latencyMs: Date.now() - _dnT0 });
    } catch { /* best-effort */ }
  });
}
