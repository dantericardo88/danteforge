import { executeWave } from '../../harvested/gsd/agents/executor.js';
import { runDanteParty } from '../../harvested/dante-agents/party-mode.js';
import { requirePlan, requireTests, runGate } from '../../core/gates.js';
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { runPolicyGate } from '../../core/policy-gate.js';
import { loadState, saveState } from '../../core/state.js';
import { withProgress } from '../../core/progress-indicator.js';
import fs from 'fs/promises';
import { checkSpecDrift } from '../../core/spec-drift-detector.js';
import { recordStage } from '../../core/pipeline-tracker.js';

async function checkLLMPreflight(
  isLLMAvailableFn?: () => Promise<boolean>,
): Promise<boolean> {
  try {
    const fn = isLLMAvailableFn ?? (async () => {
      const { isLLMAvailable } = await import('../../core/llm.js');
      return isLLMAvailable();
    });
    const ready = await fn().catch(() => false);
    if (!ready) {
      logger.error(
        '[Forge] No LLM configured. Forge requires an LLM to generate code.\n' +
        '  → Run: danteforge doctor      (full health check)\n' +
        '  → Or:  danteforge config      (set API key / provider)\n' +
        '  → Or:  danteforge forge --prompt  (copy-paste mode, no API needed)',
      );
      process.exitCode = 1;
      return false;
    }
  } catch { /* best-effort — never block if check itself fails */ }
  return true;
}

export async function forge(phase = '1', options: {
  profile?: string; parallel?: boolean; prompt?: boolean; light?: boolean;
  worktree?: boolean; figma?: boolean; skipUx?: boolean; confirm?: boolean;
  _isLLMAvailable?: () => Promise<boolean>;
  _policyGate?: typeof runPolicyGate;
  /** Injection seam: replaces createTimeMachineCommit for testing */
  _timeMachineCommit?: (opts: { cwd: string; paths: string[]; label: string; runId?: string }) => Promise<void>;
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

  // Spec drift check — warn if spec changed since last plan (best-effort)
  try {
    const drift = await checkSpecDrift(process.cwd());
    if (drift.drifted) {
      logger.warn(`[forge] ${drift.message}`);
      logger.warn('[forge] The plan may be stale. Run "danteforge clarify" and "danteforge plan" to realign before forging.');
    }
  } catch { /* best-effort — never block forge */ }

  // Record pipeline stage (best-effort)
  try { await recordStage('forge', process.cwd()); } catch { /* best-effort */ }

  // LLM pre-flight — surface misconfiguration before wasting a full wave
  if (!options.prompt && !(await checkLLMPreflight(options._isLLMAvailable))) return;

  // --- Decision-node: record start (best-effort) ---
  let _dnStartNodeId: string | undefined;
  const _dnT0 = Date.now();
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession();
    const _dnStart = await recordDecision({ session: _dnSess, actorType: 'agent', prompt: `forge: phase ${phase}`, context: { phase, profile: options.profile ?? 'balanced', parallel: options.parallel }, result: 'in-progress', success: false });
    _dnStartNodeId = _dnStart.id;
  } catch { /* never block forge */ }

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
  const result = await withProgress(`Forging phase ${phase} [${profile}]`, async (handle) => {
    handle.update('running wave executor...');
    return executeWave(parseInt(phase, 10), profile, options.parallel, options.prompt, options.worktree, undefined, { _onChunk: onChunk });
  });
  if (!result.success) {
    process.exitCode = 1;
    return;
  }

  // Post-wave auto-sanitize: split any file that crossed the 750-LOC threshold (best-effort)
  try {
    const { postWaveSanitize } = await import('../../core/auto-sanitize.js');
    await postWaveSanitize({ cwd: process.cwd() });
  } catch { /* best-effort; never blocks forge */ }

  if (result.success && result.mode === 'executed') {
    try {
      const cwd = process.cwd();
      const commitFn = options._timeMachineCommit ?? (async (opts) => {
        const { createTimeMachineCommit } = await import('../../core/time-machine.js');
        await createTimeMachineCommit(opts);
      });
      await commitFn({ cwd, paths: ['.danteforge'], label: `auto-forge-phase-${phase}-${profile}`, runId: _dnStartNodeId });
      logger.info('[TimeMachine] Post-forge snapshot captured');
    } catch { /* best-effort; never blocks forge */ }
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

  // --- Decision-node: record completion (best-effort) ---
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession();
    await recordDecision({ session: _dnSess, parentNodeId: _dnStartNodeId, actorType: 'agent', prompt: `forge: phase ${phase} [complete]`, context: { phase, profile: options.profile ?? 'balanced' }, result: 'completed', success: true, latencyMs: Date.now() - _dnT0 });
  } catch { /* best-effort */ }
  });
}
