// Update MCP — manual, opt-in self-healing for MCP adapter configuration
// Uses LLM to research latest MCP changes, summarize pros/cons, and optionally apply updates.
// Fully behind-the-scenes if user says no. No auto-internet — user must explicitly invoke.

import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { loadConfig, saveConfig } from '../../core/config.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { savePrompt, displayPrompt } from '../../core/prompt-builder.js';
import { detectHost, detectMCPCapabilities } from '../../core/mcp.js';
import { resolveTier, testMCPConnection } from '../../core/mcp-adapter.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import fs from 'fs/promises';
import path from 'path';

export type UpdateMcpMode = 'prompt' | 'check' | 'apply';

export function resolveUpdateMcpMode(options: { prompt?: boolean; apply?: boolean; check?: boolean }): UpdateMcpMode {
  const selectedModes: UpdateMcpMode[] = [];
  if (options.prompt) selectedModes.push('prompt');
  if (options.apply) selectedModes.push('apply');
  if (options.check) selectedModes.push('check');

  if (selectedModes.length > 1) {
    throw new Error('Flags --prompt, --apply, and --check are mutually exclusive.');
  }

  return selectedModes[0] ?? 'check';
}

async function applyMcpUpdates(params: {
  host: string;
  tier: string;
  hasFigmaMCP: boolean;
  figmaServerName?: string;
  endpointReachable: boolean;
}) {
  const reportPath = path.join('.danteforge', 'MCP_UPDATE_REPORT.md');
  let report = '';

  try {
    report = await fs.readFile(reportPath, 'utf8');
  } catch {
    logger.error('Cannot apply updates: no MCP update report found.');
    logger.info('Run: danteforge update-mcp --check');
    logger.info('Review the report, then rerun: danteforge update-mcp --apply');
    const state = await loadState();
    state.auditLog.push(`${new Date().toISOString()} | update-mcp: apply skipped (missing report)`);
    await saveState(state);
    return;
  }

  const normalizedReport = report.toUpperCase();
  if (normalizedReport.includes('NO UPDATES') && !normalizedReport.includes('UPDATES AVAILABLE')) {
    logger.success('Report says current MCP configuration is up to date. Nothing to apply.');
    const state = await loadState();
    state.auditLog.push(`${new Date().toISOString()} | update-mcp: apply skipped (no updates in report)`);
    await saveState(state);
    return;
  }

  const config = await loadConfig();
  const resolvedServerName = params.figmaServerName ?? config.figma?.mcpServerName ?? 'figma';
  config.figma = {
    ...config.figma,
    mcpServerName: resolvedServerName,
  };
  await saveConfig(config);

  const state = await loadState();
  state.mcpHost = params.host;
  state.auditLog.push(
    `${new Date().toISOString()} | update-mcp: apply complete ` +
    `(host: ${params.host}, tier: ${params.tier}, figmaMcp: ${params.hasFigmaMCP ? 'yes' : 'no'}, ` +
    `endpoint: ${params.endpointReachable ? 'reachable' : 'unreachable'})`,
  );
  await saveState(state);

  await fs.mkdir('.danteforge', { recursive: true });
  const applyLogPath = path.join('.danteforge', 'MCP_UPDATE_APPLY_LOG.md');
  const applyLog = `# MCP Update Apply Log\n\n` +
    `- Applied: ${new Date().toISOString()}\n` +
    `- Host: ${params.host}\n` +
    `- Tier: ${params.tier}\n` +
    `- Figma MCP detected: ${params.hasFigmaMCP}\n` +
    `- Endpoint reachable: ${params.endpointReachable}\n` +
    `- Saved mcpServerName: ${resolvedServerName}\n`;
  await fs.writeFile(applyLogPath, applyLog);

  logger.success('Applied safe MCP metadata updates.');
  logger.info(`Apply log saved to: ${applyLogPath}`);
  logger.info('If your editor MCP config changed upstream, run: danteforge setup figma');
}

