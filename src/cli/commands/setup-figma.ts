// Setup Figma — interactive wizard for MCP Figma connection
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { initMCPAdapter, getMCPSetupCommand, testMCPConnection, saveFigmaConfig } from '../../core/mcp-adapter.js';
import { detectHost } from '../../core/mcp.js';

export async function setupFigma(options: { host?: string; figmaUrl?: string; tokenFile?: string; test?: boolean } = {}) {
  logger.success('DanteForge Figma Setup Wizard');
  logger.info('');
  logger.info('This wizard configures Figma MCP integration for your editor.');
  logger.info('Uses the remote Figma MCP endpoint (https://mcp.figma.com/mcp).');
  logger.info('');

  // Step 1: Detect host
  const host = detectHost(options.host);
  if (host === 'unknown') {
    logger.warn('Could not auto-detect your editor');
    logger.info('Specify with: danteforge setup figma --host=claude-code|cursor|codex|vscode|windsurf');
    logger.info('');
    logger.info('Try this instead: Run this command inside your AI coding editor,');
    logger.info('or pass --host explicitly.');
  } else {
    logger.success(`Detected editor: ${host}`);
  }

  // Step 2: Show setup command
  logger.info('');
  logger.info('Step 1: Add the Figma MCP server to your editor');
  logger.info('');
  const setupCmd = getMCPSetupCommand(host);
  process.stdout.write(setupCmd + '\n');
  logger.info('');

  // Step 3: Test connection
  if (options.test !== false) {
    logger.info('Step 2: Testing Figma MCP endpoint...');
    const result = await testMCPConnection();
    if (result.ok) {
      logger.success(result.message);
    } else {
      logger.warn(result.message);
      logger.info('');
      logger.info('Try this instead:');
      logger.info('  1. Check your internet connection');
      logger.info('  2. Verify your Figma personal access token');
      logger.info('  3. Try: curl -I https://mcp.figma.com/mcp');
    }
  }

  // Step 4: Check existing MCP capabilities
  const adapter = await initMCPAdapter(options.host);
  logger.info('');
  logger.info(`Step 3: MCP capability check`);
  logger.info(`  Host: ${adapter.host}`);
  logger.info(`  Tier: ${adapter.tier}`);
  logger.info(`  MCP detected: ${adapter.capabilities.hasMCP ? 'yes' : 'no'}`);
  logger.info(`  Figma MCP: ${adapter.capabilities.hasFigmaMCP ? 'yes' : 'no'}`);

  if (adapter.capabilities.hasFigmaMCP) {
    logger.success('Figma MCP is already configured!');
  } else {
    logger.info('');
    logger.info('After running the setup command above, restart your editor');
    logger.info('and re-run: danteforge setup figma --test');
  }

  // Step 5: Save optional config
  if (options.figmaUrl || options.tokenFile) {
    await saveFigmaConfig(options.figmaUrl, options.tokenFile, adapter.capabilities.figmaServerName);
  }

  // Step 6: Summary
  logger.info('');
  logger.info('Step 4: Start using Figma integration');
  logger.info('');
  logger.info('  danteforge ux-refine --prompt --figma-url <url>  # Guided Figma/manual refinement');
  logger.info('  danteforge ux-refine --openpencil                # Local DESIGN.op token extraction');
  logger.info('  danteforge forge 1 --figma --prompt              # Prompt-driven wave + Figma workflow');

  // Audit log
  const state = await loadState();
  state.auditLog.push(`${new Date().toISOString()} | setup-figma: wizard completed (host: ${host}, tier: ${adapter.tier})`);
  await saveState(state);
}
