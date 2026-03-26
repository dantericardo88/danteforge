// MCP Adapter — tiered support layer for Figma integration across all editors
// Builds on mcp.ts detection with tiered capabilities per host and remote MCP support.

import path from 'path';
import { detectHost, detectMCPCapabilities, type MCPHost, type MCPCapabilities } from './mcp.js';
import { loadConfig, saveConfig, type DanteConfig } from './config.js';
import { logger } from './logger.js';
import { estimateTokens } from './token-estimator.js';

/**
 * Tiered MCP support levels per host.
 * - full: bidirectional push/pull via MCP natively (Claude Code, Codex)
 * - pull-only: can read from Figma but screenshot fallback for push (Cursor, VS Code)
 * - prompt-only: generates prompts for manual copy-paste (unknown hosts)
 */
export type MCPTier = 'full' | 'pull-only' | 'prompt-only';

export interface MCPAdapterResult {
  host: MCPHost;
  tier: MCPTier;
  capabilities: MCPCapabilities;
  figmaUrl?: string;
  mcpEndpoint: string;
}

const REMOTE_MCP_ENDPOINT = 'https://mcp.figma.com/mcp';

/**
 * Resolve the MCP tier for the detected host.
 * Claude Code and Codex get full bidirectional support.
 * Cursor, VS Code, Windsurf get pull + screenshot fallback.
 * Unknown hosts get prompt-only.
 */
export function resolveTier(host: MCPHost, hasFigmaMCP: boolean): MCPTier {
  if (!hasFigmaMCP) return 'prompt-only';

  switch (host) {
    case 'claude-code':
    case 'codex':
      return 'full';
    case 'cursor':
    case 'vscode':
    case 'windsurf':
      return 'pull-only';
    default:
      return 'prompt-only';
  }
}

/**
 * Full MCP adapter initialization — detects host, capabilities, resolves tier.
 */
export async function initMCPAdapter(hostOverride?: string): Promise<MCPAdapterResult> {
  const host = detectHost(hostOverride);
  const capabilities = await detectMCPCapabilities(host);
  const tier = resolveTier(host, capabilities.hasFigmaMCP);
  const config = await loadConfig();

  return {
    host,
    tier,
    capabilities,
    figmaUrl: config.figma?.defaultFileUrl,
    mcpEndpoint: REMOTE_MCP_ENDPOINT,
  };
}

/**
 * Get the MCP add command for a specific host.
 * Uses the new remote MCP endpoint (Feb 2026) for simpler setup.
 */
export function getMCPSetupCommand(host: MCPHost, figmaToken?: string): string {
  const tokenPlaceholder = figmaToken ?? 'YOUR_FIGMA_PERSONAL_ACCESS_TOKEN';

  switch (host) {
    case 'claude-code':
      return `claude mcp add figma-mcp --url ${REMOTE_MCP_ENDPOINT} -e FIGMA_API_KEY=${tokenPlaceholder}`;
    case 'cursor':
      return `Add to .cursor/mcp.json:\n${JSON.stringify({
        mcpServers: {
          figma: { url: REMOTE_MCP_ENDPOINT, env: { FIGMA_API_KEY: tokenPlaceholder } }
        }
      }, null, 2)}`;
    case 'codex':
      return `Add to .codex/mcp.json:\n${JSON.stringify({
        mcpServers: {
          figma: { url: REMOTE_MCP_ENDPOINT, env: { FIGMA_API_KEY: tokenPlaceholder } }
        }
      }, null, 2)}`;
    case 'vscode':
    case 'windsurf':
      return `Add to .vscode/mcp.json:\n${JSON.stringify({
        mcpServers: {
          figma: { url: REMOTE_MCP_ENDPOINT, env: { FIGMA_API_KEY: tokenPlaceholder } }
        }
      }, null, 2)}`;
    default:
      return `Configure your editor's MCP settings with:\n  Server URL: ${REMOTE_MCP_ENDPOINT}\n  Environment: FIGMA_API_KEY=${tokenPlaceholder}`;
  }
}

/**
 * Test MCP connection by checking if the remote endpoint is reachable.
 * Returns true if the endpoint responds (does not require authentication).
 */