export async function updateMcp(options: {
  prompt?: boolean;
  apply?: boolean;
  check?: boolean;
  _llmCaller?: typeof callLLM;
  _isLLMAvailable?: typeof isLLMAvailable;
} = {}) {
  const llmFn = options._llmCaller ?? callLLM;
  const llmAvailFn = options._isLLMAvailable ?? isLLMAvailable;

  return withErrorBoundary('update-mcp', async () => {
  logger.success('DanteForge MCP Update — Manual Self-Healing');
  logger.info('');

  let mode: UpdateMcpMode;
  try {
    mode = resolveUpdateMcpMode(options);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    return;
  }

  // Step 1: Current MCP status
  const host = detectHost();
  const capabilities = await detectMCPCapabilities(host);
  const tier = resolveTier(host, capabilities.hasFigmaMCP);
  const conn = await testMCPConnection();

  logger.info('Current MCP configuration:');
  logger.info(`  Host: ${host}`);
  logger.info(`  Tier: ${tier}`);
  logger.info(`  Figma MCP: ${capabilities.hasFigmaMCP ? 'yes' : 'no'}`);
  logger.info(`  Endpoint reachable: ${conn.ok ? 'yes' : 'no'}`);
  logger.info('');

  if (mode === 'apply') {
    await applyMcpUpdates({
      host,
      tier,
      hasFigmaMCP: capabilities.hasFigmaMCP,
      figmaServerName: capabilities.figmaServerName,
      endpointReachable: conn.ok,
    });
    return;
  }

  // Step 2: Read current mcp-adapter.ts for context
  let currentAdapter = '';
  try {
    currentAdapter = await fs.readFile(path.join('src', 'core', 'mcp-adapter.ts'), 'utf8');
  } catch {
    // Not in dev environment — use description instead
    currentAdapter = `MCP adapter: tier=${tier}, host=${host}, endpoint=https://mcp.figma.com/mcp`;
  }

  const config = await loadConfig();

  // Step 3: Build the research prompt
  const prompt = `You are a senior engineer reviewing MCP (Model Context Protocol) integration for a development CLI tool.

## Current MCP Configuration
- Host editor: ${host}
- Current tier: ${tier} (full | pull-only | prompt-only)
- Figma MCP detected: ${capabilities.hasFigmaMCP}
- Remote endpoint: https://mcp.figma.com/mcp
- Endpoint reachable: ${conn.ok}
- Figma MCP server name: ${capabilities.figmaServerName ?? 'not configured'}

## Current Adapter Code (summary)
${currentAdapter.length > 2000 ? currentAdapter.slice(0, 2000) + '\n[truncated]' : currentAdapter}

## Task
Research and report on the latest MCP ecosystem changes (Feb 2026):

1. **Endpoint Status**: Is https://mcp.figma.com/mcp still the correct remote endpoint? Any new endpoints?
2. **New MCP Tools**: Are there new Figma MCP tools (e.g., generate_figma_design, batch operations)?
3. **Protocol Changes**: Any MCP protocol version updates affecting our integration?
4. **Editor Support Changes**: New editors supporting MCP natively? Changes to existing editor MCP configs?
5. **Breaking Changes**: Anything that would break our current setup?

For each finding, provide:
- **What changed**: Brief description
- **Pros**: Benefits of adopting this change
- **Cons**: Risks or downsides
- **Recommendation**: APPLY or SKIP with reasoning

End with a summary: "UPDATES AVAILABLE: X changes found" or "NO UPDATES: Current config is up to date"

Important: Only recommend changes you are confident about. Do not fabricate MCP tools or endpoints.`;

  // Mode 1: --prompt (copy-paste)
  if (mode === 'prompt') {
    const savedPath = await savePrompt('update-mcp', prompt);
    displayPrompt(prompt, [
      'Paste into your LLM to research MCP updates.',
      'Review the findings, then run: danteforge update-mcp --apply',
      `Prompt saved to: ${savedPath}`,
    ].join('\n'));

    const state = await loadState();
    state.auditLog.push(`${new Date().toISOString()} | update-mcp: prompt generated`);
    await saveState(state);
    return;
  }

  // Mode 2: --check (default) via LLM API mode
  const llmAvailable = await llmAvailFn();
  if (llmAvailable) {
    logger.info('Researching MCP updates via LLM...');
    logger.info('(This checks for protocol changes, new tools, and endpoint updates)');
    logger.info('');

    try {
      const result = await llmFn(prompt, undefined, { enrichContext: true });

      // Save the research report
      const reportPath = path.join('.danteforge', 'MCP_UPDATE_REPORT.md');
      await fs.mkdir('.danteforge', { recursive: true });
      const report = `# MCP Update Report\n\n_Generated: ${new Date().toISOString()}_\n_Host: ${host} | Tier: ${tier}_\n\n${result}`;
      await fs.writeFile(reportPath, report);

      logger.success(`MCP update research complete`);
      logger.info(`Report saved to: ${reportPath}`);
      logger.info('');
      process.stdout.write(result + '\n');

      // Check if updates are available
      const hasUpdates = result.toUpperCase().includes('UPDATES AVAILABLE');
      if (hasUpdates) {
        logger.info('');
        logger.info('Updates were found. To review and apply:');
        logger.info('  1. Review the report above carefully');
        logger.info('  2. Run: danteforge update-mcp --apply');
        logger.info('  (No changes are made without --apply)');
      } else {
        logger.success('Your MCP configuration appears up to date.');
      }

      const state = await loadState();
      state.auditLog.push(`${new Date().toISOString()} | update-mcp: research complete (updates: ${hasUpdates ? 'yes' : 'no'})`);
      await saveState(state);
      return;
    } catch (err) {
      logger.warn(`LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Mode 3: Fallback — manual guidance
  logger.info('Manual MCP update steps:');
  logger.info('');
  logger.info('  1. Check the Figma MCP docs: https://www.figma.com/developers');
  logger.info('  2. Verify endpoint: curl -I https://mcp.figma.com/mcp');
  logger.info('  3. Check your editor MCP config for outdated settings');
  logger.info('  4. Run: danteforge setup figma (to reconfigure from scratch)');
  logger.info('  5. Run: danteforge doctor (to verify health)');

  const state = await loadState();
  state.auditLog.push(`${new Date().toISOString()} | update-mcp: manual guidance displayed`);
  await saveState(state);
  });
}
