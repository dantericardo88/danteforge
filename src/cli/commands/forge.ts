import { executeWave } from '../../harvested/gsd/agents/executor.js';
import { runDanteParty } from '../../harvested/dante-agents/party-mode.js';
import { requirePlan, requireTests, runGate } from '../../core/gates.js';
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { runPolicyGate } from '../../core/policy-gate.js';
import { loadState, saveState } from '../../core/state.js';
import fs from 'fs/promises';

export async function forge(phase = '1', options: {
  profile?: string; parallel?: boolean; prompt?: boolean; light?: boolean;
  worktree?: boolean; figma?: boolean; skipUx?: boolean; confirm?: boolean;
  _isLLMAvailable?: () => Promise<boolean>;
  _policyGate?: typeof runPolicyGate;
} = {}) {
  return withErrorBoundary('forge', async () => {
  // Policy gate — check .danteforge/policy.yaml before execution
  const gateFn = options._policyGate ?? runPolicyGate;
  const decision = await gateFn('forge', process.cwd()).catch(() => null);
  if (decision && !decision.allowed) {
    logger.error(`[PolicyGate] forge blocked: ${decision.reason}`);
    process.exitCode = 1;
    return;
  }
  if (decision?.requiresApproval || options.confirm) {
    const state = await loadState().catch(() => null);
    if (state) {
      state.confirmationState = 'awaiting';
      if (decision?.timestamp) state.policyReceiptPath = decision.timestamp;
      await saveState(state).catch(() => { /* best-effort */ });
    }
    logger.warn('[PolicyGate] forge requires human approval. Set confirmationState=confirmed in .danteforge/STATE.yaml to proceed, or re-run without --confirm.');
    if (!options.confirm) {
      // requiresApproval from policy but no --confirm flag: block with guidance
    } else {
      // --confirm flag given: pause here for user to manually confirm
      process.exitCode = 1;
      return;
    }
  }

  if (!(await runGate(() => requirePlan(options.light)))) return;
  if (!(await runGate(() => requireTests(options.light)))) return;

  // LLM pre-flight — surface misconfiguration before wasting a full wave
  if (!options.prompt) {
    try {
      const isLLMAvailableFn = options._isLLMAvailable ?? (async () => {
        const { isLLMAvailable } = await import('../../core/llm.js');
        return isLLMAvailable();
      });
      const llmReady = await isLLMAvailableFn().catch(() => false);
      if (!llmReady) {
        logger.error(
          '[Forge] No LLM configured. Forge requires an LLM to generate code.\n' +
          '  → Run: danteforge doctor      (full health check)\n' +
          '  → Or:  danteforge config      (set API key / provider)\n' +
          '  → Or:  danteforge forge --prompt  (copy-paste mode, no API needed)',
        );
        process.exitCode = 1;
        return;
      }
    } catch { /* best-effort — never block if check itself fails */ }
  }

  if (options.figma && !options.skipUx) {
    if (!options.prompt) {
      logger.error('Automatic Figma apply is not available as a direct execution path. Re-run with --figma --prompt or use "danteforge ux-refine --openpencil".');
      process.exitCode = 1;
      return;
    }

    logger.info('Figma prompt mode - generating UX refinement prompt before wave execution...');
    const { uxRefine } = await import('./ux-refine.js');
    await uxRefine({ light: true, prompt: true, afterForge: true });
  }

  const profile = options.profile ?? 'balanced';
  const onChunk = process.stdout.isTTY ? (chunk: string) => { process.stdout.write(chunk); } : undefined;
  const result = await executeWave(parseInt(phase, 10), profile, options.parallel, options.prompt, options.worktree, undefined, { _onChunk: onChunk });
  if (!result.success) {
    process.exitCode = 1;
    return;
  }

  if (profile === 'quality' && result.mode === 'executed') {
    await runDanteParty();
  }

  try {
    await fs.access('.danteforge/DESIGN.op');
    logger.info('Extracting design tokens from DESIGN.op...');
    try {
      const { extractTokensFromDocument, tokensToCSS } = await import('../../harvested/openpencil/token-extractor.js');
      const { parseOP } = await import('../../harvested/openpencil/op-codec.js');
      const raw = await fs.readFile('.danteforge/DESIGN.op', 'utf-8');
      const doc = parseOP(raw);
      const tokens = extractTokensFromDocument(doc);
      const css = tokensToCSS(tokens);
      await fs.mkdir('.danteforge', { recursive: true });
      await fs.writeFile('.danteforge/design-tokens.css', css);
      logger.success('Design tokens saved to .danteforge/design-tokens.css');
    } catch (err) {
      logger.warn(`Design token extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } catch {
    // No DESIGN.op - skip token extraction for non-design projects.
  }
  });
}
