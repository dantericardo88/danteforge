// Design — generate design artifacts from natural language via OpenPencil Design-as-Code engine
// Three modes: LLM API, --prompt (copy-paste), local fallback
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { requirePlan, runGate } from '../../core/gates.js';
import { handoff } from '../../core/handoff.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { buildDesignPrompt, savePrompt, displayPrompt } from '../../core/prompt-builder.js';
import { isUIProject } from '../../core/mcp-adapter.js';
import { ensureOPIntermediatesIgnored } from '../../utils/worktree.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import fs from 'fs/promises';
import path from 'path';

const STATE_DIR = '.danteforge';

export async function design(
  prompt: string,
  options: {
    prompt?: boolean;
    light?: boolean;
    format?: string;
    parallel?: boolean;
    worktree?: boolean;
    _llmCaller?: typeof callLLM;
    _isLLMAvailable?: typeof isLLMAvailable;
    _loadState?: typeof loadState;
    _saveState?: typeof saveState;
  } = {},
): Promise<void> {
  const llmFn = options._llmCaller ?? callLLM;
  const llmAvailFn = options._isLLMAvailable ?? isLLMAvailable;
  const loadFn = options._loadState ?? loadState;
  const saveFn = options._saveState ?? saveState;

  return withErrorBoundary('design', async () => {
  logger.info('Design: generating design artifacts from natural language');

  // Ensure .op intermediate files are gitignored
  await ensureOPIntermediatesIgnored();

  // Gate: PLAN.md must exist (unless --light)
  if (!(await runGate(() => requirePlan(options.light)))) { process.exitCode = 1; return; }

  const state = await loadFn();

  // Context-aware: check if this is a UI project
  const hasUI = await isUIProject();
  if (!hasUI && !options.light) {
    logger.warn('No frontend framework detected — design artifacts may not be applicable');
    logger.info('Override with: danteforge design <prompt> --light');
  }

  // Build the design prompt
  const designPrompt = buildDesignPrompt(
    prompt,
    state.constitution,
    undefined, // techStack — could be extended later
    undefined, // existingDesign — could load existing DESIGN.op
  );

  // Mode 1: --prompt mode (generate copy-paste prompt)
  if (options.prompt) {
    const savedPath = await savePrompt('design', designPrompt);
    displayPrompt(designPrompt, [
      'Paste into your AI coding editor to generate the .op design specification.',
      'After receiving the JSON output, save it as .danteforge/DESIGN.op',
      `Prompt saved to: ${savedPath}`,
    ].join('\n'));

    state.auditLog.push(`${new Date().toISOString()} | design: prompt generated`);
    await saveFn(state);
    return;
  }

  // Mode 2: LLM API mode
  const llmAvailable = await llmAvailFn();
  if (!llmAvailable) {
    logger.error('No verified live LLM provider is available for design generation. Re-run with --prompt or configure a provider with working model access.');
    process.exitCode = 1;
    return;
  }

  logger.info('Running design generation via LLM...');

  try {
    const result = await llmFn(designPrompt, undefined, { enrichContext: true });
    logger.success(`Design generation complete (${result.length} chars)`);

    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, result];
    const rawJson = jsonMatch[1]?.trim() ?? result.trim();
    const parsed = JSON.parse(rawJson);

    if (!parsed.nodes || !parsed.document) {
      throw new Error('LLM response missing required .op fields: nodes, document');
    }

    parsed.generator = parsed.generator ?? 'danteforge/0.6.0';
    parsed.formatVersion = parsed.formatVersion ?? '1.0.0';
    parsed.created = parsed.created ?? new Date().toISOString();

    const designPath = path.join(STATE_DIR, 'DESIGN.op');
    await fs.mkdir(STATE_DIR, { recursive: true });
    await fs.writeFile(designPath, JSON.stringify(parsed, null, 2));
    logger.success(`Design artifact saved to ${designPath}`);

    state.designEnabled = true;
    state.designFilePath = 'DESIGN.op';
    state.designFormatVersion = '1.0.0';
    state.workflowStage = 'design';
    state.auditLog.push(`${new Date().toISOString()} | design: .op artifact created via LLM`);
    await saveFn(state);
    await handoff('design', { designFile: 'DESIGN.op' });

    // Auto-run design rules and report warnings
    try {
      const { parseOP } = await import('../../harvested/openpencil/op-codec.js');
      const { evaluateDocument, loadRules, loadRuleConfig } = await import('../../core/design-rules-engine.js');
      const doc = parseOP(JSON.stringify(parsed));
      const violations = evaluateDocument(
        doc,
        loadRules('.danteforge/design-rules.yaml'),
        loadRuleConfig('.danteforge/design-rules.yaml'),
      );
      const errors = violations.filter(v => v.severity === 'error');
      const warnings = violations.filter(v => v.severity === 'warning');
      if (errors.length > 0 || warnings.length > 0) {
        logger.warn(`Design lint: ${errors.length} error(s), ${warnings.length} warning(s). Run \`danteforge ux-refine --lint\` for details.`);
      } else {
        logger.info('Design lint: all rules passed');
      }
    } catch {
      // Design rules evaluation should not block design command
    }
  } catch (err) {
    logger.error(`Design generation failed: ${err instanceof Error ? err.message : String(err)}`);
    logger.info('Re-run with --prompt to generate a manual design prompt.');
    process.exitCode = 1;
  }
  });
}
