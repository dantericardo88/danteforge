import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { handoff } from '../../core/handoff.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { displayPrompt, savePrompt } from '../../core/prompt-builder.js';
import { requireConstitution, runGate } from '../../core/gates.js';
import { buildLocalSpec, extractNumberedTasks, writeArtifact } from '../../core/local-artifacts.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { validateSpec } from '../../core/spec-validator.js';
import { recordStage } from '../../core/pipeline-tracker.js';

const STATE_DIR = '.danteforge';

export async function specify(idea: string, options: {
  prompt?: boolean;
  light?: boolean;
  _llmCaller?: typeof callLLM;
  _isLLMAvailable?: typeof isLLMAvailable;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
  _writeArtifact?: typeof writeArtifact;
} = {}) {
  const llmFn = options._llmCaller ?? callLLM;
  const llmAvailFn = options._isLLMAvailable ?? isLLMAvailable;
  const loadFn = options._loadState ?? loadState;
  const saveFn = options._saveState ?? saveState;
  const writeFn = options._writeArtifact ?? writeArtifact;

  return withErrorBoundary('specify', async () => {
  // --- Decision-node: record start (best-effort) ---
  let _dnStartNodeId: string | undefined;
  const _dnT0 = Date.now();
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession();
    const _dnStart = await recordDecision({ session: _dnSess, actorType: 'agent', prompt: `specify: ${idea}`, context: { idea }, result: 'in-progress', success: false });
    _dnStartNodeId = _dnStart.id;
  } catch { /* never block */ }

  if (!(await runGate(() => requireConstitution(options.light)))) return;

  logger.info(`Specifying: ${idea}`);

  const state = await loadFn();

  let currentState = '';
  try {
    currentState = await fs.readFile(path.join(STATE_DIR, 'CURRENT_STATE.md'), 'utf8');
  } catch {
    // Current state review is optional context.
  }

  const prompt = `You are a senior software architect creating a detailed specification from a high-level idea.

Idea: "${idea}"

${state.constitution ? `Project principles:\n${state.constitution}\n` : ''}
${currentState ? `Current project state:\n${currentState.slice(0, 3000)}\n` : ''}

Generate a complete SPEC.md with:
1. **Feature Name** and one-line summary
2. **Constitution Reference** - which principles apply
3. **What & Why** - detailed description and motivation
4. **User Stories** - as a [role], I want [action], so that [benefit]
5. **Non-functional Requirements** - performance, security, accessibility
6. **Acceptance Criteria** - specific, testable conditions
7. **Task Breakdown** - numbered list with parallel flags [P] where applicable
8. **Dependencies & Risks**

Output ONLY the markdown content - no preamble.`;

  if (options.prompt) {
    const savedPath = await savePrompt('specify', prompt);
    displayPrompt(prompt, [
      'Paste into your LLM, then run: danteforge import <file> --as SPEC.md',
      `Prompt saved to: ${savedPath}`,
    ].join('\n'));
    state.auditLog.push(`${new Date().toISOString()} | specify: prompt generated for "${idea}"`);
    await saveFn(state);
    return;
  }

  const llmAvailable = await llmAvailFn();
  if (llmAvailable) {
    logger.info('Sending to LLM for spec generation...');
    try {
      const specMd = await llmFn(prompt, undefined, { enrichContext: true });
      await writeFn('SPEC.md', specMd);

      const tasks = extractNumberedTasks(specMd, 'Task Breakdown');
      const normalizedTasks = tasks.length > 0
        ? tasks
        : [{ name: `Implement ${idea}`, verify: 'All acceptance criteria met' }];

      await handoff('spec', { constitution: state.constitution, tasks: normalizedTasks });
      logger.success(`SPEC.md generated for "${idea}" - ${normalizedTasks.length} tasks identified`);
      logger.info('Run "danteforge clarify" next, then continue with "danteforge plan" and "danteforge tasks" before forge.');

      // Validate spec quality (best-effort)
      try {
        const validation = validateSpec(specMd);
        if (validation.score < 6.0) {
          logger.warn(`[specify] Spec quality score: ${validation.score.toFixed(1)}/10 (below 6.0 threshold)`);
          for (const issue of validation.issues.slice(0, 3)) {
            logger.warn(`  - ${issue}`);
          }
        } else {
          logger.info(`[specify] Spec quality score: ${validation.score.toFixed(1)}/10`);
        }
      } catch { /* best-effort */ }

      // Record pipeline stage (best-effort)
      try { await recordStage('specify'); } catch { /* best-effort */ }
      return;
    } catch (err) {
      logger.warn(`API call failed: ${err instanceof Error ? err.message : String(err)}`);
      logger.info('Falling back to local artifact generation...');
    }
  }

  const localSpec = buildLocalSpec(idea, state.constitution, currentState);
  await writeFn('SPEC.md', localSpec.markdown);
  await handoff('spec', { constitution: state.constitution ?? 'Loaded from .danteforge', tasks: localSpec.tasks });
  logger.success(`SPEC.md generated locally for "${idea}" - ${localSpec.tasks.length} tasks identified`);
  logger.info('Run "danteforge clarify" next, then continue with "danteforge plan" and "danteforge tasks" before forge.');
  if (!llmAvailable) {
    logger.info('Tip: Set up an API key for richer specs: danteforge config --set-key "grok:<key>"');
  }

  // Validate spec quality (best-effort)
  try {
    const validation = validateSpec(localSpec.markdown);
    if (validation.score < 6.0) {
      logger.warn(`[specify] Spec quality score: ${validation.score.toFixed(1)}/10 (below 6.0 threshold)`);
      for (const issue of validation.issues.slice(0, 3)) {
        logger.warn(`  - ${issue}`);
      }
    }
  } catch { /* best-effort */ }

  // Record pipeline stage (best-effort)
  try { await recordStage('specify'); } catch { /* best-effort */ }

  // --- Decision-node: record completion (best-effort) ---
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession();
    await recordDecision({ session: _dnSess, parentNodeId: _dnStartNodeId, actorType: 'agent', prompt: `specify: ${idea} [complete]`, result: 'SPEC.md written', success: true, latencyMs: Date.now() - _dnT0 });
  } catch { /* best-effort */ }
  });
}
