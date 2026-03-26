import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState, recordWorkflowStage, saveState } from '../../core/state.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { displayPrompt, savePrompt } from '../../core/prompt-builder.js';
import { requireClarify, requireSpec, runGate } from '../../core/gates.js';
import { buildLocalPlan, writeArtifact } from '../../core/local-artifacts.js';

const STATE_DIR = '.danteforge';

export async function plan(options: { prompt?: boolean; light?: boolean } = {}) {
  if (!(await runGate(() => requireSpec(options.light)))) { process.exitCode = 1; return; }
  if (!(await runGate(() => requireClarify(options.light)))) { process.exitCode = 1; return; }

  logger.info('Generating detailed plan from spec...');

  const state = await loadState();

  let specContent = '';
  let currentState = '';
  try {
    specContent = await fs.readFile(path.join(STATE_DIR, 'SPEC.md'), 'utf8');
  } catch {}
  try {
    currentState = await fs.readFile(path.join(STATE_DIR, 'CURRENT_STATE.md'), 'utf8');
  } catch {}

  const prompt = `You are a senior software architect creating a detailed implementation plan.

${state.constitution ? `Project principles:\n${state.constitution}\n` : ''}
${specContent ? `Specification:\n${specContent.slice(0, 3000)}\n` : '(No spec found - generate a general plan)'}
${currentState ? `Current project state:\n${currentState.slice(0, 2000)}\n` : ''}

Generate a detailed PLAN.md with:
1. **Architecture Overview** - system diagram, key components, data flow
2. **Implementation Phases** - ordered steps with dependencies
3. **Technology Decisions** - frameworks, libraries, patterns with rationale
4. **Risk Mitigations** - identified risks and countermeasures
5. **Testing Strategy** - unit, integration, e2e approach
6. **Timeline** - relative effort estimates per phase (S/M/L/XL)

Output ONLY the markdown content - no preamble.`;

  if (options.prompt) {
    const savedPath = await savePrompt('plan', prompt);
    displayPrompt(prompt, [
      'Paste into your LLM, then run: danteforge import <file> --as PLAN.md',
      `Prompt saved to: ${savedPath}`,
    ].join('\n'));
    state.auditLog.push(`${new Date().toISOString()} | plan: prompt generated`);
    await saveState(state);
    return;
  }

  const llmAvailable = await isLLMAvailable();
  if (llmAvailable) {
    logger.info('Sending to LLM for plan generation...');
    try {
      const planMd = await callLLM(prompt, undefined, { enrichContext: true });
      await writeArtifact('PLAN.md', planMd);

      const timestamp = recordWorkflowStage(state, 'plan');
      state.auditLog.push(`${timestamp} | plan: PLAN.md generated via API`);
      await saveState(state);
      logger.success('PLAN.md generated - run "danteforge tasks" to break it into executable tasks');
      return;
    } catch (err) {
      logger.warn(`API call failed: ${err instanceof Error ? err.message : String(err)}`);
      logger.info('Falling back to local artifact generation...');
    }
  }

  const localPlan = buildLocalPlan(specContent, state.constitution, currentState);
  await writeArtifact('PLAN.md', localPlan);
  const timestamp = recordWorkflowStage(state, 'plan');
  state.auditLog.push(`${timestamp} | plan: PLAN.md generated locally`);
  await saveState(state);
  logger.success('PLAN.md generated locally - run "danteforge tasks" to break it into executable tasks');
  if (!llmAvailable) {
    logger.info('Tip: Set up an API key for richer plans: danteforge config --set-key "grok:<key>"');
  }
}