export async function testMCPConnection(
  opts?: { _fetch?: typeof globalThis.fetch } | typeof globalThis.fetch,
): Promise<{ ok: boolean; message: string }> {
  // Support both legacy positional and new options-object style
  const fetchFn = typeof opts === 'function' ? opts : opts?._fetch ?? fetch;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetchFn(REMOTE_MCP_ENDPOINT, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.ok || response.status === 405 || response.status === 404) {
      // 405/404 means server is up but doesn't support HEAD — that's fine
      return { ok: true, message: 'Figma MCP endpoint is reachable' };
    }
    return { ok: false, message: `Figma MCP responded with status ${response.status}` };
  } catch (err) {
    return { ok: false, message: `Cannot reach Figma MCP: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Estimate tokens for a Figma-related payload and decide on mode.
 * Modes: full (all frames), summary (selected frames), screenshot-only (just screenshots).
 * Default: summary.
 */
export function selectFigmaMode(
  payloadChars: number,
  maxTokenBudget: number = 80000,
): { mode: 'full' | 'summary' | 'screenshot-only'; tokens: number; withinBudget: boolean } {
  const tokens = estimateTokens('x'.repeat(payloadChars));

  if (tokens <= maxTokenBudget * 0.5) {
    return { mode: 'full', tokens, withinBudget: true };
  }
  if (tokens <= maxTokenBudget) {
    return { mode: 'summary', tokens, withinBudget: true };
  }
  // Over budget — warn and suggest screenshot-only
  logger.warn(
    `Figma payload (~${tokens.toLocaleString()} tokens) exceeds budget ` +
    `(${maxTokenBudget.toLocaleString()} tokens). Using screenshot-only mode.`
  );
  return { mode: 'screenshot-only', tokens, withinBudget: false };
}

/**
 * Check if a project is frontend/UI-heavy by scanning for common frontend indicators.
 * Used to auto-skip UX refinement for backend-only projects.
 */
export async function isUIProject(cwd = process.cwd()): Promise<boolean> {
  const indicators = [
    'package.json', // Check for React/Vue/Svelte/Next/etc.
    'src/components',
    'src/pages',
    'src/views',
    'src/app',
    'components',
    'pages',
    'public/index.html',
    'index.html',
    'src/App.tsx',
    'src/App.jsx',
    'src/App.vue',
    'src/App.svelte',
  ];

  const fs = await import('fs/promises');

  // Check for frontend framework in package.json
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const frontendFrameworks = ['react', 'vue', 'svelte', '@angular/core', 'next', 'nuxt', 'astro', 'solid-js', 'preact'];
    if (frontendFrameworks.some(fw => fw in allDeps)) return true;
  } catch {
    // No package.json — continue checking
  }

  // Check for UI directories/files
  for (const indicator of indicators.slice(1)) { // skip package.json already checked
    try {
      await fs.access(path.join(cwd, indicator));
      return true;
    } catch {
      // Not found — continue
    }
  }

  return false;
}

/**
 * Get project characteristics for AutoForge decision-making.
 */
export async function getProjectCharacteristics(): Promise<{
  hasUI: boolean;
  hasFigma: boolean;
  hasDesign: boolean;
}> {
  return getProjectCharacteristicsFor(process.cwd());
}

export async function getProjectCharacteristicsFor(
  cwd = process.cwd(),
  _deps?: {
    isUIProject?: (dir: string) => Promise<boolean>;
    initMCPAdapter?: (hostOverride?: string) => Promise<MCPAdapterResult>;
    fsAccess?: (p: string) => Promise<void>;
  },
): Promise<{
  hasUI: boolean;
  hasFigma: boolean;
  hasDesign: boolean;
}> {
  const checkUI = _deps?.isUIProject ?? isUIProject;
  const initAdapter = _deps?.initMCPAdapter ?? initMCPAdapter;
  const checkAccess = _deps?.fsAccess ?? (async (p: string) => { const fsm = await import('fs/promises'); await fsm.access(p); });

  const hasUI = await checkUI(cwd);
  const adapter = await initAdapter();
  const hasFigma = adapter.tier !== 'prompt-only';

  let hasDesign = false;
  try {
    await checkAccess(path.join(cwd, '.danteforge', 'DESIGN.op'));
    hasDesign = true;
  } catch { /* no design file */ }

  return { hasUI, hasFigma, hasDesign };
}

/**
 * Save Figma connection info to config after successful setup.
 */
export async function saveFigmaConfig(
  figmaUrl?: string,
  tokenPath?: string,
  serverName?: string,
  _configOps?: {
    load: () => Promise<ReturnType<typeof loadConfig>>;
    save: (config: Awaited<ReturnType<typeof loadConfig>>) => Promise<void>;
  },
): Promise<void> {
  const configLoad = _configOps?.load ?? loadConfig;
  const configSave = _configOps?.save ?? saveConfig;
  const config = await configLoad();
  config.figma = {
    ...config.figma,
    ...(figmaUrl && { defaultFileUrl: figmaUrl }),
    ...(tokenPath && { designTokensPath: tokenPath }),
    ...(serverName && { mcpServerName: serverName }),
  };
  await configSave(config);
  logger.success('Figma configuration saved');
}
