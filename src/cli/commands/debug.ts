// Debug command — systematic 4-phase debugging framework
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { resolveSkill } from '../../core/skills.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { savePrompt, displayPrompt } from '../../core/prompt-builder.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import type { DanteState } from '../../core/state.js';

export interface DebugOptions {
  prompt?: boolean;
  _loadState?: () => Promise<DanteState>;
  _saveState?: (s: DanteState) => Promise<void>;
  _resolveSkill?: (name: string) => Promise<{ content: string } | null>;
  _isLLMAvailable?: () => Promise<boolean>;
  _callLLM?: (prompt: string) => Promise<string>;
  _savePrompt?: (name: string, template: string) => Promise<string>;
}

export async function debug(issue: string, options: DebugOptions = {}, _opts?: DebugOptions) {
  // Support injection seams in either options or _opts (3-arg form)
  const opts = (_opts && typeof _opts === 'object') ? { ...options, ..._opts } : options;
  return withErrorBoundary('debug', async () => {
  logger.info(`Systematic Debugging: "${issue}"`);

  const state = await (opts._loadState ?? loadState)();
  const skill = await (opts._resolveSkill ?? resolveSkill)('systematic-debugging');

  const prompt = `You are a senior software engineer performing systematic debugging using a strict 4-phase framework.

${skill ? `## Debugging Framework\n${skill.content}\n` : ''}
${state.constitution ? `Project principles:\n${state.constitution}\n` : ''}

## Issue to Debug
"${issue}"

## Instructions
Follow the 4-phase debugging framework EXACTLY:

**Phase 1: Root Cause Investigation** (NO fixes yet)
- Analyze the issue description
- Identify what information is needed to reproduce
- Suggest diagnostic steps (logs, breakpoints, git diff)
- Trace the likely data flow backward from the symptom

**Phase 2: Pattern Analysis**
- Identify similar working patterns in a typical codebase
- List differences between expected and actual behavior
- Document assumptions about inputs/outputs

**Phase 3: Hypothesis and Testing**
- Form 2-3 specific hypotheses: "I believe X causes Y because Z"
- For each, suggest a minimal test to validate/invalidate
- Rank by likelihood

**Phase 4: Implementation**
- Suggest a failing test that reproduces the bug
- Propose the minimal root-cause fix
- Describe verification steps

Output a structured debugging plan in markdown.`;

  if (opts.prompt) {
    const savedPath = await (opts._savePrompt ?? savePrompt)('debug', prompt);
    displayPrompt(prompt, [
      'Paste into your LLM to get a structured debugging plan.',
      `Prompt saved to: ${savedPath}`,
    ].join('\n'));
    state.auditLog.push(`${new Date().toISOString()} | debug: prompt generated for "${issue}"`);
    await (opts._saveState ?? saveState)(state);
    return;
  }

  const llmAvailable = await (opts._isLLMAvailable ?? isLLMAvailable)();
  if (llmAvailable) {
    logger.info('Sending to LLM for systematic debug analysis...');
    try {
      const result = await (opts._callLLM
        ? opts._callLLM(prompt)
        : callLLM(prompt, undefined, { enrichContext: true }));
      process.stdout.write('\n' + result + '\n');
      state.auditLog.push(`${new Date().toISOString()} | debug: LLM analysis for "${issue}" (${result.length} chars)`);
      await (opts._saveState ?? saveState)(state);
      return;
    } catch (err) {
      logger.warn(`API call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Fallback: display the skill content as guidance
  if (skill) {
    logger.success('Systematic Debugging Framework:');
    process.stdout.write(skill.content + '\n');
  } else {
    logger.info('Follow the 4-phase framework: Trace -> Isolate -> Diagnose -> Fix');
  }

  state.auditLog.push(`${new Date().toISOString()} | debug: framework displayed for "${issue}"`);
  await (opts._saveState ?? saveState)(state);
  });
}
